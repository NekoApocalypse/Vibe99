// Windows integration test against a separately identified Vibe99 Review build.
// Usage: node scripts/test-native-terminal.cjs <path-to-review-exe>
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const assert = require('node:assert/strict');

(async () => {
  assert(process.argv[2], 'Pass the Vibe99 Review executable path');
  const port = 9237;
  const child = spawn(resolve(process.argv[2]), [], { windowsHide: true, stdio: 'ignore', env: {
    ...process.env, VIBE99_WINDOWS_SHELL: 'powershell.exe',
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  } });
  let browser, page;
  try {
    for (let i = 0; i < 120; i++) {
      try { await fetch(`http://127.0.0.1:${port}/json/version`); break; }
      catch { if (child.exitCode !== null) throw Error(`App exited: ${child.exitCode}`); await delay(500); }
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    page = context.pages()[0] || await context.waitForEvent('page');
    await page.waitForFunction(() => window.__TAURI__?.core && document.querySelectorAll('.tab').length >= 1);
    const title = await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().title());
    assert(title.includes('Vibe99 Review'), 'Only run native tests against the isolated Review build');
    await page.evaluate(async () => {
      window.__native = { packets: [], exits: [], errors: [], paused: false };
      await window.__TAURI__.event.listen('vibe99:terminal-data', ({ payload: p }) => {
        if (!p.paneId.startsWith('__test')) return;
        window.__native.packets.push(p);
        if (!window.__native.paused) {
          window.__TAURI__.core.invoke('terminal_acknowledge', {
            paneId: p.paneId, sessionId: p.sessionId, sequence: p.sequence,
          }).catch(e => window.__native.errors.push(String(e)));
        }
      });
      await window.__TAURI__.event.listen('vibe99:terminal-exit', ({ payload: p }) => window.__native.exits.push(p));
    });
    const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI__.core.invoke(command, args), { command, args });
    const create = (paneId, sessionId) => invoke('terminal_create', { paneId, sessionId, cols: 100, rows: 30, cwd: process.cwd(), shellProfileId: null });
    const write = (paneId, sessionId, data) => invoke('terminal_write', { paneId, sessionId, data: Buffer.from(data).toString('base64') });
    const text = sessionId => page.evaluate(id => window.__native.packets.filter(p => p.sessionId === id).map(p => p.data).join(''), sessionId);
    const waitText = (sessionId, marker) => page.waitForFunction(({ sessionId, marker }) =>
      window.__native.packets.filter(p => p.sessionId === sessionId).map(p => p.data).join('').includes(marker),
      { sessionId, marker }, { timeout: 20000 });

    await create('__test1', 'first');
    await waitText('first', 'PS ');
    const startup = await text('first');
    // ConPTY may normalize a combined DECRST to separate mode resets.
    const mouseOff = /\x1b\[\?(?:\d+;)*(?:9|1000|1002|1003)(?:;\d+)*l/;
    assert(mouseOff.test(startup), 'PowerShell prompt must send a mouse reset through real ConPTY');
    await write('__test1', 'first', "[Console]::Write(([char]27).ToString()+'[?1000h'+([char]27).ToString()+'[?1006h'); Start-Sleep -Milliseconds 150; Write-Output ('RETURN_'+'TO_PROMPT')\r");
    await waitText('first', 'RETURN_TO_PROMPT');
    await delay(300);
    const after = await text('first');
    assert(mouseOff.test(after.slice(after.lastIndexOf('RETURN_TO_PROMPT'))), 'Returning to local prompt must reset mouse reporting');
    console.log('PASS: actual PowerShell/ConPTY prompt recovers mouse reporting');

    await page.evaluate(() => { window.__native.paused = true; window.__native.packets = []; });
    await write('__test1', 'first', "1..12000 | ForEach-Object { [Console]::WriteLine(('x' * 120)) }; Write-Output ('FLOOD_'+'DONE')\r");
    await delay(1000);
    const queued = await page.evaluate(() => ({
      packets: window.__native.packets.length,
      bytes: window.__native.packets.reduce((n, p) => n + new TextEncoder().encode(p.data).length, 0),
      sequence: window.__native.packets.at(-1)?.sequence,
    }));
    assert(queued.packets > 0 && queued.packets <= 64);
    assert(queued.bytes <= 256 * 1024);
    await delay(300);
    assert.equal(await page.evaluate(() => window.__native.packets.length), queued.packets, 'No ACK means bounded output');
    // A stale generation cannot release this pane's credits.
    await invoke('terminal_acknowledge', { paneId: '__test1', sessionId: 'stale', sequence: queued.sequence });
    await delay(150);
    assert.equal(await page.evaluate(() => window.__native.packets.length), queued.packets);
    await page.evaluate(() => { window.__native.paused = false; });
    await invoke('terminal_acknowledge', { paneId: '__test1', sessionId: 'first', sequence: queued.sequence });
    await waitText('first', 'FLOOD_DONE');
    console.log(`PASS: real PTY stops at ${queued.bytes} bytes / ${queued.packets} packets and resumes without losing tail output`);

    await write('__test1', 'first', "Write-Output ('FINAL_'+'TAIL'); exit 0\r");
    await page.waitForFunction(() => window.__native.exits.some(p => p.sessionId === 'first'), null, { timeout: 15000 });
    assert((await text('first')).includes('FINAL_TAIL'));
    console.log('PASS: natural process exit drains output and emits exit without hanging');

    await create('__test2', 'old');
    await waitText('old', 'PS ');
    await page.evaluate(() => { window.__native.paused = true; window.__native.packets = []; });
    await write('__test2', 'old', "while ($true) { [Console]::WriteLine(('z' * 120)) }\r");
    await delay(500);
    await invoke('terminal_destroy', { paneId: '__test2', sessionId: 'old' });
    await page.evaluate(() => { window.__native.paused = false; });
    await create('__test2', 'new');
    await waitText('new', 'PS ');
    await invoke('terminal_destroy', { paneId: '__test2', sessionId: 'old' });
    await write('__test2', 'new', "Write-Output ('NEW_'+'ALIVE')\r");
    await waitText('new', 'NEW_ALIVE');
    await invoke('terminal_destroy', { paneId: '__test2', sessionId: 'new' });
    assert.deepEqual(await page.evaluate(() => window.__native.errors), []);
    console.log('PASS: closing a backpressured PTY is nonblocking; stale close cannot kill replacement');
    await page.screenshot({ path: 'artifacts/native-review.png' });
  } finally {
    if (page) await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(() => {});
    await browser?.close().catch(() => {});
    if (child.exitCode === null) child.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
