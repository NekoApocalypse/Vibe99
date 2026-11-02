// Real browser renderer tests with a deterministic, read-only workspace service.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    cacheDir: '../node_modules/.vite-preview-test',
    optimizeDeps: { entries: [require('node:path').resolve('src/preview-workspace.js')] },
    server: { host: '127.0.0.1', port: 1423, strictPort: true },
  });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.VIBE99_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined) });
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/preview-test', route => route.fulfill({ contentType: 'text/html', body: '<html><head><style>body{margin:0;background:#151a1c}#test{height:900px}*{box-sizing:border-box;margin:0}</style></head><body><div id="test"></div><script type="module">import {createPreviewWorkspace} from "/preview-workspace.js"; window.createPreviewWorkspace=createPreviewWorkspace;</script></body></html>' }));
    await page.goto('http://127.0.0.1:1423/preview-test');
    await page.waitForFunction(() => window.createPreviewWorkspace);
    await page.evaluate(() => {
      window.calls = []; window.fileStamp = '1'; window.terminalDisposals = 0;
      window.markdown = '# Preview review\n\nCode, **math**, diagrams, images, and links.\n\n## Heading\n\n## Heading\n\n| Feature | Status |\n| --- | --- |\n| Markdown | Ready |\n\n```javascript\nconst ready = true;\n```\n\n$$\nx^2 + y^2 = z^2\n$$\n\n```mermaid\nflowchart LR\n A[Local or SSH] --> B[Read-only preview]\n B --> C[Terminal]\n```\n\n![pixel](pixel.png)\n\n[Next](next.md) [External](https://example.com)\n\n<script>window.previewScriptExecuted = true</script>\n';
      window.api = {
        defaultRoot: 'C:/docs',
        async open(args) { calls.push({ method: 'open', ...args }); return { root: args.root }; },
        async close(args) { calls.push({ method: 'close', ...args }); },
        async request(args) {
          calls.push(args);
          if (args.method === 'read') {
            if (args.args.path.endsWith('/slow.md')) return new Promise(resolve => { window.releaseSlow = () => resolve({ text: '# Stale document', path: args.args.path, stamp: 'old' }); });
            return { text: markdown, path: args.args.path, stamp: fileStamp };
          }
          if (args.method === 'stat') return { stamp: fileStamp };
          if (args.method === 'image') return { path: 'C:/docs/pixel.png', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKXcAAAAASUVORK5CYII=' };
          throw Error('Unexpected method');
        },
        onEvent(handler) { window.emit = handler; return () => { window.unlistened = true; }; },
      };
      window.workspace = createPreviewWorkspace({ container: document.querySelector('#test'), workspaceId: 'test', api,
        createTerminal: async ({ host }) => { host.textContent = 'Terminal session'; return { focus() {}, resize() {}, dispose() { terminalDisposals++; } }; },
        openExternalUrl: async (url) => { window.external = url; }, onError: error => { window.lastError = String(error); },
      });
    });
    assert.equal(await page.evaluate(() => calls.length), 0, 'Creating a pane does not connect');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.waitForSelector('.preview-diagram svg');
    assert.equal(await page.locator('.markdown-preview h1').textContent(), 'Preview review');
    assert.equal(await page.locator('.markdown-preview .katex').count(), 1);
    assert.equal(await page.locator('.markdown-preview .hljs-keyword').count(), 1);
    assert.equal(await page.locator('.markdown-preview #heading-1').count(), 1);
    assert.equal(await page.locator('.markdown-preview script').count(), 0);
    assert.equal(await page.evaluate(() => window.previewScriptExecuted), undefined);
    await page.waitForFunction(() => document.querySelector('.preview-image img').getAttribute('src'));
    await page.evaluate(() => { window.originalHeading = document.querySelector('h1'); window.originalDiagram = document.querySelector('.preview-diagram svg'); window.originalImage = document.querySelector('.preview-image img'); });
    await page.evaluate(() => workspace.refresh());
    assert(await page.evaluate(() => originalHeading === document.querySelector('h1') && originalDiagram === document.querySelector('.preview-diagram svg') && originalImage === document.querySelector('.preview-image img')), 'Unchanged refresh keeps DOM nodes, diagram, and image');
    await page.getByRole('link', { name: 'External', exact: true }).click();
    assert.equal(await page.evaluate(() => external), 'https://example.com');
    await page.getByRole('link', { name: 'Next', exact: true }).click();
    await page.waitForFunction(() => calls.some(call => call.method === 'read' && call.args.path === 'C:/docs/next.md'));
    await page.evaluate(() => workspace.toggleTerminal(true));
    assert(await page.getByRole('region', { name: 'Workspace terminal' }).isVisible());
    await page.screenshot({ path: 'artifacts/preview-workspace-ui.png', fullPage: true });
    await page.evaluate(() => { window.slowPromise = workspace.openFile('slow.md'); });
    await page.waitForFunction(() => window.releaseSlow);
    await page.evaluate(async () => { markdown = '# New document'; await workspace.openFile('new.md'); releaseSlow(); await slowPromise; });
    assert.equal(await page.locator('h1').textContent(), 'New document', 'Late document reads cannot overwrite the active file');
    await page.evaluate(async () => {
      window.oldId = calls.find(call => call.method === 'open').workspaceId;
      await workspace.connect({ target: 'demo', root: '/docs' });
      emit({ workspaceId: oldId, event: 'open', path: '/stale.md' });
      await workspace.openFile('/docs/current.md');
    });
    assert.equal(await page.evaluate(() => calls.filter(call => call.method === 'read' && call.args.path === '/stale.md').length), 0, 'Events from replaced connections are ignored');
    assert.equal(await page.evaluate(() => new Set(calls.filter(call => call.method === 'open').map(call => call.workspaceId)).size), 2);
    await page.evaluate(async () => { markdown = '# Live edit'; fileStamp = '2'; });
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Live edit');
    await page.evaluate(() => workspace.dispose());
    assert.equal(await page.locator('.preview-workspace').count(), 0);
    assert(await page.evaluate(() => unlistened && terminalDisposals === 2));
    await page.evaluate(async () => {
      const { createMarkdownPreview } = await import('/markdown-preview.js');
      const host = document.createElement('article'); document.querySelector('#test').appendChild(host);
      window.renderer = createMarkdownPreview({ container: host, readImage: async () => ({ url: 'https://example.com/tracker.png' }) });
      renderer.render({ text: '![blocked](tracker.png)\n\n```mermaid\n' + 'x'.repeat(50001) + '\n```', path: '/docs/test.md', root: '/docs' });
      try { renderer.render({ text: 'x'.repeat(4 * 1024 * 1024 + 1), path: '/docs/test.md', root: '/docs' }); }
      catch (error) { window.sizeError = error.message; }
    });
    await page.waitForFunction(() => document.querySelector('.preview-image').classList.contains('preview-render-error'));
    assert.equal(await page.locator('.preview-image img[src]').count(), 0, 'An image response cannot trigger an arbitrary remote request');
    assert.match(await page.locator('.preview-diagram').textContent(), /50,000/);
    assert.match(await page.evaluate(() => sizeError), /4 MiB/);
    await page.evaluate(() => renderer.dispose());
    assert.deepEqual(errors, []);
    console.log('Preview UI: rendering, sanitization, links, unchanged refresh, terminal, polling, races, and disposal passed.');
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

