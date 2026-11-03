// Native WebView2 acceptance and presentation. Leaves only the new review window open.
const { chromium } = require('playwright');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const delay = ms => new Promise(r => setTimeout(r, ms));
const run = promisify(execFile);

(async () => {
  const exe = resolve('artifacts/Vibe99-Review-8/Vibe99-Review-8.exe'), port = 9248;
  const host = process.argv[2];
  assert(host && /^[A-Za-z0-9][A-Za-z0-9_.@:-]*$/.test(host), 'Pass an authorized SSH host for the temporary Mermaid fixture');
  const remote = '/tmp/vibe99-diagram-' + randomUUID();
  const ssh = code => run('ssh.exe', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '--', host,
    `python3 -c 'import base64;exec(base64.b64decode("${Buffer.from(code).toString('base64')}"))'`], { windowsHide: true, timeout: 30000 });
  try { await fetch(`http://127.0.0.1:${port}/json/version`); throw Error('Presentation port occupied'); }
  catch (e) { if (e.message.includes('occupied')) throw e; }
  const settings = join(process.env.APPDATA, 'com.vibe99.review8', 'settings.json');
  assert(!fs.existsSync(settings), 'Use a fresh review identifier; do not overwrite a previous review session');
  const installed = JSON.parse(fs.readFileSync(join(process.env.APPDATA, 'com.vibe99.app', 'settings.json'), 'utf8'));
  fs.mkdirSync(resolve(settings, '..'), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ version: 4, ui: installed.ui }, null, 2));
  const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
  child.unref();
  let browser;
  try {
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
      await delay(500);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages()[0], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('#tabs-add');
    const title = await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().title());
    assert(title.includes('Review 8'));
    await page.evaluate(async () => { window.__packets = []; await window.__TAURI__.event.listen('vibe99:terminal-data', ({ payload }) => window.__packets.push(payload)); });
    const order = () => page.locator('.tab').evaluateAll(t => t.map(e => e.dataset.paneId));
    const focus = async id => { await page.locator(`.tab[data-pane-id="${id}"] .tab-main`).click(); await delay(250); };
    await page.locator('#tabs-add').click();
    const sourceId = (await order()).at(-1);
    await page.waitForFunction(id => window.__packets.some(p => p.paneId === id && p.data.includes('Vibe99Prompt')), sourceId);
    const source = await page.evaluate(id => { const p = window.__packets.find(p => p.paneId === id); return { paneId: id, sessionId: p.sessionId }; }, sourceId);
    const write = command => page.evaluate(({ source, data }) => window.__TAURI__.core.invoke('terminal_write', { ...source, data }), { source, data: Buffer.from(command).toString('base64') });
    async function openFromTerminal(url, label, remoteShell = false) {
      await focus(sourceId); const before = await order();
      const start = await page.evaluate(() => window.__packets.length);
      const command = remoteShell
        ? `printf '\\033[2J\\033[H\\033]8;;${url}\\007${label}\\033]8;;\\007\\n'\r`
        : `[Console]::Write([char]27+'[2J'+[char]27+'[H'+[char]27+']8;;${url}'+[char]7+'${label}'+[char]27+']8;;'+[char]7+[char]13+[char]10)\r`;
      await write(command);
      await page.waitForFunction(start => window.__packets.slice(start).some(p => p.data.includes('\x1b]8;')), start);
      await delay(250);
      const r = await page.locator('.pane.is-focused .xterm-screen').boundingBox();
      await page.mouse.move(r.x + 40, r.y + 9);
      await page.locator('.pane.is-focused .xterm-cursor-pointer').waitFor();
      await page.mouse.click(r.x + 40, r.y + 9);
      await page.waitForFunction(n => document.querySelectorAll('.tab').length === n + 1, before.length);
      await page.locator('.pane.is-focused .diagram-expand').first().waitFor({ timeout: 60000 });
      const after = await order(), created = after.find(id => !before.includes(id));
      assert.equal(after.indexOf(created), after.indexOf(sourceId) + 1);
      return created;
    }
    const local = await openFromTerminal(pathToFileURL(resolve('artifacts/Vibe99-Review-8/Review.md')).href, 'Review.md');
    const localExpand = page.locator('.pane.is-focused .diagram-expand').first();
    await localExpand.click();
    const dialog = page.locator('dialog.diagram-viewer');
    assert(await dialog.evaluate(el => el.matches(':modal')));
    const beforeKeys = await order();
    await page.keyboard.press('Control+n'); await page.keyboard.press('Control+Tab'); await page.keyboard.press('Control+b');
    assert.deepEqual(await order(), beforeKeys, 'modal does not create, cycle or navigate tabs');
    assert(await page.locator(`.tab[data-pane-id="${local}"]`).evaluate(el => el.classList.contains('is-focused')));
    const canvas = page.locator('.diagram-canvas'), box = await canvas.boundingBox();
    const transform = () => page.locator('.diagram-transform').evaluate(el => { const m = new DOMMatrix(getComputedStyle(el).transform); return { s: m.a, x: m.e, y: m.f }; });
    const fit = await transform();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -400);
    await page.waitForFunction(s => new DOMMatrix(getComputedStyle(document.querySelector('.diagram-transform')).transform).a > s, fit.s);
    const zoom = await transform();
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 8 }); await page.mouse.up();
    assert(Math.abs((await transform()).x - zoom.x - 80) < 1);
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await page.screenshot({ path: 'artifacts/review8-native-mermaid.png' });
    await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0);
    assert(await localExpand.evaluate(el => el === document.activeElement));
    console.log('PASS: native local file link, top-layer Mermaid wheel/drag/Fit/Escape, app shortcut isolation and focus return');
    await ssh(`from pathlib import Path\np=Path(${JSON.stringify(remote)})\np.mkdir()\n(p/'remote.md').write_text('# Remote Mermaid\\n\\n\`\`\`mermaid\\nflowchart LR\\nA[SSH file] --> B[Expanded locally]\\n\`\`\`\\n',encoding='utf-8')`);
    await focus(sourceId);
    await write(`ssh ${host}\r`);
    await page.waitForFunction(async source => (await window.__TAURI__.core.invoke('terminal_preview_context', source)).kind === 'ssh', source);
    await delay(1000);
    const start = await page.evaluate(() => window.__packets.length);
    await write("printf '%s%s\\n' REVIEW8_ READY\r");
    await page.waitForFunction(start => window.__packets.slice(start).map(p => p.data).join('').includes('REVIEW8_READY'), start);
    const remoteId = await openFromTerminal(`file://${remote}/remote.md`, 'remote.md', true);
    await page.locator('.pane.is-focused .diagram-expand').click();
    assert((await dialog.textContent()).includes('SSH file'));
    await page.keyboard.press('+'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Escape');
    await page.locator(`.tab[data-pane-id="${remoteId}"] .tab-main`).click({ button: 'middle' });
    await page.waitForFunction(id => !document.querySelector(`.tab[data-pane-id="${id}"]`), remoteId);
    await page.locator(`.tab[data-pane-id="${sourceId}"] .tab-main`).click({ button: 'middle' });
    await page.waitForFunction(id => !document.querySelector(`.tab[data-pane-id="${id}"]`), sourceId);
    assert((await order()).includes(local), 'closing source leaves local reader open');
    assert.deepEqual(errors, []);
    await focus(local);
    await page.bringToFront();
    await page.screenshot({ path: 'artifacts/review8-ready.png' });
    fs.writeFileSync('artifacts/review8-presented.json', JSON.stringify({ pid: child.pid, exe, title,
      sha256: createHash('sha256').update(fs.readFileSync(exe)).digest('hex'), tests: [
        'local terminal file link', 'native Mermaid wheel/pan/Fit/Escape', 'modal app-shortcut isolation', 'focus return',
        'actual SSH Mermaid file', 'middle-close remote preview', 'middle-close source terminal preserves reader'], errors }, null, 2));
    console.log(`PASS: actual SSH diagram and native middle-close on both pane types; Review 8 ready, PID ${child.pid}`);
  } finally {
    await browser?.close();
    await ssh(`from pathlib import Path\np=Path(${JSON.stringify(remote)})\nif p.exists():\n (p/'remote.md').unlink(missing_ok=True)\n p.rmdir()`);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
