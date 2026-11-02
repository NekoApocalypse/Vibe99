const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const { createServer } = await import('vite');
  const reservation = require('node:net').createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const server = await createServer({ cacheDir: '../node_modules/.vite-file-links-test', optimizeDeps: { entries: [require('node:path').resolve('src/terminal-file-links.mjs')] }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      channel: process.env.VIBE99_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined) });
    const page = await browser.newPage();
    await page.route('**/file-links-test', route => route.fulfill({ contentType: 'text/html', body: '<div id="terminal"></div>' }));
    await page.goto(server.resolvedUrls.local[0] + 'file-links-test');
    await page.addScriptTag({ path: require.resolve('@xterm/xterm') });
    await page.addStyleTag({ path: require.resolve('@xterm/xterm/css/xterm.css') });
    const ranges = await page.evaluate(async () => {
      const { registerTerminalFileLinks, parseFileReference } = await import('/terminal-file-links.mjs');
      const terminal = new Terminal({ cols: 20, rows: 12, allowProposedApi: true,
        linkHandler: { allowNonHttpProtocols: true,
          activate: () => { throw Error('File click should be handled before mouse reporting'); },
          hover: (_event, uri) => {
            window.__fileTest.hoveredUri = uri;
            window.__fileTest.registration.setExplicitReference(parseFileReference(uri));
          },
          leave: () => {
            window.__fileTest.hoveredUri = null;
            window.__fileTest.registration.setExplicitReference(null);
          },
        },
      });
      terminal.open(document.querySelector('#terminal'));
      window.__fileTest = { terminal, opened: [], input: [] };
      terminal.onData(data => window.__fileTest.input.push(data));
      const register = terminal.registerLinkProvider.bind(terminal);
      terminal.registerLinkProvider = provider => { window.__fileTest.provider = provider; return register(provider); };
      window.__fileTest.registration = registerTerminalFileLinks(terminal, ref => window.__fileTest.opened.push(ref));
      // CJK prefix, a wrapped quoted path, and a wide glyph wrapping early.
      await new Promise(resolve => terminal.write('中文 `docs/design notes.md`:12\r\n' + 'x'.repeat(19) + '中\r\nREADME.md\r\nhttps://example.com/a.md', resolve));
      const read = y => { let links; window.__fileTest.provider.provideLinks(y, value => { links = value; }); return (links || []).map(({ text, range }) => ({ text, range })); };
      return { first: read(1), wrapped: read(2), plain: read(5), web: read(6) };
    });
    assert.deepEqual(ranges.first, [{ text: '`docs/design notes.md`:12', range: { start: { x: 6, y: 1 }, end: { x: 10, y: 2 } } }]);
    assert.deepEqual(ranges.wrapped, ranges.first);
    assert.equal(ranges.plain[0].text, 'README.md');
    assert.deepEqual(ranges.web, []);
    // Enable mouse tracking: clicking a file must not inject a mouse report.
    await page.evaluate(() => new Promise(resolve => window.__fileTest.terminal.write('\x1b[?1000;1006h', resolve)));
    const rect = await page.locator('.xterm-screen').boundingBox();
    await page.mouse.move(rect.x + rect.width / 20 * 8.5, rect.y + rect.height / 12 * 0.5);
    await page.waitForFunction(() => document.querySelector('.xterm-cursor-pointer'));
    await page.evaluate(() => { window.__fileTest.input = []; });
    await page.mouse.click(rect.x + rect.width / 20 * 8.5, rect.y + rect.height / 12 * 0.5);
    assert.deepEqual(await page.evaluate(() => window.__fileTest.opened), [{ path: 'docs/design notes.md', authority: null, scheme: 'path', line: 12 }]);
    assert.deepEqual(await page.evaluate(() => window.__fileTest.input), []);
    const earlyWrap = await page.evaluate(async () => {
      const { terminal, provider } = window.__fileTest;
      terminal.reset();
      await new Promise(resolve => terminal.write('x'.repeat(13) + ' docs/中文.md', resolve));
      let links; provider.provideLinks(1, value => { links = value; });
      return links.map(({ text, range }) => ({ text, range }));
    });
    assert.deepEqual(earlyWrap, [{ text: 'docs/中文.md', range: { start: { x: 15, y: 1 }, end: { x: 7, y: 2 } } }]);
    await page.evaluate(() => new Promise(resolve => window.__fileTest.terminal.write(
      '\x1b[2J\x1b[H\x1b[?1000;1006h\x1b]8;;file:///tmp/explicit.md\x07OPEN FILE\x1b]8;;\x07', resolve)));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const explicitRect = await page.locator('.xterm-screen').boundingBox();
    // xterm caches provider results per hovered row. Leaving the element alone
    // does not invalidate that cache after rewriting the same row. Enter a blank
    // terminal row first, as a pointer moving between output lines would do.
    await page.mouse.move(explicitRect.x + explicitRect.width / 20 * 3.5, explicitRect.y + explicitRect.height / 12 * 3.5);
    await page.mouse.move(explicitRect.x + explicitRect.width / 20 * 3.5, explicitRect.y + explicitRect.height / 12 * 0.5);
    await page.waitForFunction(() => window.__fileTest.hoveredUri === 'file:///tmp/explicit.md' && document.querySelector('.xterm-cursor-pointer'));
    await page.evaluate(() => { window.__fileTest.input = []; });
    await page.mouse.click(explicitRect.x + explicitRect.width / 20 * 3.5, explicitRect.y + explicitRect.height / 12 * 0.5);
    assert.deepEqual(await page.evaluate(() => window.__fileTest.opened.at(-1)), { path: '/tmp/explicit.md', authority: null, scheme: 'file' });
    assert.deepEqual(await page.evaluate(() => window.__fileTest.input), []);
    await page.evaluate(() => window.__fileTest.registration.dispose());
    console.log('PASS: real xterm CJK/wrapped links, URL exclusion and plain/OSC8 file clicks without PTY mouse input');
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
