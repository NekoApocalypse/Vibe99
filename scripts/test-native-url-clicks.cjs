// Real Windows opener and real SSH/tmux mouse-reporting fixture. No app IPC mocks.
const { chromium } = require('playwright');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const run = promisify(execFile), delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const host = process.argv[2];
  assert(host && /^[A-Za-z0-9][A-Za-z0-9_.@:-]*$/.test(host));
  const exe = path.resolve('artifacts/Vibe99-Review-10/Vibe99-Review-10.exe');
  const port = 9250, socket = 'vibe99-url-' + randomUUID().slice(0, 10);
  const settings = path.join(process.env.APPDATA, 'com.vibe99.review10', 'settings.json');
  const ui = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'com.vibe99.app', 'settings.json'))).ui;
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ version: 4, ui }));
  let browser, child, paneId, page, success = false;
  const targets = ['https://www.saltdesignsystem.com/salt/foundations/density', 'https://code.visualstudio.com/api/ux-guidelines/overview'];
  try {
    try { await fetch(`http://127.0.0.1:${port}/json/version`); throw Error('Test port occupied'); }
    catch (e) { if (e.message === 'Test port occupied') throw e; }
    child = spawn(exe, [], { detached: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } }); child.unref();
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {} await delay(300); }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = browser.contexts()[0].pages()[0];
    await page.waitForSelector('#tabs-add');
    await page.evaluate(async () => {
      window.__urlEvidence = { ipc: [], packets: [] };
      const original = window.fetch;
      window.fetch = function(input, options) {
        const promise = original.apply(this, arguments);
        let command;
        try { const url = new URL(String(input)); if (url.hostname === 'ipc.localhost') command = decodeURIComponent(url.pathname.slice(1)); } catch {}
        if (['terminal_create', 'terminal_resize', 'terminal_write', 'plugin:opener|open_url'].includes(command)) {
          const args = JSON.parse(typeof options.body === 'string' ? options.body : new TextDecoder().decode(options.body));
          const record = { command, args, status: 'pending' }; window.__urlEvidence.ipc.push(record);
          promise.then(async response => { record.status = response.headers.get('Tauri-Response') === 'ok' ? 'fulfilled' : 'rejected'; record.result = await response.clone().text(); });
        }
        return promise;
      };
      await window.__TAURI__.event.listen('vibe99:terminal-data', ({ payload }) => window.__urlEvidence.packets.push(payload));
    });
    await page.locator('#tabs-add').click();
    paneId = await page.locator('.tab.is-focused').getAttribute('data-pane-id');
    await page.waitForFunction(id => window.__urlEvidence.packets.some(p => p.paneId === id && p.data.includes('Vibe99Prompt')), paneId);
    const source = await page.evaluate(id => window.__urlEvidence.ipc.find(p => p.command === 'terminal_create' && p.args.paneId === id).args, paneId);
    const write = text => page.evaluate(({ source, data }) => window.__TAURI__.core.invoke('terminal_write', { paneId: source.paneId, sessionId: source.sessionId, data }), { source, data: Buffer.from(text).toString('base64') });
    await write(`ssh ${host}\r`);
    await delay(1500);
    await write("printf '%s%s\\n' URL_SSH_ READY\r");
    await page.waitForFunction(id => window.__urlEvidence.packets.filter(p => p.paneId === id).map(p => p.data).join('').includes('URL_SSH_READY'), paneId);
    const code = `import os,time,sys\nc=os.get_terminal_size().columns\ntry:\n print('\\x1b[?1000;1006h\\x1b[2J\\x1b[H'+' '*(c-12)+${JSON.stringify(targets[0])}+'\\r\\n\\x1b]8;;'+${JSON.stringify(targets[1])}+'\\x07'+${JSON.stringify(targets[1])}+'\\x1b]8;;\\x07\\r\\nURL_FIXTURE_READY',flush=True)\n time.sleep(90)\nfinally:\n print('\\x1b[?1000;1006l',flush=True)`;
    const command = `python3 -c 'import base64;exec(base64.b64decode("${Buffer.from(code).toString('base64')}"))'`;
    const quoted = "'" + command.replaceAll("'", "'\"'\"'") + "'";
    await write(`tmux -L ${socket} -f /dev/null new-session -s links ${quoted}\r`);
    await page.waitForFunction(id => window.__urlEvidence.packets.filter(p => p.paneId === id).map(p => p.data).join('').includes('URL_FIXTURE_READY'), paneId);
    await delay(400);
    const rect = await page.locator(`.pane[data-input-pane-id="${paneId}"] .xterm-screen`).boundingBox();
    // tmux uses one terminal row for its status bar; xterm still has source.rows.
    for (const [row, target] of [[1, targets[0]], [2, targets[1]]]) {
      await page.bringToFront();
      const point = { x: rect.x + 4.5 * rect.width / source.cols, y: rect.y + (row + 0.5) * rect.height / source.rows };
      await page.mouse.move(point.x, point.y);
      await page.waitForFunction(id => document.querySelector(`.pane[data-input-pane-id="${id}"] .xterm-cursor-pointer`), paneId);
      const from = await page.evaluate(() => window.__urlEvidence.ipc.length);
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction(from => window.__urlEvidence.ipc.slice(from).some(r => r.command === 'plugin:opener|open_url' && r.status !== 'pending'), from);
      const calls = await page.evaluate(from => window.__urlEvidence.ipc.slice(from), from);
      assert.equal(calls.filter(c => c.command === 'terminal_write').length, 0, 'click never reaches tmux');
      const opened = calls.filter(c => c.command === 'plugin:opener|open_url');
      assert.equal(opened.length, 1); assert.equal(opened[0].status, 'fulfilled'); assert.equal(opened[0].args.url, target);
      console.log('PASS: real SSH/tmux single-click opens ' + target + ' without terminal mouse input');
    }
    await page.screenshot({ path: 'artifacts/review10-native-urls.png' });
    const evidence = await page.evaluate(() => window.__urlEvidence.ipc.filter(r => r.command === 'plugin:opener|open_url'));
    fs.writeFileSync('artifacts/review10-native-url-results.json', JSON.stringify({ success: true, host, socket, evidence, binarySha256: createHash('sha256').update(fs.readFileSync(exe)).digest('hex') }, null, 2));
    success = true;
  } catch (error) {
    if (page) {
      await page.screenshot({ path: 'artifacts/review10-native-url-failure.png' }).catch(() => {});
      fs.writeFileSync('artifacts/review10-native-url-failure.json', JSON.stringify(await page.evaluate(() => window.__urlEvidence).catch(() => null), null, 2));
    }
    throw error;
  } finally {
    await run('ssh.exe', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '--', host, `tmux -L ${socket} kill-server`], { windowsHide: true, timeout: 15000 }).catch(() => {});
    if (page && paneId) await page.locator(`.tab[data-pane-id="${paneId}"] .tab-main`).click({ button: 'middle' }).catch(() => {});
    await browser?.close();
    if (!success && child) { try { process.kill(child.pid); } catch {} }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
