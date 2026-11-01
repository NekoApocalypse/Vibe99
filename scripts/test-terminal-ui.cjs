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
        `
        const originalRender = render, originalTabs = renderTabs;
        window.__renderCalls = 0; window.__tabRenderCalls = 0;
        render = (...args) => { window.__renderCalls++; return originalRender(...args); };
        renderTabs = (...args) => { window.__tabRenderCalls++; return originalTabs(...args); };
        window.__test = { paneNodeMap, renderTabs, beginRenamePane, changePaneShell, recoverMouseInput,
          focusPane, enterNavigationMode, updateStatus, shortcuts: ShortcutsRegistry,
          getFocused: () => focusedPaneId, getPanes: () => panes,
          reorder: () => { panes.reverse(); renderTabs(); } };
        ` });
    });
    await page.addInitScript(() => {
      window.__writes = [];
      window.__acks = [];
      window.__resizes = [];
      window.__sessions = new Map();
      window.__discoveryCalls = 0;
      window.vibe99 = {
        platform: 'win32', defaultCwd: 'C:/test', defaultTabTitle: 'test', cwdReady: Promise.resolve(),
        createTerminal: async p => window.__sessions.set(p.paneId, p.sessionId),
        writeTerminal: async p => window.__writes.push(p),
        acknowledgeTerminal: async p => window.__acks.push(p),
        resizeTerminal: async p => window.__resizes.push(p), destroyTerminal: async () => {}, closeWindow: async () => {},
        loadSettings: async () => ({ version: 4, session: {
          panes: ['#9b5de5', '#ef476f', '#fdab0f'].map(accent => ({ accent, cwd: 'C:/test' })),
          focusedPaneIndex: 0,
        } }), saveSettings: async () => ({}),
        listShellProfiles: async () => ({ profiles: [], defaultProfile: '' }), detectShellProfiles: async () => [],
        detectWslProfiles: () => { window.__discoveryCalls++; return new Promise((resolve, reject) => { window.__finishDiscovery = resolve; window.__failDiscovery = reject; }); },
        addShellProfile: async () => ({}),
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

    await page.evaluate(() => {
      const tab = document.querySelector('[data-pane-id="p2"] .tab-main');
      const rect = tab.getBoundingClientRect();
      const props = { bubbles: true, button: 0, pointerId: 99, clientX: rect.x + 30, clientY: rect.y + 12 };
      tab.dispatchEvent(new PointerEvent('pointerdown', props));
      window.dispatchEvent(new PointerEvent('pointerup', props));
    });
    assert.equal(await page.evaluate(() => window.__test.getFocused()), 'p2', 'Tab switches at pointer-up without a double-click timer');
    await page.locator('[data-pane-id="p2"] .tab-main').dblclick();
    assert(await page.locator('.tab-input').isVisible(), 'Native double-click must still rename');
    await page.locator('.tab-input').press('Escape');

    assert.deepEqual(await page.evaluate(() => {
      window.__test.enterNavigationMode();
      window.__renderCalls = 0;
      window.__test.focusPane('p1');
      const modeRenders = window.__renderCalls;
      const hint = document.querySelector('#status-hint').firstChild;
      window.__renderCalls = 0;
      for (let i = 0; i < 100; i++) window.__test.focusPane('p1');
      for (let i = 0; i < 10; i++) window.__test.focusPane(i % 2 ? 'p1' : 'p2');
      return { modeRenders, renders: window.__renderCalls, sameHints: hint === document.querySelector('#status-hint').firstChild };
    }), { modeRenders: 1, renders: 10, sameHints: true });
    await page.evaluate(() => {
      window.__test.shortcuts.updateKeyboardShortcut('recover-mouse', { key: 'r', modifiers: ['ctrl', 'shift'] });
      window.__test.updateStatus();
    });
    assert((await page.locator('#status-hint').textContent()).includes('Ctrl+Shift+R'));
    await page.evaluate(() => { window.__test.shortcuts.resetShortcutsToDefaults(); window.__test.updateStatus(); });
    console.log('PASS: immediate tab selection, native double-click rename, single focus render and cached shortcut hints');

    const dragResult = await page.evaluate(async () => {
      const tab = document.querySelector('[data-pane-id="p1"] .tab-main');
      const rect = tab.getBoundingClientRect();
      const props = { bubbles: true, button: 0, pointerId: 100, clientX: rect.x + 30, clientY: rect.y + 12 };
      tab.dispatchEvent(new PointerEvent('pointerdown', props));
      window.__tabRenderCalls = 0;
      for (let i = 0; i < 100; i++) window.dispatchEvent(new PointerEvent('pointermove', { ...props, clientX: 180 + i }));
      const immediate = window.__tabRenderCalls;
      await new Promise(resolve => requestAnimationFrame(resolve));
      const frame = window.__tabRenderCalls;
      // End at a different slot before the next drag frame can run.
      window.dispatchEvent(new PointerEvent('pointermove', { ...props, clientX: 600 }));
      window.dispatchEvent(new PointerEvent('pointerup', { ...props, clientX: 600 }));
      const order = window.__test.getPanes().map(p => p.id);
      // Restore the original order for the remaining interaction scenarios.
      tab.dispatchEvent(new PointerEvent('pointerdown', { ...props, clientX: 330 }));
      window.dispatchEvent(new PointerEvent('pointermove', { ...props, clientX: 5 }));
      window.dispatchEvent(new PointerEvent('pointerup', { ...props, clientX: 5 }));
      return { immediate, frame, order };
    });
    assert.deepEqual(dragResult, { immediate: 0, frame: 1, order: ['p2', 'p3', 'p1'] });
    assert.deepEqual(await page.evaluate(() => window.__test.getPanes().map(p => p.id)), ['p1', 'p2', 'p3']);
    console.log('PASS: 100 drag moves coalesce into one frame and pointer-up uses the final drop position');

    const streaming = await page.evaluate(async () => {
      const node = window.__test.paneNodeMap.get('p1');
      let mutations = 0;
      const observer = new MutationObserver(records => { mutations += records.length; });
      observer.observe(node.startupNotice, { attributes: true });
      for (let i = 0; i < 1000; i++) window.__data({ paneId: 'p1', sessionId: node.sessionId, sequence: i, data: 'x' });
      await new Promise(resolve => node.output.finish(resolve));
      observer.disconnect();
      return { mutations, columns: node.terminal.cols, rows: node.terminal.rows };
    });
    assert.equal(streaming.mutations, 0, 'Output must not mutate the startup overlay for every chunk');
    assert(streaming.columns > 0 && streaming.rows > 0);
    console.log('PASS: 1000 output chunks parse without repeated startup-overlay DOM mutations');

    assert.equal(await page.evaluate(() => window.__discoveryCalls), 0, 'Startup must never discover WSL');
    for (const width of [1600, 960]) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(() => window.__emit('\x1b]2;' + 'Long title '.repeat(100) + '\x07'));
      for (const id of ['tabs-add', 'tabs-settings', 'tabs-fullscreen']) {
        const rect = await page.locator(`#${id}`).boundingBox();
        assert(rect && rect.x >= 0 && rect.x + rect.width <= width, `${id} must fit at width ${width}`);
      }
    }
    await page.setViewportSize({ width: 1600, height: 920 });
    await page.locator('#tabs-settings').click();
    await page.locator('#shell-profiles-settings-btn').click();
    await page.locator('#discover-wsl').click();
    assert(await page.locator('#discover-wsl').isDisabled());
    await page.locator('.settings-modal-close').click();
    await page.locator('#tabs-add').click();
    await page.waitForFunction(() => window.__test.paneNodeMap.size === 4);
    await page.locator('.tab-close').last().click();
    await page.evaluate(() => window.__failDiscovery('WSL discovery timed out. Local shells are still available.'));
    await page.locator('#tabs-settings').click();
    await page.locator('#shell-profiles-settings-btn').click();
    assert((await page.locator('#wsl-discovery-status').textContent()).includes('timed out'));
    await page.locator('.settings-modal-close').click();
    console.log('PASS: controls stay visible at minimum width; stalled discovery cannot block adding/closing panes');

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

    await page.evaluate(async () => {
      const create = window.vibe99.createTerminal;
      window.vibe99.createTerminal = async payload => {
        if (payload.shellProfileId === 'broken-wsl') throw Error('WSL unavailable');
        return create(payload);
      };
      await window.__test.changePaneShell('p1', 'broken-wsl');
    });
    assert(await page.locator('.shell-startup-notice').isVisible());
    assert.equal(await page.locator('.tab').count(), 1, 'A shell error must not close the last pane/window');
    await page.getByRole('button', { name: 'Use local shell', exact: true }).click();
    await page.waitForFunction(() => window.__test.paneNodeMap.get('p1').sessionReady);
    await page.evaluate(() => window.__emit('PS C:\\test> '));
    assert(!(await page.locator('.shell-startup-notice').isVisible()));
    console.log('PASS: failed explicit shell stays in its pane and can recover to a local shell');

    await page.addInitScript(() => {
      window.vibe99.loadSettings = async () => { throw Error('Simulated unreadable settings'); };
    });
    await page.reload();
    await page.waitForFunction(() => window.__sessions.size === 4);
    assert.equal(await page.locator('#font-size-input').inputValue(), '16');
    assert.equal(await page.locator('#pane-width-input').inputValue(), '1210');
    assert.equal(Number(await page.locator('#pane-opacity-input').inputValue()), 0.7);
    assert.equal(Number(await page.locator('#pane-mask-alpha-input').inputValue()), 0.03);
    assert(!(await page.locator('#breathing-alert-toggle').isChecked()));
    await page.locator('#tabs-settings').click();
    assert(await page.locator('#settings-panel').isVisible());
    console.log('PASS: unreadable settings use the author’s defaults, four panes and working controls');
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
