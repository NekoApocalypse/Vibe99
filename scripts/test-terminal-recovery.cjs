// Exercises the public recovery adapter against the installed xterm, including
// actual browser wheel dispatch, cursor restoration and split prompt markers.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ cacheDir: '../node_modules/.vite-recovery-test', optimizeDeps: { entries: [require('node:path').resolve('src/terminal-recovery.mjs')] }, server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      channel: process.env.VIBE99_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined) });
    const page = await browser.newPage();
    await page.route('**/recovery-test', route => route.fulfill({ contentType: 'text/html', body:
      '<div id="ancestor"><div id="terminal"></div></div>' }));
    await page.goto(server.resolvedUrls.local[0] + 'recovery-test');
    await page.addScriptTag({ path: require.resolve('@xterm/xterm') });
    await page.addStyleTag({ path: require.resolve('@xterm/xterm/css/xterm.css') });
    const result = await page.evaluate(async () => {
      const { createTerminalRecovery, promptMarker } = await import('/terminal-recovery.mjs');
      const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
      terminal.open(document.querySelector('#terminal'));
      const recovery = createTerminalRecovery({ terminal, getSessionId: () => 'browser-session' });
      terminal.attachCustomWheelEventHandler(recovery.handleWheel);
      let input = [], bubbled = 0;
      terminal.onData(data => { input.push(data); recovery.classifyInput(data); });
      document.querySelector('#ancestor').addEventListener('wheel', () => bubbled++);
      const write = data => new Promise(resolve => recovery.write(data, resolve));
      const recover = () => new Promise(resolve => recovery.recover(resolve));
      const wheel = () => {
        input = []; bubbled = 0;
        const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
        document.querySelector('.xterm-screen').dispatchEvent(event);
        return { input: [...input], bubbled, prevented: event.defaultPrevented };
      };
      await write('normal cursor');
      const before = { x: terminal.buffer.active.cursorX, y: terminal.buffer.active.cursorY };
      await write(promptMarker('browser-session'));
      const after = { x: terminal.buffer.active.cursorX, y: terminal.buffer.active.cursorY };
      await write('\x1b[?1049hALT');
      const healthy = wheel();
      await recover();
      const recovered = wheel(), preservedAlt = terminal.buffer.active.type;
      await write('\x1b[?1006h');
      const encodingOnly = wheel();
      await write('\x1b[?1000h');
      recovery.setDiagnostics(true);
      const tracking = wheel();
      const trackingDiagnostics = recovery.getDiagnostics();
      await recover();
      await write('\x1b[?1049l\x1b[?1049h');
      const reentered = wheel();
      await write(promptMarker('stale-session'));
      const stale = terminal.buffer.active.type;
      const marker = promptMarker('browser-session');
      await write(marker.slice(0, 12));
      await write(marker.slice(12) + 'PROMPT');
      const final = { type: terminal.buffer.active.type, x: terminal.buffer.active.cursorX,
        line: terminal.buffer.active.getLine(terminal.buffer.active.cursorY).translateToString(true) };
      recovery.dispose(); terminal.dispose();
      return { before, after, healthy, recovered, preservedAlt, encodingOnly, tracking, trackingDiagnostics, reentered, stale, final };
    });
    assert.deepEqual(result.before, result.after, 'normal prompt must not restore saved cursor');
    assert(result.healthy.input.some(data => /\x1b(?:\[|O)[AB]/.test(data)), 'healthy no-mouse alt retains xterm arrow fallback');
    assert.deepEqual(result.recovered, { input: [], bubbled: 0, prevented: true });
    assert.equal(result.preservedAlt, 'alternate');
    assert.deepEqual(result.encodingOnly, { input: [], bubbled: 0, prevented: true });
    assert(result.tracking.input.some(data => data.startsWith('\x1b[<')), 'actual mouse enable clears suppression');
    assert(result.trackingDiagnostics.some(record => record.classification === 'sgr-mouse'), 'diagnostics classify tracking wheel output');
    assert(result.reentered.input.length > 0, 'leaving alt clears suppression for the next app');
    assert.equal(result.stale, 'alternate');
    assert.equal(result.final.type, 'normal');
    assert.equal(result.final.line, 'normal cursorPROMPT');
    assert.equal(result.final.x, 'normal cursorPROMPT'.length);
    console.log('PASS: real xterm wheel fallback, scoped recovery, event containment, tracking re-enable, authenticated split prompt and cursor preservation');
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
