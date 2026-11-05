// Real Windows clipboard -> real Tauri IPC -> TUI attachment, without submitting a prompt.
const { chromium } = require('playwright');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const run = promisify(execFile), delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const host = process.argv[2];
  assert(host && /^[A-Za-z0-9][A-Za-z0-9_.@:-]*$/.test(host), 'Pass an authorized Linux SSH host');
  const exe = path.resolve('artifacts/Vibe99-Review-9/Vibe99-Review-9.exe'), port = 9249;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe99-image-native-'));
  const remoteRoot = '/tmp/vibe99-image-native-' + randomUUID(), socket = 'vibe99-image-' + randomUUID().slice(0, 10);
  const ssh = async code => {
    const { stdout } = await run('ssh.exe', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '--', host,
      `python3 -c 'import base64;exec(base64.b64decode("${Buffer.from(code).toString('base64')}"))'`], { windowsHide: true, timeout: 30000 });
    return stdout.trim();
  };
  const settings = path.join(process.env.APPDATA, 'com.vibe99.review9', 'settings.json');
  const beforeSettings = fs.existsSync(settings) ? fs.readFileSync(settings) : null;
  try { await fetch(`http://127.0.0.1:${port}/json/version`); throw Error('Review test port occupied'); }
  catch (e) { if (e.message.includes('occupied')) throw e; }
  const installed = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'com.vibe99.app', 'settings.json'), 'utf8'));
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ version: 4, ui: installed.ui }));
  const clipboard = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/with-test-image-clipboard.ps1'), '-TestRoot', root], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let clipboardError = ''; clipboard.stderr.on('data', b => clipboardError += b);
  let browser, child, success = false, evidence, remoteImages = [];
  const cases = [];
  try {
    for (let i = 0; i < 100 && !fs.existsSync(path.join(root, 'clipboard-ready')); i++) {
      if (clipboard.exitCode !== null) throw Error('Clipboard fixture failed: ' + clipboardError);
      await delay(100);
    }
    assert(fs.existsSync(path.join(root, 'clipboard-ready')));
    await ssh(`import pathlib;pathlib.Path(${JSON.stringify(remoteRoot)}).mkdir(mode=0o700)`);
    child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false,
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } }); child.unref();
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {} await delay(300); }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages()[0];
    await page.waitForSelector('#tabs-add');
    await page.evaluate(async () => {
      window.__imageEvidence = { packets: [], ipc: [] };
      const original = window.fetch;
      window.fetch = function(input, options) {
        const promise = original.apply(this, arguments);
        let command;
        try { const url = new URL(String(input)); if (url.hostname === 'ipc.localhost') command = decodeURIComponent(url.pathname.slice(1)); } catch {}
        if (['clipboard_capture', 'terminal_image_path'].includes(command)) {
          const args = JSON.parse(typeof options.body === 'string' ? options.body : new TextDecoder().decode(options.body));
          const record = { command, args, status: 'pending' }; window.__imageEvidence.ipc.push(record);
          promise.then(async response => { const text = await response.clone().text(); record.status = response.headers.get('Tauri-Response') === 'ok' ? 'fulfilled' : 'rejected'; try { record.result = JSON.parse(text); } catch { record.result = text; } });
        }
        return promise;
      };
      await window.__TAURI__.event.listen('vibe99:terminal-data', ({ payload }) => window.__imageEvidence.packets.push(payload));
    });
    const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI__.core.invoke(command, args), { command, args });
    const codexLinux = '/home/pb/.nvm/versions/node/v24.8.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex --no-alt-screen';
    const codexWindows = process.env.VIBE99_TEST_CODEX || (await run('where.exe', ['codex'], { windowsHide: true })).stdout.trim().split(/\r?\n/)[0];
    const casesToRun = [ ['local-codex', false, false], ['ssh-codex', true, false], ['tmux-codex', true, true], ['ssh-agy', true, false], ['tmux-agy', true, true] ];
    for (const [name, remote, tmux] of casesToRun) {
      if (process.argv.includes('--remote-only') && !remote) continue;
      if (process.argv.includes('--local-only') && remote) continue;
      await page.locator('#tabs-add').click();
      const paneId = await page.locator('.tab.is-focused').getAttribute('data-pane-id');
      await page.waitForFunction(id => window.__imageEvidence.packets.some(p => p.paneId === id && p.data.includes('Vibe99Prompt')), paneId);
      const source = await page.evaluate(id => { const p = window.__imageEvidence.packets.find(p => p.paneId === id); return { paneId: id, sessionId: p.sessionId }; }, paneId);
      const write = text => invoke('terminal_write', { ...source, data: Buffer.from(text).toString('base64') });
      const output = () => page.evaluate(id => window.__imageEvidence.packets.filter(p => p.paneId === id).map(p => p.data).join(''), paneId);
      if (remote) {
        await write(`ssh ${host}\r`);
        await page.waitForFunction(async source => (await window.__TAURI__.core.invoke('terminal_preview_context', source)).kind === 'ssh', source);
        await delay(1000);
        await write("printf '%s%s\\n' IMAGE_SSH_ READY\r");
        await page.waitForFunction(id => window.__imageEvidence.packets.filter(p => p.paneId === id).map(p => p.data).join('').includes('IMAGE_SSH_READY'), paneId);
        const program = name.endsWith('agy') ? 'env AGY_CLI_DISABLE_AUTO_UPDATE=true ~/.local/bin/agy' : codexLinux;
        if (tmux) {
          const command = `cd ${remoteRoot}; exec ${program}`;
          await write(`tmux -L ${socket} -f /dev/null new-session -s ${name} '${command}'\r`);
        } else await write(`cd ${remoteRoot}; echo $$ > ${name}.pid; exec ${program}\r`);
      } else await write(`& '${codexWindows.replaceAll("'", "''")}' --no-daemon --no-alt-screen --cd '${root.replaceAll("'", "''")}'\r`);
      await delay(4500);
      if (/trust.{0,200}(?:folder|directory)|(?:folder|directory).{0,200}trust/is.test(await output())) {
        await write('\r'); await delay(2500);
      }
      if (!remote) {
        // The desktop-bundled Windows CLI can paint its composer before model
        // startup enables attachments. Wait for its explicit idle report.
        await page.waitForFunction(id => window.__imageEvidence.packets.filter(p => p.paneId === id).map(p => p.data).join('').includes('state=idle:app=codex'), paneId, { timeout: 45000 });
      }
      await page.locator(`.pane[data-input-pane-id="${paneId}"] .xterm-helper-textarea`).focus();
      const from = await page.evaluate(() => window.__imageEvidence.ipc.length);
      await page.keyboard.press(name.endsWith('agy') ? 'Control+Shift+v' : 'Control+v');
      await page.waitForFunction(from => window.__imageEvidence.ipc.slice(from).some(c => c.command === 'terminal_image_path' && c.status !== 'pending'), from, { timeout: 40000 });
      const result = await page.evaluate(from => window.__imageEvidence.ipc.slice(from).find(c => c.command === 'terminal_image_path'), from);
      assert.equal(result.status, 'fulfilled', JSON.stringify(result));
      assert.equal(result.args.target, remote ? host : null);
      const imagePath = result.result;
      if (remote) remoteImages.push(imagePath);
      const expected = name.endsWith('agy') ? 'media attached' : '[Image #1]';
      try {
        await page.waitForFunction(({ paneId, expected }) => window.__imageEvidence.packets.filter(p => p.paneId === paneId).map(p => p.data).join('').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').includes(expected), { paneId, expected }, { timeout: 15000 });
      } catch (error) {
        fs.writeFileSync(`artifacts/review9-${name}-output.log`, await output()); await page.screenshot({ path: `artifacts/review9-${name}-failure.png` }); throw error;
      }
      const imageInfo = remote ? JSON.parse(await ssh(`import os,hashlib,json,stat;p=${JSON.stringify(imagePath)};s=os.stat(p);print(json.dumps({'sha256':hashlib.sha256(open(p,'rb').read()).hexdigest(),'mode':stat.S_IMODE(s.st_mode),'size':s.st_size}))`))
        : { sha256: createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex') };
      if (remote) assert.equal(imageInfo.mode, 0o600);
      if (cases.length) assert.equal(imageInfo.sha256, cases[0].sha256, 'all TUIs receive the same captured PNG bytes');
      cases.push({ name, imagePath, ...imageInfo });
      await page.screenshot({ path: `artifacts/review9-${name}.png` });
      console.log('PASS: ' + name + ' shows image attachment; exact PNG staged' + (remote ? ' with mode 0600' : ''));
      await page.locator(`.tab[data-pane-id="${paneId}"] .tab-main`).click({ button: 'middle' });
    }
    evidence = await page.evaluate(() => window.__imageEvidence);
    assert.equal(evidence.ipc.filter(c => c.command === 'clipboard_capture').length, cases.length, 'one capture per paste gesture');
    success = true;
    await page.bringToFront();
  } finally {
    fs.writeFileSync(path.join(root, 'clipboard-done'), 'done');
    for (let i = 0; i < 100 && !fs.existsSync(path.join(root, 'clipboard-restored')); i++) await delay(100);
    const clipboardRestored = fs.existsSync(path.join(root, 'clipboard-restored')) ? fs.readFileSync(path.join(root, 'clipboard-restored'), 'utf8').trim() : clipboardError || 'not confirmed';
    await browser?.close();
    if (!success && child) { try { process.kill(child.pid); } catch {} }
    await ssh(`import pathlib,os,signal,time,subprocess\nr=pathlib.Path(${JSON.stringify(remoteRoot)})\nsubprocess.run(['tmux','-L',${JSON.stringify(socket)},'kill-server'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\nif r.exists():\n for p in r.glob('*.pid'):\n  pid=int(p.read_text())\n  try:\n   if pathlib.Path('/proc/%d/cwd'%pid).resolve()==r:\n    os.kill(pid,signal.SIGHUP)\n  except ProcessLookupError: pass\n  p.unlink()\n r.rmdir()\nfor value in ${JSON.stringify(remoteImages)}:\n p=pathlib.Path(value)\n if p.name.startswith('image-') and p.parent.name=='vibe99-images-%d'%os.getuid(): p.unlink(missing_ok=True)`);
    fs.writeFileSync('artifacts/review9-native-image-results.json', JSON.stringify({ success, cases, clipboardRestored,
      binarySha256: createHash('sha256').update(fs.readFileSync(exe)).digest('hex'), pid: child?.pid,
      ipc: evidence?.ipc }, null, 2));
    console.log('Clipboard: ' + clipboardRestored);
    if (!success && beforeSettings) fs.writeFileSync(settings, beforeSettings);
    assert(clipboardRestored === 'restored' || clipboardRestored === 'newer clipboard preserved', 'Clipboard restoration must complete');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
