const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    cacheDir: '../node_modules/.vite-document-test',
    optimizeDeps: { entries: [require('node:path').resolve('src/preview-document.js')] },
    server: { host: '127.0.0.1', port: 1424, strictPort: true },
  });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.VIBE99_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined) });
    const page = await browser.newPage({ viewport: { width: 850, height: 850 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/document-test', route => route.fulfill({ contentType: 'text/html', body: '<html><head><style>body{margin:0;background:#151a1c}#test{height:850px}*{box-sizing:border-box;margin:0}</style></head><body><div id="test"></div><script type="module">import {createPreviewDocument} from "/preview-document.js"; window.createPreviewDocument=createPreviewDocument;</script></body></html>' }));
    await page.goto('http://127.0.0.1:1424/document-test', {timeout:60000});
    await page.waitForFunction(() => window.createPreviewDocument);
    await page.evaluate(() => {
      window.calls = []; window.stamp = '1'; window.failRead = false;
      window.text = '# Agent notes\n\nThe document opens alongside your terminal.\n\n## Current change\n\n- Read the result\n- Keep your terminal session\n\n```javascript\nconst ready = true;\n```\n\n$$x^2 + y^2 = z^2$$\n\n[Next document](next.md)';
      window.api = {
        async open(args) {
          calls.push({ method: 'open', ...args });
          if (args.target === 'slow-host') return new Promise(resolve => { window.finishConnection = () => resolve({ root: args.root }); });
          return { root: args.root };
        },
        async close(args) { calls.push({ method: 'close', ...args }); },
        async request(args) {
          calls.push(args);
          if (args.method === 'stat') return { stamp };
          if (args.method === 'read') {
            if (args.args.path.endsWith('/slow.md')) return new Promise(resolve => { window.finishRead = () => resolve({ text: '# Stale file', path: args.args.path, stamp: 'old' }); });
            if (failRead) throw new Error('File is not available.');
            return { text, path: args.args.path, stamp };
          }
          throw new Error('Unexpected request');
        },
        onEvent(handler) { window.emit = handler; return () => { window.unlistened = true; }; },
      };
      window.saves = []; window.saveResult = 'C:/Downloads/saved.md';
      window.createReader = () => createPreviewDocument({ container: document.querySelector('#test'), workspaceId: 'document-test', api,
        saveAs: async value => { saves.push(value); if(window.holdSave) return new Promise(resolve => { window.finishSave=resolve; }); if(window.failSave) throw Error('Write failed'); return saveResult; },
        onClose: () => { window.readerClosed = true; } });
      window.reader = createReader();
    });
    assert.equal(await page.evaluate(() => calls.length), 0);
    assert(await page.evaluate(() => reader.open({ target: null, root: 'C:/docs', path: 'notes.md' })));
    assert.equal(await page.locator('h1').textContent(), 'Agent notes');
    assert.equal(await page.locator('.preview-document-name').textContent(), 'notes.md');
    assert.equal(await page.locator('input, select, form').count(), 0, 'The companion has no connection or path scaffolding');
    assert.equal(await page.getByRole('button').count(), 2, 'Save As and Close are the only document actions');
    assert(!(await page.locator('.preview-document-status').isVisible()));
    assert.equal(await page.locator('.katex').count(), 1);
    await page.evaluate(() => { window.heading = document.querySelector('h1'); });
    await page.evaluate(() => reader.refresh());
    assert(await page.evaluate(() => heading === document.querySelector('h1')), 'Unchanged refresh preserves the document DOM');
    await page.evaluate(() => reader.open({ target: null, root: 'C:/docs', path: 'notes.md' }));
    assert(await page.evaluate(() => heading === document.querySelector('h1')), 'Repeating a relative terminal link preserves unchanged content');
    await page.getByRole('link', { name: 'Next document' }).click();
    await page.waitForFunction(() => document.querySelector('.preview-document-name').textContent === 'next.md');
    assert.equal(await page.evaluate(() => calls.filter(call => call.method === 'open').length), 1, 'Related documents reuse their connection');
    await page.screenshot({ path: 'artifacts/document-companion-ui.png', fullPage: true });
    await page.evaluate(() => { failRead = true; });
    assert.equal(await page.evaluate(() => reader.open({ target: null, root: 'C:/docs', path: 'missing.md' })), false);
    assert(await page.getByRole('button', { name: 'Retry' }).isVisible());
    assert.equal(await page.locator('h1').count(), 0, 'Failed navigation does not show a previous document under the new filename');
    await page.evaluate(() => { failRead = false; text = '# Recovered'; });
    await page.getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Recovered');
    await page.evaluate(() => { window.slowRead = reader.open({ target: null, root: 'C:/docs', path: 'slow.md' }); });
    await page.waitForFunction(() => window.finishRead);
    await page.evaluate(async () => { text = '# Latest document'; await reader.open({ target: null, root: 'C:/docs', path: 'latest.md' }); finishRead(); await slowRead; });
    assert.equal(await page.locator('h1').textContent(), 'Latest document');
    await page.evaluate(() => { window.slowConnection = reader.open({ target: 'slow-host', root: '/docs', path: 'remote.md' }); });
    await page.waitForFunction(() => window.finishConnection);
    await page.evaluate(async () => { text = '# Local again'; await reader.open({ target: null, root: 'C:/docs', path: 'local.md' }); finishConnection(); await slowConnection; });
    assert.equal(await page.locator('h1').textContent(), 'Local again');
    assert(await page.evaluate(() => {
      const old = calls.find(call => call.method === 'open' && call.target === 'slow-host');
      return calls.some(call => call.method === 'close' && call.workspaceId === old.workspaceId);
    }));
    await page.evaluate(() => {
      const stale = calls.find(call => call.method === 'open').workspaceId;
      emit({ workspaceId: stale, event: 'open', path: '/stale-event.md' });
      text = '# Changed on disk'; stamp = '2';
    });
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Changed on disk');
    assert.equal(await page.evaluate(() => calls.filter(call => call.method === 'read' && call.args.path === '/stale-event.md').length), 0);
    await page.evaluate(() => { document.querySelector('#test').style.display = 'none'; window.statsBeforeHidden = calls.filter(call => call.method === 'stat').length; });
    await page.waitForTimeout(2200);
    assert(await page.evaluate(() => statsBeforeHidden === calls.filter(call => call.method === 'stat').length), 'Hidden companion panes do not poll');
    await page.evaluate(() => { document.querySelector('#test').style.display = ''; });
    await page.evaluate(() => {
      const latest = calls.filter(call => call.method === 'open').at(-1).workspaceId;
      emit({ workspaceId: latest, event: 'disconnected' });
    });
    assert(await page.getByRole('button', { name: 'Retry' }).isVisible());
    const previousOpens = await page.evaluate(() => calls.filter(call => call.method === 'open').length);
    await page.getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(() => document.querySelector('.preview-document-status').hidden);
    assert.equal(await page.evaluate(() => calls.filter(call => call.method === 'open').length), previousOpens + 1);
    await page.getByRole('button', { name: 'Close document preview' }).click();
    assert.equal(await page.locator('.preview-document').count(), 0);
    assert(await page.evaluate(() => readerClosed && unlistened));
    await page.evaluate(() => { reader = createReader(); window.finishConnection = null; window.disposedOpen = reader.open({ target: 'slow-host', root: '/docs', path: 'test.md' }); });
    await page.waitForFunction(() => window.finishConnection);
    await page.evaluate(async () => { reader.dispose(); finishConnection(); await disposedOpen; });
    assert.equal(await page.locator('.preview-document').count(), 0, 'Disposal during connect does not resurrect the reader');
    await page.evaluate(async () => { reader=createReader(); text='# 本地\r\n\r\n![图](figure.png)\n'; stamp='save-local'; await reader.open({target:null,root:'C:/docs',path:'local.md'}); });
    const saveButton = page.getByRole('button', {name:'Save Markdown as'});
    await saveButton.click(); await page.waitForFunction(()=>saves.length===1);
    assert.deepEqual(await page.evaluate(()=>saves[0]),{filename:'local.md',text:'# 本地\r\n\r\n![图](figure.png)\n'});
    await page.waitForFunction(()=>document.querySelector('.preview-document-status').textContent.includes('Saved to C:/Downloads/saved.md'));
    await page.evaluate(async () => {text='# Remote snapshot\n';stamp='save-remote';await reader.open({target:'test-host',root:'/remote/docs',path:'remote.md'});});
    await saveButton.click(); await page.waitForFunction(()=>saves.length===2);
    assert.deepEqual(await page.evaluate(()=>saves[1]),{filename:'remote.md',text:'# Remote snapshot\n'});
    await page.evaluate(()=>{const id=calls.filter(c=>c.method==='open').at(-1).workspaceId;emit({workspaceId:id,event:'disconnected'});});
    assert(await saveButton.isEnabled(),'loaded remote content remains saveable after disconnect');
    const reads = await page.evaluate(()=>calls.filter(c=>c.method==='read').length);
    await saveButton.click(); await page.waitForFunction(()=>saves.length===3);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.method==='read').length),reads,'Save As never rereads the remote source');
    await page.evaluate(()=>{saveResult=null;}); await saveButton.click();
    await page.waitForFunction(()=>saves.length===4 && !document.querySelector('.preview-document-save').disabled);
    await page.evaluate(()=>{failSave=true;}); await saveButton.click();
    await page.waitForFunction(()=>document.querySelector('.preview-document-status').textContent.includes('Could not save this document: Write failed'));
    assert(!(await page.getByRole('button',{name:'Retry'}).isVisible()),'save failure does not offer a misleading reload retry');
    assert(await saveButton.isEnabled());
    await page.evaluate(()=>{failSave=false;holdSave=true;}); await saveButton.click();
    await page.waitForFunction(()=>window.finishSave); assert(await saveButton.isDisabled());
    const pendingCount=await page.evaluate(()=>saves.length);
    await saveButton.evaluate(el=>el.click()); assert.equal(await page.evaluate(()=>saves.length),pendingCount,'duplicate save suppressed');
    await page.evaluate(async()=>{text='# New document\n';await reader.open({target:null,root:'C:/docs',path:'new.md'});finishSave('C:/Downloads/remote.md');});
    await page.waitForFunction(()=>!document.querySelector('.preview-document-save').disabled);
    assert.equal(await page.locator('h1').textContent(),'New document');
    assert(await page.locator('.preview-document-status').evaluate(el=>el.hidden),'old save result cannot label the new document');
    assert.equal(await page.evaluate(()=>saves.at(-1).text),'# Remote snapshot\n','pending save keeps the clicked snapshot');
    await page.evaluate(async()=>{failRead=true;await reader.open({target:null,root:'C:/docs',path:'unreadable.md'});});
    assert(await saveButton.isDisabled(),'failed navigation cannot export the previous document');
    await page.evaluate(()=>reader.dispose());
    assert.deepEqual(errors, []);
    console.log('Document companion: direct loading, minimal UI, connection reuse, refresh, retry, stale results/events, reconnect, and disposal passed.');
    console.log('Save As: local/remote snapshots, UTF-8/CRLF source, offline export, cancellation, write errors, duplicate suppression and navigation during save passed.');
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
