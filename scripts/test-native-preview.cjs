// Native Review 5 smoke test. Run only after its release build has completed:
// node scripts/test-native-preview.cjs src-tauri/target/release/vibe99.exe
const { chromium } = require('playwright');
const { spawn, execFile } = require('node:child_process');
const { resolve, join, dirname, basename } = require('node:path');
const { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const execFileAsync = promisify(execFile);

(async () => {
  assert(process.argv[2], 'Pass the completed Review 5 executable');
  const executable = resolve(process.argv[2]);
  const bytes = readFileSync(executable);
  assert(bytes.includes(Buffer.from('com.vibe99.review5')) && bytes.includes(Buffer.from('Vibe99 Review 5')),
    'Executable must contain the isolated Review 5 identifier and window title');
  const port = 9241;
  try { await fetch(`http://127.0.0.1:${port}/json/version`); throw Error(`Port ${port} is already occupied`); }
  catch (error) { if (error.message.includes('occupied')) throw error; }
  const reviewSettings = join(process.env.APPDATA, 'com.vibe99.review5', 'settings.json');
  const savedSettings = existsSync(reviewSettings) ? readFileSync(reviewSettings) : null;
  const fixture = mkdtempSync(join(tmpdir(), 'vibe99-native-preview-'));
  const browserProfile = mkdtempSync(join(tmpdir(), 'vibe99-native-webview-'));
  const root = join(fixture, '项目 review files');
  mkdirSync(root);
  const documentPath = join(root, '演示 note.md');
  const source = '# Native Review 5\n\nLocal preview and a real PowerShell terminal.\n\n' +
    '## Rendering checks\n\nInline math: $E = mc^2$.\n\n' +
    '```mermaid\nflowchart LR\n  File[Markdown file] --> Preview[Live preview]\n  Preview --> Terminal[Workspace terminal]\n```\n\n' +
    '![Local fixture image](image%20sample.png)\n\n```javascript\nconsole.log("Native workspace ready");\n```\n';
  writeFileSync(documentPath, source);
  writeFileSync(join(root, 'image sample.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64'));
  writeFileSync(join(root, 'binary.md'), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(root, 'oversize.md'), 'a'.repeat(4 * 1024 * 1024 + 1));
  const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: browserProfile };
  delete env.VIBE99_WINDOWS_SHELL;
  const child = spawn(executable, [], { windowsHide: true, stdio: 'ignore', env });
  let browser, page;
  try {
    for (let i = 0; i < 120; i++) {
      try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) break; }
      catch { if (child.exitCode !== null) throw Error(`Review exited: ${child.exitCode}`); }
      await delay(500);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    page = context.pages()[0] || await context.waitForEvent('page');
    await page.waitForFunction(() => window.__TAURI__?.core && document.querySelector('#tabs-preview'));
    const title = await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().title());
    assert(title.includes('Vibe99 Review 5'), 'Only the isolated Review 5 window is permitted');
    const actualDataDir = await page.evaluate(() => window.__TAURI__.path.appDataDir());
    assert.equal(resolve(actualDataDir).toLowerCase(), dirname(reviewSettings).toLowerCase());
    await page.evaluate(async () => {
      window.__nativePreview = { packets: [], exits: [], errors: [] };
      await window.__TAURI__.event.listen('vibe99:terminal-data', ({ payload: packet }) => {
        if (!packet.paneId.startsWith('__test') && !packet.paneId.startsWith('preview-')) return;
        window.__nativePreview.packets.push(packet);
        if (packet.paneId.startsWith('__test')) window.__TAURI__.core.invoke('terminal_acknowledge', {
          paneId: packet.paneId, sessionId: packet.sessionId, sequence: packet.sequence,
        }).catch(error => window.__nativePreview.errors.push(String(error)));
      });
      await window.__TAURI__.event.listen('vibe99:terminal-exit', ({ payload: packet }) => window.__nativePreview.exits.push(packet));
    });
    const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI__.core.invoke(command, args), { command, args });
    const workspaceId = '__test-native-preview-api';
    await invoke('workspace_open', { workspaceId, target: null, root });
    const request = (method, args) => invoke('workspace_request', { workspaceId, method, args });
    assert.equal((await request('read', { path: documentPath })).text, source);
    assert.equal((await request('stat', { path: documentPath })).size, Buffer.byteLength(source));
    const image = await request('image', { source: 'image%20sample.png', document: documentPath, root });
    assert(image.url.startsWith('data:image/png;base64,'));
    await assert.rejects(request('read', { path: join(root, 'oversize.md') }), /size limit/i);
    await assert.rejects(request('read', { path: join(root, 'binary.md') }), /binary/i);
    await assert.rejects(request('write', { path: documentPath, text: 'SHOULD NOT WRITE' }), /unsupported/i);
    assert.equal(readFileSync(documentPath, 'utf8'), source);
    await invoke('workspace_close', { workspaceId });
    await assert.rejects(request('read', { path: documentPath }), /not found/i);
    const sshStart = Date.now();
    await assert.rejects(invoke('workspace_open', { workspaceId: '__test-invalid-ssh', target: '-', root }), /SSH config host/i);
    assert(Date.now() - sshStart < 3000, 'Invalid SSH target must fail before attempting a connection');
    console.log('PASS: actual Tauri local read/stat/image, size/binary/write rejection, workspace cleanup and immediate invalid-SSH validation');

    const sessionId = 'native-review5-prompt';
    await invoke('terminal_create', { paneId: '__test-native-prompt', sessionId, cols: 100, rows: 28, cwd: root, shellProfileId: '__vibe99_local__' });
    await page.waitForFunction(id => window.__nativePreview.packets.filter(p => p.sessionId === id).map(p => p.data).join('').includes(`\x1b]633;Vibe99Prompt;${id}\x07`), sessionId, { timeout: 20000 });
    await invoke('terminal_destroy', { paneId: '__test-native-prompt', sessionId });
    await page.waitForFunction(id => window.__nativePreview.exits.some(p => p.sessionId === id), sessionId);
    console.log('PASS: authenticated PowerShell prompt marker survives real ConPTY output; owned test PTY exits');

    await page.locator('#tabs-preview').click();
    const workspace = page.locator('.preview-workspace').last();
    await workspace.locator('input[name=root]').fill(root);
    await workspace.locator('input[name=path]').fill('演示 note.md');
    await workspace.locator('.preview-open').click();
    await workspace.getByRole('heading', { name: 'Native Review 5', exact: true }).waitFor();
    await workspace.locator('.katex').first().waitFor();
    await workspace.locator('[data-diagram] svg').waitFor({ timeout: 20000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.preview-workspace article img')].some(img => img.complete && img.naturalWidth > 0));
    await workspace.locator('.preview-terminal-toggle').click();
    await page.waitForFunction(() => window.__nativePreview.packets.some(p => p.paneId.startsWith('preview-') && p.data.includes('Vibe99Prompt')));
    const firstTerminal = await page.evaluate(() => window.__nativePreview.packets.find(p => p.paneId.startsWith('preview-')).sessionId);
    await workspace.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type("Write-Output ('NATIVE_PREVIEW_'+'READY')");
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.preview-terminal-host .xterm-rows')?.textContent.includes('NATIVE_PREVIEW_READY'));
    mkdirSync(resolve('artifacts'), { recursive: true });
    await page.screenshot({ path: resolve('artifacts/native-preview-review5.png') });
    await workspace.locator('.preview-connect').click();
    await page.waitForFunction(id => window.__nativePreview.exits.some(p => p.sessionId === id), firstTerminal);
    await page.waitForFunction(id => window.__nativePreview.packets.some(p => p.paneId.startsWith('preview-') && p.sessionId !== id), firstTerminal);
    const secondTerminal = await page.evaluate(id => window.__nativePreview.packets.find(p => p.paneId.startsWith('preview-') && p.sessionId !== id).sessionId, firstTerminal);
    await page.locator('.tab').last().locator('.tab-close').click();
    await page.waitForFunction(id => window.__nativePreview.exits.some(p => p.sessionId === id), secondTerminal);
    assert.deepEqual(await page.evaluate(() => window.__nativePreview.errors), []);
    console.log('PASS: native Markdown path with spaces/Chinese, image/math/Mermaid rendering, actual PowerShell input, reconnect/close PTY cleanup');
    console.log('Screenshot: ' + resolve('artifacts/native-preview-review5.png'));
  } finally {
    if (page) {
      await page.evaluate(async () => {
        await window.__TAURI__.core.invoke('terminal_destroy', { paneId: '__test-native-prompt', sessionId: 'native-review5-prompt' }).catch(() => {});
        await window.__TAURI__.core.invoke('workspace_close', { workspaceId: '__test-native-preview-api' }).catch(() => {});
        await window.__TAURI__.window.getCurrentWindow().close();
      }).catch(() => {});
    }
    await browser?.close().catch(() => {});
    for (let i = 0; child.exitCode === null && i < 40; i++) await delay(100);
    if (child.exitCode === null) {
      await execFileAsync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      for (let i = 0; child.exitCode === null && i < 20; i++) await delay(100);
    }
    assert(child.exitCode !== null, 'Review process must exit before restoring its settings');
    if (savedSettings === null) rmSync(reviewSettings, { force: true });
    else { mkdirSync(dirname(reviewSettings), { recursive: true }); writeFileSync(reviewSettings, savedSettings); }
    for (const folder of [fixture, browserProfile]) {
      try {
        const target = realpathSync(folder), parent = realpathSync(tmpdir());
        assert(dirname(target) === parent && basename(target).startsWith('vibe99-native-'));
        rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      } catch { /* WebView can briefly retain its isolated profile; never touch other profiles. */ }
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
