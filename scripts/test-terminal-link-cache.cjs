const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const { createServer } = await import('vite');
  const reservation = require('node:net').createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const server = await createServer({
    cacheDir: '../node_modules/.vite-link-cache-test',
    optimizeDeps: { entries: [path.resolve('src/terminal-file-links.mjs')] },
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
  });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      channel: process.env.VIBE99_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined) });
    for (const format of ['UMD', 'ESM']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/link-cache-test', route => route.fulfill({ contentType: 'text/html', body: '<div id="terminal"></div>' }));
      await page.goto(server.resolvedUrls.local[0] + 'link-cache-test');
      if (format === 'ESM') {
        const url = '/@fs/' + path.resolve('node_modules/@xterm/xterm/lib/xterm.mjs').replaceAll('\\', '/');
        await page.evaluate(async url => { window.Terminal = (await import(url)).Terminal; }, url);
      } else {
        await page.addScriptTag({ path: require.resolve('@xterm/xterm') });
      }
      await page.addStyleTag({ path: require.resolve('@xterm/xterm/css/xterm.css') });
      let count = 0;
      for (const oldKind of ['plain', 'OSC8']) {
        for (const scenario of ['leave-before-output', 'leave-after-output', 'same-row-blank', 'blank-to-link', 'stay-hovered', 'unchanged']) {
          for (const cellOffset of [0, 1]) {
            await page.mouse.move(500, 500);
            await page.evaluate(async ({ oldKind, initialBlank }) => {
              window.linkTest?.registration.dispose();
              window.linkTest?.terminal.dispose();
              document.querySelector('#terminal').replaceChildren();
              const { registerTerminalFileLinks, parseFileReference } = await import('/terminal-file-links.mjs');
              const state = window.linkTest = { activations: [] };
              const terminal = state.terminal = new Terminal({ cols: 40, rows: 10, linkHandler: {
                allowNonHttpProtocols: true,
                activate: (event, uri) => state.activations.push({ kind: 'web', uri, ctrl: event.ctrlKey }),
                hover: (_event, uri) => state.registration.setExplicitReference(parseFileReference(uri)),
                leave: () => state.registration.setExplicitReference(null),
              } });
              terminal.open(document.querySelector('#terminal'));
              state.registration = registerTerminalFileLinks(terminal,
                ref => state.activations.push({ kind: 'file', path: ref.path }));
              state.write = data => new Promise(resolve => terminal.write(data, resolve));
              await state.write(initialBlank ? 'NOT A LINK' : oldKind === 'plain' ? '/tmp/old.md' : '\x1b]8;;file:///tmp/old.md\x07OLD FILE\x1b]8;;\x07');
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }, { oldKind, initialBlank: scenario === 'blank-to-link' });
            const rect = await page.locator('.xterm-screen').boundingBox();
            const x = rect.x + rect.width / 40 * 3.5, y = rect.y + rect.height / 10 * 0.5;
            await page.mouse.move(x, y);
            await page.waitForFunction(initialBlank => Boolean(document.querySelector('.xterm-cursor-pointer')) !== initialBlank, scenario === 'blank-to-link');
            if (scenario === 'leave-before-output' || scenario === 'unchanged') await page.mouse.move(500, 500);
            if (scenario === 'same-row-blank') await page.mouse.move(rect.x + rect.width / 40 * 30.5, y);
            if (scenario !== 'unchanged') {
              await page.evaluate(() => window.linkTest.write(
                '\x1b[2J\x1b[H\x1b]8;;https://example.com/new\x07NEW HTTPS\x1b]8;;\x07'));
            }
            // Make stale-content tests independent of rendering races: the new
            // output has been visible for >500ms before pointer reentry.
            await page.evaluate(() => new Promise(resolve => {
              const start = performance.now();
              const frame = () => performance.now() - start > 550 ? resolve() : requestAnimationFrame(frame);
              requestAnimationFrame(frame);
            }));
            if (scenario === 'leave-after-output') await page.mouse.move(500, 500);
            // No different-row workaround and no delay after reentry. Cover both
            // the exact old cell and an adjacent cell on the rewritten row.
            await page.mouse.move(x + rect.width / 40 * cellOffset, y);
            await page.keyboard.down('Control');
            await page.mouse.click(x + rect.width / 40 * cellOffset, y);
            await page.keyboard.up('Control');
            const result = await page.evaluate(() => ({
              text: window.linkTest.terminal.buffer.active.getLine(0).translateToString(true),
              viewportY: window.linkTest.terminal.buffer.active.viewportY,
              activations: window.linkTest.activations,
            }));
            const label = `${format}: ${oldKind}, ${scenario}, cell offset ${cellOffset}`;
            assert.equal(result.viewportY, 0, label + ': no scrollback ambiguity');
            assert.equal(result.text, scenario === 'unchanged' ? (oldKind === 'plain' ? '/tmp/old.md' : 'OLD FILE') : 'NEW HTTPS', label);
            assert.deepEqual(result.activations, scenario === 'unchanged'
              ? [{ kind: 'file', path: '/tmp/old.md' }]
              : [{ kind: 'web', uri: 'https://example.com/new', ctrl: true }], label);
            count++;
          }
        }
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS: ${format} ${count} real pointer cases: plain/OSC8 rewrites, unchanged links, same/adjacent cells, blank cells on the same row, immediate click after reentry and stay-hovered`);
    }
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
