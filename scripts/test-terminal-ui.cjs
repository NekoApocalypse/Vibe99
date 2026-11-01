// Isolated Chromium test of the real renderer with a deterministic PTY bridge.
// Windows uses installed Edge; elsewhere run `npx playwright install chromium`.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 1421, strictPort: true } });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      channel: process.env.VIBE99_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined) });
    const page = await browser.newPage({ viewport: { width: 1600, height: 920 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/renderer.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() +
        '\nwindow.__test = { paneNodeMap, renderTabs, beginRenamePane, changePaneShell, recoverMouseInput, getPanes: () => panes, reorder: () => { panes.reverse(); renderTabs(); } };' });
    });
    await page.addInitScript(() => {
      window.__writes = [];
      window.__acks = [];
      window.__resizes = [];
      window.__sessions = new Map();
      window.vibe99 = {
        platform: 'win32', defaultCwd: 'C:/test', defaultTabTitle: 'test', cwdReady: Promise.resolve(),
        createTerminal: async p => window.__sessions.set(p.paneId, p.sessionId),
        writeTerminal: async p => window.__writes.push(p),
        acknowledgeTerminal: async p => window.__acks.push(p),
        resizeTerminal: async p => window.__resizes.push(p), destroyTerminal: async () => {}, closeWindow: async () => {},
        loadSettings: async () => ({}), saveSettings: async () => ({}),
        listShellProfiles: async () => ({ profiles: [], defaultProfile: '' }), detectShellProfiles: async () => [],
        writeClipboardText: async () => {}, readClipboardText: async () => '',
        onTerminalData: handler => { window.__data = handler; return () => {}; },
        onTerminalExit: handler => { window.__exit = handler; return () => {}; },
        onMenuAction: () => () => {},
      };
      let sequence = 0;
      window.__emit = async (data, paneId = 'p1', sessionId = window.__sessions.get(paneId)) => {
        window.__data({ paneId, sessionId, sequence: ++sequence, data });
        const node = window.__test.paneNodeMap.get(paneId);
        await new Promise(resolve => node.output.finish(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));
      };
    });
    await page.goto('http://127.0.0.1:1421');
    await page.waitForFunction(() => window.__test?.paneNodeMap.size === 3 &&
      [...window.__test.paneNodeMap.values()].every(n => n.sessionReady));

    const replacements = await page.evaluate(async () => {
      const list = document.getElementById('tabs-list');
      const button = list.querySelector('[data-pane-id="p2"] .tab-close');
      let removed = 0;
      const observer = new MutationObserver(records => {
        removed += records.filter(r => r.target === list && r.removedNodes.length).length;
      });
      observer.observe(list, { childList: true });
      await window.__emit('\x1b]2;Working\x07'.repeat(500));
      await window.__emit(Array.from({ length: 500 }, (_, i) => `\x1b]2;Working ${i}\x07`).join(''));
      const sameButton = button === list.querySelector('[data-pane-id="p2"] .tab-close');
      observer.disconnect();
      return { removed, sameButton };
    });
    assert.deepEqual(replacements, { removed: 0, sameButton: true });

    const rect = await page.locator('[data-pane-id="p2"] .tab-close').boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.evaluate(() => window.__emit('\x1b]2;Between down and up\x07'));
    await page.mouse.up();
    assert.equal(await page.locator('[data-pane-id="p2"]').count(), 0);
    console.log('PASS: repeated titles preserve controls and in-progress close clicks');

    await page.evaluate(() => window.__test.beginRenamePane(0));
    const input = page.locator('.tab-input');
    await input.fill('my unfinished rename');
    await page.evaluate(() => window.__emit('\x1b]2;Agent update\x07', 'p3'));
    assert.equal(await input.inputValue(), 'my unfinished rename');
    assert(await input.evaluate(el => document.activeElement === el));
    await input.press('Escape');
    await page.evaluate(() => window.__test.reorder());
    // The p3 button was created at a different index; its handler must use the id.
    await page.locator('[data-pane-id="p3"] .tab-close').click();
    assert.equal(await page.locator('[data-pane-id="p3"]').count(), 0);
    console.log('PASS: rename drafts survive output; reordered close buttons target the right pane');

    const redundantResizes = await page.evaluate(async () => {
      window.__resizes = [];
      for (let i = 0; i < 50; i++) window.dispatchEvent(new Event('resize'));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return window.__resizes.length;
    });
    assert.equal(redundantResizes, 0, 'Unchanged terminal sizes must not trigger PTY redraws');
    await page.setViewportSize({ width: 1400, height: 800 });
    await page.waitForFunction(() => window.__resizes.length > 0);
    assert(await page.evaluate(() => {
      const last = window.__resizes.at(-1);
      const terminal = window.__test.paneNodeMap.get(last.paneId).terminal;
      return last.cols === terminal.cols && last.rows === terminal.rows;
    }));
    console.log('PASS: unchanged resize events cause no PTY redraw; changed size reaches PTY');

    await page.evaluate(() => window.__emit('\x1b[?1000h\x1b[?1006h\r\nPS C:\\test> '));
    let screen = await page.locator('.xterm-screen').first().boundingBox();
    const clickTerminal = () => page.mouse.click(screen.x + 60, screen.y + 45);
    await clickTerminal();
    assert(await page.evaluate(() => window.__writes.some(p => p.data.startsWith('\x1b[<'))));
    await page.keyboard.press('Control+Shift+M');
    await page.waitForFunction(() => window.__test.paneNodeMap.get('p1').terminal.modes.mouseTrackingMode === 'none');
    await page.evaluate(() => { window.__writes = []; });
    await clickTerminal();
    assert.equal(await page.evaluate(() => window.__writes.length), 0);
    await page.evaluate(() => window.__emit('\x1b[?1000h\x1b[?1006h'));
    await clickTerminal();
    assert(await page.evaluate(() => window.__writes.some(p => p.data.startsWith('\x1b[<'))));
    await page.evaluate(async () => { window.__writes = []; await window.__emit('\x1b[?1006l'); });
    await clickTerminal();
    assert(await page.evaluate(() => window.__writes.some(p => p.binary && p.data.startsWith('\x1b[M'))));
    console.log('PASS: recovery shortcut stops leaked mouse input; SGR and binary reports work after re-enable');

    const oldId = await page.evaluate(() => window.__sessions.get('p1'));
    await page.evaluate(() => window.__test.changePaneShell('p1', null));
    await page.waitForFunction(old => window.__sessions.get('p1') !== old && window.__test.paneNodeMap.get('p1').sessionReady, oldId);
    await page.evaluate(async old => {
      await window.__emit('\x1b[?1000h\x1b]2;STALE\x07', 'p1', old);
      window.__exit({ paneId: 'p1', sessionId: old, exitCode: 0 });
    }, oldId);
    assert.equal(await page.evaluate(() => window.__test.paneNodeMap.get('p1').terminal.modes.mouseTrackingMode), 'none');
    assert(await page.evaluate(() => window.__test.paneNodeMap.get('p1').sessionReady));
    assert.notEqual(await page.locator('.tab-label').textContent(), 'STALE');
    console.log('PASS: replacing a shell resets modes and ignores old output/exit events');

    const lost = await page.evaluate(() => {
      for (const canvas of document.querySelectorAll('.xterm-screen canvas')) {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        const extension = gl?.getExtension('WEBGL_lose_context');
        if (extension) { extension.loseContext(); return true; }
      }
      return false;
    });
    assert(lost, 'WebGL must be available to exercise recovery');
    await page.waitForFunction(() => document.querySelector('.xterm-rows'));
    await page.evaluate(() => window.__emit('OUTPUT_AFTER_CONTEXT_LOSS'));
    assert((await page.locator('.xterm-rows').textContent()).includes('OUTPUT_AFTER_CONTEXT_LOSS'));
    assert.deepEqual(errors, []);
    console.log('PASS: WebGL context loss falls back to a working terminal renderer');
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
