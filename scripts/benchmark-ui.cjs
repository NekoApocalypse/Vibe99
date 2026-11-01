// Repeatable renderer workload; timings are local diagnostics, not CI thresholds.
// Usage: node scripts/benchmark-ui.cjs [output.json]
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 1422, strictPort: true } });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      channel: process.env.VIBE99_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined) });
    const page = await browser.newPage({ viewport: { width: 1600, height: 920 } });
    await page.route('**/renderer.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
        window.__counts = { renders: 0, tabRenders: 0, hintChanges: 0 };
        const originalRender = render, originalTabs = renderTabs;
        render = (...args) => { window.__counts.renders++; return originalRender(...args); };
        renderTabs = (...args) => { window.__counts.tabRenders++; return originalTabs(...args); };
        new MutationObserver(records => { window.__counts.hintChanges += records.length; })
          .observe(statusHintEl, { childList: true });
        window.__perf = { addPane, focusPane, enterNavigationMode, paneNodeMap,
          getFocused: () => focusedPaneId, getPanes: () => panes };
      ` });
    });
    await page.addInitScript(() => {
      window.vibe99 = {
        platform: 'win32', defaultCwd: 'C:/benchmark', defaultTabTitle: 'benchmark', cwdReady: Promise.resolve(),
        createTerminal: async () => {}, writeTerminal: async () => {}, acknowledgeTerminal: async () => {},
        resizeTerminal: async () => {}, destroyTerminal: async () => {}, closeWindow: async () => {},
        // Pin appearance so changing project defaults does not change the benchmark workload.
        loadSettings: async () => ({ version: 4, ui: { fontSize: 13, paneWidth: 720,
          paneOpacity: 0.8, paneMaskOpacity: 0.75, breathingAlertEnabled: true } }), saveSettings: async () => ({}),
        listShellProfiles: async () => ({ profiles: [], defaultProfile: '' }), detectShellProfiles: async () => [],
        writeClipboardText: async () => {}, readClipboardText: async () => '',
        onTerminalData: () => () => {}, onTerminalExit: () => () => {}, onMenuAction: () => () => {},
      };
    });
    await page.goto('http://127.0.0.1:1422');
    await page.waitForFunction(() => window.__perf?.paneNodeMap.size >= 3);
    await page.evaluate(() => { while (window.__perf.getPanes().length < 8) window.__perf.addPane(); });
    await page.waitForFunction(() => [...window.__perf.paneNodeMap.values()].every(n => n.sessionReady));
    await page.evaluate(async () => {
      const content = Array.from({ length: 5000 }, (_, i) => `line ${i}: ${'output '.repeat(12)}\r\n`).join('');
      await Promise.all([...window.__perf.paneNodeMap.values()].map(node => {
        clearTimeout(node.startupTimer);
        return new Promise(resolve => node.terminal.write(content, resolve));
      }));
      window.__perf.focusPane('p1');
    });
    await delay(300);
    const repeatedFocus = await page.evaluate(async () => {
      window.__counts = { renders: 0, tabRenders: 0, hintChanges: 0 };
      const start = performance.now();
      for (let i = 0; i < 100; i++) window.__perf.focusPane('p1');
      const durationMs = performance.now() - start;
      await Promise.resolve();
      return { ...window.__counts, durationMs };
    });
    const modeChange = await page.evaluate(() => {
      window.__perf.enterNavigationMode();
      window.__counts.renders = 0;
      window.__perf.focusPane('p2');
      return { renders: window.__counts.renders };
    });
    // Observe focus from the pointer-up event, excluding automation overhead.
    await page.evaluate(() => {
      window.__clickLatency = null;
      window.addEventListener('pointerup', () => {
        const start = performance.now();
        const check = () => {
          if (window.__perf.getFocused() === 'p1') window.__clickLatency = performance.now() - start;
          else requestAnimationFrame(check);
        };
        queueMicrotask(check);
      }, { once: true, capture: true });
    });
    await page.locator('[data-pane-id="p1"] .tab-main').click();
    await page.waitForFunction(() => window.__clickLatency !== null);
    const clickLatencyMs = await page.evaluate(() => window.__clickLatency);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const before = await metrics();
    for (let i = 0; i < 10; i++) {
      await page.evaluate(i => window.__perf.focusPane(i % 2 ? 'p1' : 'p8'), i);
      await delay(200);
    }
    const after = await metrics();
    const movement = {};
    for (const key of ['LayoutCount', 'LayoutDuration', 'RecalcStyleCount', 'TaskDuration']) movement[key] = after[key] - before[key];
    await delay(300);
    const events = [];
    cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
    await page.evaluate(() => document.querySelectorAll('.pane:not(.is-focused)').forEach(el => el.classList.add('has-pending-activity')));
    await delay(1600);
    const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    await completed;
    const result = {
      workload: '8 panes, 5000 lines each; 100 same-pane focuses, 10 animated switches, 1.6s background alerts',
      repeatedFocus, modeChange, clickLatencyMs, movement,
      alertPaintEvents: events.filter(e => e.name === 'Paint').length,
    };
    console.log(JSON.stringify(result, null, 2));
    if (process.argv[2]) {
      mkdirSync(dirname(resolve(process.argv[2])), { recursive: true });
      writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
    }
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
