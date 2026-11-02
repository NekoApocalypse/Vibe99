// Authorized-host integration, run only against the final rebuilt Review 5 exe.
// Usage: node scripts/test-native-ssh-preview.cjs <review-exe> <authorized-ssh-host>
const { chromium } = require('playwright');
const { spawn, execFile } = require('node:child_process');
const { resolve, join, dirname, basename } = require('node:path');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');
const { createHash, randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const execFileAsync = promisify(execFile);

(async () => {
  assert(process.argv[2] && process.argv[3], 'Pass the final rebuilt Review 5 executable and explicitly authorized SSH host');
  const executable = resolve(process.argv[2]), host = process.argv[3];
  assert(!host.startsWith('-') && !/[\s\x00-\x1f]/.test(host), 'Use an SSH host or user@host');
  const bytes = fs.readFileSync(executable);
  assert(bytes.includes(Buffer.from('com.vibe99.review5')) && bytes.includes(Buffer.from('Vibe99 Review 5')));
  const remotePython = async (source, attempts = 1) => {
    const encoded = Buffer.from(source).toString('base64');
    const command = `python3 -c 'import base64;exec(compile(base64.b64decode("${encoded}"),"native_test","exec"))'`;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await execFileAsync('ssh.exe', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '--', host, command],
          { windowsHide: true, timeout: 25000, maxBuffer: 1024 * 1024 });
        return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
      } catch (error) {
        if (attempt === attempts || (!error.killed && error.code !== 255)) throw error;
        console.log(`Retrying auxiliary SSH transport after attempt ${attempt}`);
      }
    }
  };
  const port = 9241;
  try { await fetch(`http://127.0.0.1:${port}/json/version`); throw Error(`Port ${port} is occupied`); }
  catch (error) { if (error.message.includes('occupied')) throw error; }
  const settingsPath = join(process.env.APPDATA, 'com.vibe99.review5', 'settings.json');
  const settingsBefore = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath) : null;
  const profile = fs.mkdtempSync(join(tmpdir(), 'vibe99-native-ssh-webview-'));
  let remoteRoot, child, browser, page;
  const errors = [];
  try {
    const document = '# Native SSH workspace\n\nRead remote Markdown and run commands in the same pane.\n\n' +
      'Inline math: $E=mc^2$.\n\n```mermaid\nflowchart LR\n  SSH[SSH connection] --> Files[Remote Markdown]\n  Files --> Shell[Workspace terminal]\n```\n';
    remoteRoot = '/tmp/vibe99-native-ssh-' + randomUUID();
    assert.equal(await remotePython(`import os,json\np=${JSON.stringify(remoteRoot)}\nos.mkdir(p,0o700)\nopen(os.path.join(p,'README.md'),'w').write(${JSON.stringify(document)})\nopen(os.path.join(p,'next note.md'),'w').write('# Opened through v99\\n\\nThe terminal opened this remote Markdown file.\\n')\nprint(json.dumps(p))`), remoteRoot);
    assert(/^\/tmp\/vibe99-native-ssh-[^/]+$/.test(remoteRoot), 'Remote fixture must stay in its unique /tmp directory');
    const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: profile };
    delete env.VIBE99_WINDOWS_SHELL;
    child = spawn(executable, [], { windowsHide: true, stdio: 'ignore', env });
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; }
      catch { if (child.exitCode !== null) throw Error(`Review exited: ${child.exitCode}`); }
      await delay(500);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    page = context.pages()[0] || await context.waitForEvent('page');
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.waitForFunction(() => window.__TAURI__?.core && document.querySelector('#tabs-preview'));
    assert((await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().title())).includes('Vibe99 Review 5'));
    assert.equal(resolve(await page.evaluate(() => window.__TAURI__.path.appDataDir())).toLowerCase(), dirname(settingsPath).toLowerCase());
    await page.evaluate(async () => {
      window.__nativeSSHEvents = [];
      await window.__TAURI__.event.listen('vibe99:workspace-event', ({ payload }) => window.__nativeSSHEvents.push(payload));
    });
    await page.locator('#tabs-preview').click();
    const workspace = page.locator('.preview-workspace').last();
    await workspace.locator('select[name=kind]').selectOption('ssh');
    await workspace.locator('input[name=target]').fill(host);
    await workspace.locator('input[name=root]').fill(remoteRoot);
    await workspace.locator('input[name=path]').fill('README.md');
    await workspace.locator('.preview-open').click();
    await workspace.getByRole('heading', { name: 'Native SSH workspace', exact: true }).waitFor({ timeout: 30000 });
    await workspace.locator('.katex').first().waitFor();
    await workspace.locator('[data-diagram] svg').waitFor({ timeout: 20000 });
    await workspace.locator('.preview-terminal-toggle').click();
    await page.waitForFunction(() => window.__nativeSSHEvents.some(e => e.event === 'terminal-data'), null, { timeout: 20000 });
    await workspace.locator('.xterm-helper-textarea').focus();
    const typedAt = Date.now();
    const metadata = `python3 -c 'import os,json;open("owned-session.json","w").write(json.dumps({"socket":os.environ["VIBE99_SOCKET"],"shell_pid":os.getppid()}))'; printf '%s%s\\n' NATIVE_SSH_ READY`;
    await page.keyboard.type(metadata); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.preview-terminal-host .xterm-rows')?.textContent.includes('NATIVE_SSH_READY'));
    console.log(`PASS: ${metadata.length} individually typed characters plus Enter reached the remote shell in ${Date.now() - typedAt} ms`);
    const owned = await page.evaluate(async root => {
      const workspaceId = window.__nativeSSHEvents.find(e => e.event === 'terminal-data').workspaceId;
      const file = await window.__TAURI__.core.invoke('workspace_request', {
        workspaceId, method: 'read', args: { path: root + '/owned-session.json' },
      });
      return JSON.parse(file.text);
    }, remoteRoot);
    assert(/^\/tmp\/vibe99-[^/]+\/open\.sock$/.test(owned.socket));
    assert(Number.isSafeInteger(owned.shell_pid) && owned.shell_pid > 1);
    fs.mkdirSync(resolve('artifacts'), { recursive: true });
    await page.screenshot({ path: resolve('artifacts/native-ssh-preview-review5.png') });
    await page.keyboard.type("v99 'next note.md'"); await page.keyboard.press('Enter');
    await workspace.getByRole('heading', { name: 'Opened through v99', exact: true }).waitFor();
    assert(await page.evaluate(() => window.__nativeSSHEvents.some(e => e.event === 'open' && e.path.endsWith('/next note.md'))));
    await page.locator('.tab').last().locator('.tab-close').click();
    const cleanup = await remotePython(`import os,json,time\nsocket_path=${JSON.stringify(owned.socket)}\npid=${owned.shell_pid}\ndef alive():\n try:\n  return open('/proc/%d/stat'%pid).read().split(') ')[1].split()[0] != 'Z'\n except FileNotFoundError:return False\nfor _ in range(80):\n if not os.path.exists(os.path.dirname(socket_path)) and not alive():break\n time.sleep(.1)\nprint(json.dumps({'directory_removed':not os.path.exists(os.path.dirname(socket_path)),'shell_exited':not alive()}))`, 2);
    assert.deepEqual(cleanup, { directory_removed: true, shell_exited: true });
    console.log('PASS: actual Tauri→SSH→bridge→Markdown UI, math/Mermaid rendering, integrated terminal input/output, v99 open event, owned shell/socket cleanup');
    console.log('Executable SHA256: ' + createHash('sha256').update(bytes).digest('hex'));
    console.log('Screenshot: ' + resolve('artifacts/native-ssh-preview-review5.png'));
  } catch (error) {
    if (page && !page.isClosed()) {
      fs.mkdirSync(resolve('artifacts'), { recursive: true });
      await page.screenshot({ path: resolve('artifacts/native-ssh-preview-failure.png') }).catch(() => {});
      const state = await page.evaluate(() => ({
        status: document.querySelector('.preview-workspace .preview-status')?.textContent,
        terminal: document.querySelector('.preview-terminal-host .xterm-rows')?.textContent,
        focus: document.activeElement?.className,
        events: (window.__nativeSSHEvents || []).slice(-100).map(event => event.event === 'terminal-data'
          ? { ...event, data: atob(event.data) } : event),
      })).catch(() => ({}));
      fs.writeFileSync(resolve('artifacts/native-ssh-preview-failure.json'), JSON.stringify({
        executableSha256: createHash('sha256').update(bytes).digest('hex'), error: String(error), errors, ...state,
      }, null, 2));
      console.error('Failure details: artifacts/native-ssh-preview-failure.json');
    }
    throw error;
  } finally {
    if (page) await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(() => {});
    await browser?.close().catch(() => {});
    if (child) {
      for (let i = 0; child.exitCode === null && i < 40; i++) await delay(100);
      if (child.exitCode === null) await execFileAsync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      for (let i = 0; child.exitCode === null && i < 20; i++) await delay(100);
      assert(child.exitCode !== null, 'Test app must exit before restoring settings');
      if (settingsBefore === null) fs.rmSync(settingsPath, { force: true });
      else { fs.mkdirSync(dirname(settingsPath), { recursive: true }); fs.writeFileSync(settingsPath, settingsBefore); }
    }
    if (remoteRoot) await remotePython(`import os,shutil,json\np=os.path.realpath(${JSON.stringify(remoteRoot)})\nassert os.path.dirname(p)=='/tmp' and os.path.basename(p).startswith('vibe99-native-ssh-')\nif os.path.isdir(p):shutil.rmtree(p)\nprint(json.dumps({'removed':not os.path.exists(p)}))`, 2);
    try {
      const target = fs.realpathSync(profile);
      assert(dirname(target) === fs.realpathSync(tmpdir()) && basename(target).startsWith('vibe99-native-ssh-webview-'));
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch { /* Leave only this isolated profile if WebView briefly holds its cache. */ }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
