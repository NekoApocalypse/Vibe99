// Full renderer integration with deterministic local PTY/workspace transports.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdirSync } = require('node:fs');
(async () => {
  const { createServer } = await import('vite');
  const reservation = require('node:net').createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const server = await createServer({ cacheDir: '../node_modules/.vite-review-test', optimizeDeps: { entries: [path.resolve('src/renderer.js')] }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'],
      channel: process.env.VIBE99_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined) });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [], dialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await page.route('**/renderer.js', async route => {
      const response = await server.transformRequest('/renderer.js');
      await route.fulfill({ contentType: 'application/javascript', body: response.code +
        '\nwindow.__review = { paneNodeMap, getPanes: () => panes };' });
    });
    await page.addInitScript(() => {
      const dataHandlers = new Set(), exitHandlers = new Set(), workspaceHandlers = new Set();
      const listen = (set, fn) => { set.add(fn); return () => set.delete(fn); };
      Object.assign(window, { __writes: [], __acks: [], __resizes: [], __creates: [], __destroys: [],
        __opens: [], __requests: [], __closes: [], __links: [], __saved: [], __holdCreate: false,
        __contexts: {}, __contextCalls: [], __windowCloses: 0 });
      let sequence = 0;
      window.__emit = (paneId, data) => {
        const p = window.__creates.findLast(p => p.paneId === paneId);
        const packet = { paneId, sessionId: p.sessionId, sequence: ++sequence, data };
        for (const handler of dataHandlers) handler(packet);
        return packet.sequence;
      };
      window.__emitExit = paneId => {
        const sessionId = window.__creates.findLast(p => p.paneId === paneId).sessionId;
        for (const handler of exitHandlers) handler({ paneId, sessionId, exitCode: 0 });
      };
      window.vibe99 = {
        platform: 'win32', defaultCwd: 'C:/review', defaultTabTitle: 'PowerShell', cwdReady: Promise.resolve(),
        createTerminal: async p => { window.__creates.push(p); if (window.__holdCreate && p.paneId.startsWith('preview-')) await new Promise(resolve => { window.__releaseCreate = resolve; }); },
        writeTerminal: async p => { window.__writes.push(p); }, acknowledgeTerminal: async p => { window.__acks.push(p); },
        resizeTerminal: async p => { window.__resizes.push(p); }, destroyTerminal: async p => { window.__destroys.push(p); },
        closeWindow: async () => { window.__windowCloses++; }, openExternalUrl: async url => { window.__links.push(url); },
        savePreviewAs: async value => { (window.__documentSaves ||= []).push(value); return 'C:/Downloads/export.md'; },
        terminalPreviewContext: async p => { window.__contextCalls.push(p); return window.__contexts[p.paneId] || { kind: 'local' }; },
        loadSettings: async () => ({ version: 4, session: { panes: [{ accent: '#9b5de5', cwd: 'C:/review', kind: 'terminal' }], focusedPaneIndex: 0 } }),
        saveSettings: async data => { window.__saved.push(data); return {}; },
        listShellProfiles: async () => ({ profiles: [], defaultProfile: '' }), detectShellProfiles: async () => [],
        detectWslProfiles: async () => [], addShellProfile: async () => ({}),
        writeClipboardText: async text => { window.__clipboard = text; }, readClipboardText: async () => '',
        captureClipboard: async () => window.__clipboardContent || { text: '' },
        getClipboardSnapshot: async () => ({ text: window.__clipboardContent?.text || '', hasImage: Boolean(window.__clipboardContent?.imageId) }),
        resolveImagePath: async p => {
          window.__imagePaths ||= []; window.__imagePaths.push(p);
          if (window.__holdImage) await new Promise(resolve => { window.__releaseImage = resolve; });
          if (window.__failImage) throw Error('Image transfer failed');
          return p.target ? '/tmp/vibe99-images-1000/image-fixture.png' : 'C:/image folder/image-fixture.png';
        },
        onTerminalData: fn => listen(dataHandlers, fn), onTerminalExit: fn => listen(exitHandlers, fn),
        onMenuAction: () => () => {}, onWorkspaceEvent: fn => listen(workspaceHandlers, fn),
        workspaceOpen: async p => { window.__opens.push(p); return { root: p.root }; },
        workspaceClose: async p => { window.__closes.push(p); },
        workspaceRequest: async p => {
          window.__requests.push(p);
          if (p.method === 'stat') return { stamp: 'v1' };
          if (p.method === 'read') return { path: p.args.path, stamp: 'v1', text:
            '# Vibe99 review workspace\n\nRead the project and run commands in one pane.\n\n## Verification checklist\n\n- [x] Local Markdown preview\n- [x] Scoped terminal recovery\n- [x] Safe browser links\n\n```javascript\nconst workspace = { preview: true, terminal: true };\nconsole.log(workspace);\n```\n\nInline math: $E = mc^2$.\n\n[Project documentation](https://example.com/docs)\n' };
          throw Error('Unexpected workspace method: ' + p.method);
        },
      };
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.__review?.paneNodeMap.get('p1')?.sessionReady);
    assert.deepEqual(await page.evaluate(() => {
      const stage = document.getElementById('stage');
      stage.scrollLeft = 200; stage.scrollTop = 200;
      return [stage.scrollLeft, stage.scrollTop];
    }), [0, 0], 'pane stage cannot be scrolled independently of pane transforms');
    async function emit(paneId, text) {
      const sequence = await page.evaluate(({ paneId, text }) => window.__emit(paneId, text), { paneId, text });
      await page.waitForFunction(sequence => window.__acks.some(p => p.sequence === sequence), sequence);
    }
    async function clickTerminalCell(row, column, ctrl = true, expectLink = true, paneId = 'p1') {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const point = await page.evaluate(({ row, column, paneId }) => {
        const n = window.__review.paneNodeMap.get(paneId), r = n.root.querySelector('.xterm-screen').getBoundingClientRect();
        return { x: r.x + (column + 0.5) * r.width / n.terminal.cols, y: r.y + (row + 0.5) * r.height / n.terminal.rows };
      }, { row, column, paneId });
      // Leave the row to invalidate xterm's explicit-link cache after a redraw.
      await page.mouse.move(point.x + 24, point.y + 50);
      await page.mouse.move(point.x, point.y);
      if (expectLink) {
        try { await page.waitForFunction(id => window.__review.paneNodeMap.get(id).root.querySelector('.xterm-cursor-pointer'), paneId, { timeout: 5000 }); }
        catch (error) {
          console.error(await page.evaluate(({ id, point }) => { const n=window.__review.paneNodeMap.get(id); return {
            id, point, cols:n.terminal.cols, rows:n.terminal.rows, text:n.terminal.buffer.active.getLine(0)?.translateToString(true),
            hit:document.elementFromPoint(point.x,point.y)?.outerHTML.slice(0,500), focused:document.activeElement?.className,
            scrolls: [...document.querySelectorAll('body,.app-shell,.stage-wrap,.stage,.pane')].map(e=>({name:e.className||e.tagName,left:e.scrollLeft,top:e.scrollTop})),
          }; }, { id:paneId, point }));
          throw error;
        }
      }
      else await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (ctrl) await page.keyboard.down('Control');
      await page.mouse.click(point.x, point.y);
      if (ctrl) await page.keyboard.up('Control');
    }
    await emit('p1', '\x1b[?1000;1006h\x1b[2J\x1b[H\x1b]8;;HTTPS://Example.com/osc\x07OSC LINK\x1b]8;;\x07\r\nhttps://example.com/plain\r\n\x1b]8;;file:///C:/secret\x07UNSAFE LINK\x1b]8;;\x07');
    await page.evaluate(() => { window.__writes = []; });
    await clickTerminalCell(0, 3, false);
    await page.waitForFunction(() => window.__links.length === 1);
    await clickTerminalCell(1, 7, false);
    await page.waitForFunction(() => window.__links.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__writes), [], 'plain and OSC8 URL clicks never enter a mouse-reporting TUI');
    await clickTerminalCell(2, 3, true, false);
    assert.deepEqual(await page.evaluate(() => window.__links), ['https://example.com/osc', 'https://example.com/plain']);
    assert.deepEqual(dialogs, []);
    const examples = ['https://www.saltdesignsystem.com/salt/foundations/density', 'https://www.saltdesignsystem.com/salt/patterns/navigation', 'https://www.saltdesignsystem.com/salt/patterns/button-bar', 'https://code.visualstudio.com/api/ux-guidelines/overview', 'https://blueprintjs.com/docs/'];
    for (const url of examples) {
      for (const hardWrap of [false, true]) {
      const cols = await page.evaluate(() => window.__review.paneNodeMap.get('p1').terminal.cols);
      await emit('p1', '\x1b[2J\x1b[H' + ' '.repeat(cols - 12) + (hardWrap ? url.slice(0, 12) + '\r\n' + url.slice(12) : url));
      const before = await page.evaluate(() => window.__links.length);
      await page.evaluate(() => { window.__writes = []; });
      await clickTerminalCell(1, 3, false);
      assert.equal(await page.evaluate(() => window.__links.at(-1)), url, 'soft/hard-wrapped URL continuation opens complete target');
      assert.equal(await page.evaluate(() => window.__links.length), before + 1, 'exactly one open per gesture');
      assert.deepEqual(await page.evaluate(() => window.__writes), []);
      await page.keyboard.down('Shift');
      await clickTerminalCell(1, 3, false);
      await page.keyboard.up('Shift');
      assert.equal(await page.evaluate(() => window.__links.length), before + 1, 'Shift selection does not open URL');
      await clickTerminalCell(1, 3, true);
      assert.equal(await page.evaluate(() => window.__links.length), before + 2, 'Ctrl-click remains supported');
      }
    }
    await emit('p1', '\x1b[?1000;1006l');
    console.log('PASS: single-click OSC8/plain URLs, five real documentation URLs across soft wraps, Ctrl-click compatibility, Shift selection, and no remote mouse reports');

    await emit('p1', '\x1b[?2004h');
    await page.evaluate(() => { window.__clipboardContent = { imageId: 'image-fixture.png' }; window.__writes = []; });
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => window.__writes.length > 0);
    assert.deepEqual(await page.evaluate(() => window.__writes.map(p => p.data)), ['\x1b[200~"C:/image folder/image-fixture.png"\x1b[201~']);
    await page.evaluate(() => { window.__clipboardContent = { text: 'plain text' }; window.__writes = []; });
    await page.keyboard.press('Control+Shift+v');
    await page.waitForFunction(() => window.__writes.length > 0);
    assert.deepEqual(await page.evaluate(() => window.__writes.map(p => p.data)), ['\x1b[200~plain text\x1b[201~']);
    await page.evaluate(() => { window.__clipboardContent = { imageId: 'image-fixture.png' }; window.__contexts.p1 = { kind: 'ssh', target: 'test-host' }; window.__writes = []; });
    await page.locator('.xterm-screen').click({ button: 'right', position: { x: 50, y: 60 } });
    await page.getByText('Paste Image', { exact: true }).click();
    await page.waitForFunction(() => window.__writes.length > 0);
    assert.deepEqual(await page.evaluate(() => window.__writes.map(p => p.data)), ['\x1b[200~/tmp/vibe99-images-1000/image-fixture.png\x1b[201~']);
    assert.equal(await page.evaluate(() => window.__imagePaths.at(-1).target), 'test-host');
    await page.evaluate(() => { window.__contexts.p1 = { kind: 'local' }; window.__writes = []; window.__holdImage = true; });
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => window.__releaseImage);
    await page.keyboard.press('Control+v');
    await page.locator('#tabs-add').click();
    const pasteOther = await page.evaluate(() => window.__review.getPanes().at(-1).id);
    await page.evaluate(() => { window.__releaseImage(); window.__holdImage = false; });
    await page.waitForFunction(() => !document.querySelector('.clipboard-paste-notice'));
    assert.deepEqual(await page.evaluate(() => window.__writes), [], 'image completion after changing panes must not type into either pane');
    await page.locator(`[data-pane-id="${pasteOther}"] .tab-close`).click();
    await page.evaluate(() => { window.__writes = []; window.__failImage = true; });
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => document.body.textContent.includes('Error: Image transfer failed'));
    assert.deepEqual(await page.evaluate(() => window.__writes), [], 'failed upload never pastes a local path remotely');
    await page.evaluate(() => { window.__failImage = false; window.__holdImage = true; window.__releaseImage = null; });
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => window.__releaseImage);
    await page.evaluate(() => { const n = window.__review.paneNodeMap.get('p1'); n.previewContextEpoch = (n.previewContextEpoch || 0) + 1; window.__releaseImage(); window.__holdImage = false; });
    await page.waitForFunction(() => !document.querySelector('.clipboard-paste-notice'));
    assert.deepEqual(await page.evaluate(() => window.__writes), [], 'return to local prompt cancels an in-flight remote paste');
    await page.evaluate(() => { window.__contexts.p1 = { kind: 'unknown' }; });
    await page.keyboard.press('Control+v');
    await page.getByRole('heading', { name: 'Paste image into this terminal' }).waitFor();
    await page.locator('input[name="target"]').fill('unavailable-test');
    await page.evaluate(() => { window.__failImage = true; });
    await page.getByRole('button', { name: 'Paste image', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.clipboard-paste-notice'));
    assert.equal(await page.evaluate(() => window.__review.paneNodeMap.get('p1').imagePasteTarget), undefined, 'failed manual target is not remembered');
    await page.evaluate(() => { window.__failImage = false; });
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Control+v');
    await page.getByRole('heading', { name: 'Paste image into this terminal' }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__writes), [], 'ambiguous or cancelled target cannot leak a file path');
    await page.evaluate(() => { window.__contexts.p1 = { kind: 'local' }; });
    await page.evaluate(() => { window.__creates = window.__creates.filter(p => p.paneId === 'p1'); window.__clipboardContent = { text: '' }; });
    console.log('PASS: Ctrl+V image, Ctrl+Shift+V text, context-menu image, correct SSH path, bracketed paste without Enter/Ctrl+V, and stale focus cancellation');

    const originalWidth = await page.evaluate(() => window.__review.paneNodeMap.get('p1').root.getBoundingClientRect().width);
    const originalCols = await page.evaluate(() => window.__review.paneNodeMap.get('p1').terminal.cols);
    const previewIdFor = file => page.evaluate(file => window.__review.getPanes().findLast(p => p.documentLocation?.path === file)?.id, file);
    const paneOrder = () => page.evaluate(() => window.__review.getPanes().map(p => p.id));
    async function settled() {
      await page.waitForFunction(() => [...window.__review.paneNodeMap.values()].every(n =>
        Math.abs(new DOMMatrix(getComputedStyle(n.root).transform).m41 - new DOMMatrix(n.root.style.transform).m41) < 0.1));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    async function focus(id) {
      await page.locator(`[data-pane-id="${id}"] .tab-main`).click();
      await settled();
    }
    async function assertOrdinaryGeometry() {
      await settled();
      assert.equal(await page.locator('#stage').evaluate(e=>e.scrollLeft), 0, 'focus and preview actions never shift the pane stage');
      const geometry = await page.evaluate(() => {
        const stage = document.getElementById('stage').getBoundingClientRect();
        const panes = window.__review.getPanes().map(p => {
          const n = window.__review.paneNodeMap.get(p.id), r = n.root.getBoundingClientRect(), css = getComputedStyle(n.root);
          return { id:p.id, x:r.left, width:r.width, focused:n.root.classList.contains('is-focused'), opacity:Number(css.opacity), clip:css.clipPath, zIndex:Number(css.zIndex), cols:n.terminal?.cols };
        });
        const focused = panes.find(p => p.focused);
        const hit = document.elementFromPoint(focused.x + focused.width / 2, stage.top + 220)?.closest('.pane');
        return { panes, stageLeft:stage.left, stageWidth:stage.width,
          focusedHit:[...window.__review.paneNodeMap.values()].find(n => n.root === hit)?.paneId };
      });
      const focusedIndex = geometry.panes.findIndex(p => p.focused);
      const step = geometry.panes.length === 1 ? 0 : Math.min(originalWidth, (geometry.stageWidth - originalWidth) / (geometry.panes.length - 1));
      assert.equal(geometry.focusedHit, geometry.panes[focusedIndex].id, 'foreground owns its full independent region');
      for (const [index, pane] of geometry.panes.entries()) {
        assert.equal(pane.width, originalWidth, `${pane.id} keeps ordinary pane width`);
        assert.equal(pane.opacity, pane.focused ? 1 : 0.7, `${pane.id} keeps ordinary focused/background opacity`);
        if (pane.cols !== undefined) assert.equal(pane.cols, originalCols, 'ordinary layout preserves terminal columns');
        assert.equal(pane.clip, 'none', 'background translucency and overlap remain unclipped');
        assert.equal(pane.zIndex, index + 1, 'stacking follows ordinary pane order');
        const left = index <= focusedIndex ? index * step : focusedIndex * step + originalWidth + (index - focusedIndex - 1) * step;
        assert(Math.abs(pane.x - geometry.stageLeft - left) < 1, `${pane.id} uses original stacking geometry`);
        const next = geometry.panes[index + 1];
        if (next && !pane.focused && step < originalWidth) assert(next.x < pane.x + pane.width, 'translucent backgrounds intentionally overlap');
      }
    }
    async function dragTo(id, index) {
      const before = await paneOrder(), expected = before.filter(p => p !== id); expected.splice(index, 0, id);
      const from = await page.locator(`[data-pane-id="${id}"] .tab-main`).boundingBox();
      const others = await page.locator('.tab').evaluateAll((tabs, id) => tabs.filter(tab => tab.dataset.paneId !== id)
        .map(tab => { const r=tab.getBoundingClientRect(); return { left:r.left, right:r.right }; }), id);
      const x = index === others.length ? others.at(-1).right + 5 : others[index].left + 2;
      await page.mouse.move(from.x + Math.min(35, from.width/2), from.y + from.height/2);
      await page.mouse.down(); await page.mouse.move(x, from.y + from.height/2, { steps:12 }); await page.mouse.up();
      assert.deepEqual(await paneOrder(), expected);
      for (const target of ['p1', id]) {
        await focus(target);
        assert.deepEqual(await paneOrder(), expected, 'focus must not snap a reader beside its source');
        await assertOrdinaryGeometry();
      }
    }
    const waitRead = async file => {
      try { await page.waitForFunction(file => window.__requests.some(p => p.method === 'read' && p.args.path === file), file, { timeout:5000 }); }
      catch (error) { console.error(await page.evaluate(() => ({ panes:window.__review.getPanes(), reads:window.__requests.filter(p=>p.method==='read'), opens:window.__opens }))); throw error; }
    };
    const clear = '\x1b[2J\x1b[H';
    await emit('p1', clear + '\x1b[?1000;1006hC:\\review\\README.md');
    await page.evaluate(() => { window.__writes = []; });
    await clickTerminalCell(0, 7, false);
    const workspace = page.locator('.preview-document');
    await workspace.getByRole('heading', { name: 'Vibe99 review workspace' }).waitFor();
    const firstCompanion = await previewIdFor('C:/review/README.md');
    assert.deepEqual(await paneOrder(), ['p1', firstCompanion]);
    assert.deepEqual(await page.evaluate(() => window.__writes), [], 'plain file click must not report mouse input');
    assert.equal(await page.evaluate(() => window.__creates.length), 1, 'a document never starts another terminal');
    assert.equal(await workspace.locator('input, select, textarea, .preview-toolbar, .preview-terminal-panel').count(), 0);
    assert.deepEqual(await workspace.getByRole('button').allTextContents(), ['Save As…', 'Close']);
    assert(!(await workspace.locator('.preview-document-retry').isVisible()));
    await workspace.getByRole('button', { name: 'Save Markdown as' }).click();
    await page.waitForFunction(() => window.__documentSaves?.length === 1);
    assert.equal(await page.evaluate(() => window.__documentSaves[0].filename), 'README.md');
    await assertOrdinaryGeometry();
    // The source is now behind the reader, with a live mouse-reporting TUI.
    const countBeforeActivate = (await paneOrder()).length;
    await clickTerminalCell(0, 7, false);
    assert.equal((await paneOrder()).length, countBeforeActivate, 'first click on inactive Markdown path only focuses');
    assert.deepEqual(await page.evaluate(() => window.__writes), [], 'focus gesture sends no TUI mouse input');
    assert(await page.locator('[data-pane-id="p1"]').evaluate(el => el.classList.contains('is-focused')));
    await emit('p1', clear + 'https://example.com/focus-only');
    await focus(firstCompanion);
    const linkCount = await page.evaluate(() => window.__links.length);
    await clickTerminalCell(0, 7, false);
    assert.equal(await page.evaluate(() => window.__links.length), linkCount, 'inactive URL click only focuses');
    await clickTerminalCell(0, 7, false);
    await page.waitForFunction(() => window.__links.includes('https://example.com/focus-only'));
    const beforeDocumentClick = await page.evaluate(() => window.__links.length);
    await workspace.getByRole('link', { name: 'Project documentation' }).click();
    assert.equal(await page.evaluate(() => window.__links.length), beforeDocumentClick, 'inactive preview link only focuses');
    await workspace.getByRole('link', { name: 'Project documentation' }).click();
    await page.waitForFunction(() => window.__links.includes('https://example.com/docs'));
    console.log('PASS: inactive terminal file/URL and preview links consume the activation click; the next active click opens normally');
    await focus('p1');
    // Use the same preventScroll focus path as the app. Direct DOM focus of
    // xterm's hidden cursor input can scroll the whole stage in Chromium.
    await page.evaluate(() => window.__review.paneNodeMap.get('p1').terminal.focus());
    await page.keyboard.type('source-still-types');
    await page.waitForFunction(() => window.__writes.filter(p => p.paneId === 'p1').map(p => p.data).join('').includes('source-still-types'));
    await emit('p1', clear + '\x1b]8;;file:///C:/review/second.md\x07OPEN SECOND\x1b]8;;\x07');
    await page.evaluate(() => { window.__writes = []; });
    await clickTerminalCell(0, 5, false);
    await waitRead('C:/review/second.md');
    const secondPreview = await previewIdFor('C:/review/second.md');
    assert.notEqual(secondPreview, firstCompanion);
    assert.deepEqual(await paneOrder(), ['p1', secondPreview, firstCompanion], 'new file inserts once, immediately after source');
    assert.deepEqual(await page.evaluate(() => window.__writes), [], 'OSC8 file click must not report mouse input');
    assert.equal(await page.evaluate(() => window.__creates.length), 1);
    for (const slot of [0, 1, 2, 0]) await dragTo(firstCompanion, slot);
    await focus('p1');
    await emit('p1', clear + 'C:\\review\\third.md');
    await clickTerminalCell(0, 7, false);
    await waitRead('C:/review/third.md');
    const thirdPreview = await previewIdFor('C:/review/third.md');
    assert.deepEqual(await paneOrder(), [firstCompanion, 'p1', thirdPreview, secondPreview]);
    await focus('p1');
    await emit('p1', clear + 'FOCUSED TERMINAL\r\n\r\nUnfocused previews keep their ordinary pane positions.\r\n');
    await settled();
    await assertOrdinaryGeometry();
    const closesBeforeMiddle = await page.evaluate(() => window.__closes.length);
    await page.locator(`[data-pane-id="${secondPreview}"] .tab-main`).click({ button: 'middle' });
    await page.waitForFunction(id => !window.__review.paneNodeMap.has(id), secondPreview);
    await page.waitForFunction(count => window.__closes.length === count + 1, closesBeforeMiddle);
    assert(await page.locator('[data-pane-id="p1"]').evaluate(el => el.classList.contains('is-focused')), 'middle close of background reader preserves focus');
    assert.equal(await page.evaluate(() => window.__review.paneNodeMap.get('p1').root.getBoundingClientRect().width), originalWidth);
    assert.equal(await page.evaluate(() => window.__destroys.filter(p => p.paneId === 'p1').length), 0);
    console.log('PASS: plain/OSC8 file clicks create ordinary panes; real drag first/middle/end and focus preserve order, width, columns and opacity');

    await page.evaluate(() => { window.__contexts.p1 = { kind: 'ssh', target: 'demo-ssh' }; });
    await focus('p1');
    await emit('p1', clear + '\x1b[?1000;1006l/home/dev/project/README.md');
    await clickTerminalCell(0, 8, false);
    await waitRead('/home/dev/project/README.md');
    assert(await page.evaluate(() => window.__opens.some(p => p.target === 'demo-ssh' && p.root === '/home/dev/project')));
    assert.equal(await page.locator('.preview-context-dialog').count(), 0, 'known direct SSH opens without asking');
    await page.locator('#tabs-add').click();
    await page.waitForFunction(() => window.__creates.length === 2);
    const other = await page.evaluate(() => window.__review.getPanes().find(p => p.kind !== 'preview' && p.id !== 'p1').id);
    await page.waitForFunction(id => window.__review.paneNodeMap.get(id)?.sessionReady, other);
    await page.evaluate(id => { window.__contexts[id] = { kind: 'unknown' }; }, other);
    await emit(other, clear + 'docs/notes.md');
    await clickTerminalCell(0, 4, false, true, other);
    const context = page.locator('.preview-context-dialog');
    await context.getByRole('heading', { name: 'Locate this pane’s files' }).waitFor();
    await context.locator('input[name=target]').fill('mapped-server');
    await context.locator('input[name=root]').fill('/srv/repo');
    await context.getByRole('button', { name: 'Open preview' }).click();
    await waitRead('/srv/repo/docs/notes.md');
    const otherCompanion = await previewIdFor('docs/notes.md');
    await focus(other);
    await emit(other, clear + 'README.md');
    await clickTerminalCell(0, 4, false, true, other);
    await waitRead('/srv/repo/README.md');
    assert.equal(await page.locator('.preview-context-dialog').count(), 0);
    assert.equal(await page.evaluate(id => window.__contextCalls.filter(p => p.paneId === id).length, other), 1, 'mapping is remembered for this terminal');
    const mappedPreview = await previewIdFor('README.md');
    assert.notEqual(mappedPreview, otherCompanion);
    await page.waitForFunction(() => window.__saved.at(-1)?.session.panes.length === 2 && window.__saved.at(-1).session.panes.every(p => p.kind !== 'preview'));
    const closeCount = await page.evaluate(() => window.__closes.length);
    const readersBeforeClose = await page.evaluate(() => window.__review.getPanes().filter(p => p.kind === 'preview').map(p => p.id));
    await page.locator(`[data-pane-id="${other}"] .tab-main`).click({ button: 'middle' });
    await page.waitForFunction(id => !window.__review.paneNodeMap.has(id), other);
    assert.deepEqual(await page.evaluate(() => window.__review.getPanes().filter(p => p.kind === 'preview').map(p => p.id)), readersBeforeClose);
    assert.equal(await page.evaluate(() => window.__closes.length), closeCount, 'closing a source does not close independent readers');
    assert(await page.evaluate(() => window.__review.paneNodeMap.get('p1').sessionReady));
    assert(await page.evaluate(id => window.__destroys.some(p => p.paneId === id), other));
    console.log('PASS: direct SSH context, one remembered location prompt, preview-free session save and independent reader lifetime');

    for (const id of readersBeforeClose.filter(id => ![firstCompanion, mappedPreview].includes(id))) {
      await page.locator(`[data-pane-id="${id}"] .tab-close`).click();
    }
    await focus('p1');
    await page.locator('#tabs-preview').click();
    await context.getByRole('heading', { name: 'Preview a file' }).waitFor();
    await context.locator('input[name=path]').fill('C:/review/manual.md');
    await context.getByRole('button', { name: 'Open preview' }).click();
    await waitRead('C:/review/manual.md');
    await emit('p1', clear + 'Updated project documentation:\r\n\r\nC:\\review\\README.md\r\n\r\nThe source terminal stays ready for your next command.\r\n\r\nPS C:\\review> ');
    const manual = await previewIdFor('C:/review/manual.md');
    await focus(manual);
    await assertOrdinaryGeometry();
    mkdirSync(path.resolve('artifacts'), { recursive: true });
    await page.screenshot({ path: path.resolve('artifacts/review7-ordinary-stacking.png') });
    assert.deepEqual(errors, []);
    assert.deepEqual(dialogs, []);
    console.log('PASS: manual file entry is a one-time dialog, document remains free of connection scaffolding');
    await page.evaluate(() => window.__emitExit('p1'));
    await page.waitForFunction(() => !window.__review.paneNodeMap.has('p1'));
    assert.equal(await page.evaluate(() => window.__windowCloses), 0);
    assert(await page.evaluate(id => window.__review.paneNodeMap.has(id), manual));
    await focus(manual); await assertOrdinaryGeometry();
    console.log('PASS: independent readers keep the window open after the last terminal exits; original opaque foreground and translucent overlapping backgrounds remain unclipped');
    for (const id of (await paneOrder()).filter(id => id !== manual)) {
      await page.locator(`[data-pane-id="${id}"] .tab-main`).click({ button: 'middle' });
    }
    await page.locator(`[data-pane-id="${manual}"] .tab-main`).click({ button: 'middle' });
    assert.deepEqual(await paneOrder(), [manual], 'middle click preserves the last pane just like its Close button');
    await page.locator('#tabs-add').click();
    const lastTerminal = (await paneOrder()).find(id => id !== manual);
    await page.locator(`[data-pane-id="${manual}"] .tab-main`).click({ button: 'middle' });
    await page.locator(`[data-pane-id="${lastTerminal}"] .tab-main`).click({ button: 'middle' });
    assert.deepEqual(await paneOrder(), [lastTerminal], 'last terminal is protected too');
    console.log('PASS: middle-click closes terminal and Markdown tabs once, cleans their resources, preserves background focus and protects the last pane of either type');
    console.log('Screenshot: ' + path.resolve('artifacts/review7-ordinary-stacking.png'));
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
