const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ cacheDir: '../node_modules/.vite-wrapped-links-test',
    optimizeDeps: { entries: [path.resolve('src/terminal-wrapped-links.mjs')] },
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen(); let browser;
  try {
    browser = await chromium.launch({ headless: true,
      channel: process.env.VIBE99_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined) });
    for (const format of ['UMD', 'ESM']) {
      const page = await browser.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/wrapped-test', route => route.fulfill({ contentType: 'text/html', body: '<div id="terminal"></div>' }));
      await page.goto(server.resolvedUrls.local[0] + 'wrapped-test', { timeout: 60000 });
      if (format === 'ESM') {
        await page.evaluate(async url => { window.Terminal = (await import(url)).Terminal; },
          '/@fs/' + path.resolve('node_modules/@xterm/xterm/lib/xterm.mjs').replaceAll('\\', '/'));
      } else await page.addScriptTag({ path: require.resolve('@xterm/xterm') });
      await page.addScriptTag({ path: require.resolve('@xterm/addon-web-links') });
      await page.addStyleTag({ path: require.resolve('@xterm/xterm/css/xterm.css') });
      for (const kind of ['file', 'url']) for (const mode of ['soft', 'margin', 'agy', 'padded-hard', 'padded-soft', 'padding-overflow']) {
        const target = kind === 'file' ? '/home/pb/project/docs/design-notes.md' : 'https://example.com/project/docs/design-notes';
        const separatorWrap = !['soft','margin'].includes(mode);
        const split = separatorWrap ? target.indexOf('-') + 1 : 30;
        const cols = mode === 'padding-overflow' ? split + 2 : separatorWrap ? 100 : 30;
        const indent = mode.startsWith('padded') || mode === 'padding-overflow' ? 12 : mode === 'agy' ? 2 : 0;
        const lastRow = mode === 'padding-overflow' ? 2 : 1;
        await page.evaluate(async ({ mode, target, cols, split, indent }) => {
          window.gestures?.dispose(); window.t?.dispose();
          const { registerTerminalFileLinks } = await import('/terminal-file-links.mjs');
          const { registerWrappedLinks } = await import('/terminal-wrapped-links.mjs');
          window.opened = []; window.input = [];
          const t = window.t = new Terminal({ cols, rows: 10, allowProposedApi: true });
          t.open(document.querySelector('#terminal'));
          const activate = (_e, uri) => opened.push(uri);
          registerWrappedLinks(t, { getGestures: () => window.gestures, openFile: ref => opened.push(ref.path), openUrl: activate });
          t.loadAddon(new WebLinksAddon.WebLinksAddon(activate, {
            hover: (_e, uri) => gestures.setExternalLink(e => activate(e, uri)), leave: () => gestures.setExternalLink(null),
          }));
          window.gestures = registerTerminalFileLinks(t, ref => opened.push(ref.path));
          t.onData(data => input.push(data));
          const prefixIndent = mode === 'margin' || mode === 'soft' ? '' : '  ';
          let boundary = '\r\n';
          if (mode === 'padded-hard' || mode === 'padding-overflow') boundary = '        \r\n';
          if (mode === 'padded-soft') boundary = ' '.repeat(cols - prefixIndent.length - split);
          const output = mode === 'soft' ? target : prefixIndent + target.slice(0, split) + boundary + ' '.repeat(indent) + target.slice(split);
          await new Promise(resolve => t.write('\x1b[?1000;1006h' + output, resolve));
        }, { mode, target, cols, split, indent });
        const box = await page.locator('.xterm-screen').boundingBox();
        const point = row => ({ x: box.x + box.width / cols * (row === lastRow ? indent + 1.5 : 3.5), y: box.y + box.height / 10 * (row + .5) });
        for (const row of [0, lastRow]) {
          const blank = point(5), cell = point(row);
          await page.mouse.move(blank.x, blank.y); await page.mouse.move(cell.x, cell.y);
          await page.waitForFunction(() => document.querySelector('.xterm-cursor-pointer'));
          await page.mouse.click(cell.x, cell.y);
        }
        assert.deepEqual(await page.evaluate(() => opened), [target, target], `${format} ${kind} ${mode}: both fragments`);
        assert.deepEqual(await page.evaluate(() => input), [], 'clicks never reach the TUI');
        // A redraw of only the continuation row must invalidate the entire link,
        // even while the pointer remains over its unchanged first row.
        const cell = point(0); await page.mouse.move(cell.x, cell.y);
        const updated = target.replace('notes', 'noted');
        await page.evaluate(async ({ updated, split, indent, lastRow }) => {
          await new Promise(resolve => t.write(`\x1b[${lastRow+1};1H\x1b[2K` + ' '.repeat(indent) + updated.slice(split), resolve));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          opened = []; input = [];
        }, { updated, split, indent, lastRow });
        await page.mouse.click(cell.x, cell.y);
        assert.deepEqual(await page.evaluate(() => opened), [updated], 'partial redraw cannot open stale target');
        assert.deepEqual(await page.evaluate(() => input), []);
        await page.keyboard.down('Shift'); await page.mouse.click(cell.x, cell.y); await page.keyboard.up('Shift');
        assert.deepEqual(await page.evaluate(() => opened), [updated], 'Shift remains selection');
      }
      assert.deepEqual(errors, []);
      console.log(`PASS: ${format} soft/margin/agy/padded wrapped paths and URLs, both fragments, partial-row redraws, Shift selection and no PTY mouse input`);
      await page.close();
    }
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
