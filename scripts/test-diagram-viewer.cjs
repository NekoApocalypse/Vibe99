const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ cacheDir: '../node_modules/.vite-diagram-test',
    optimizeDeps: { entries: [path.resolve('src/markdown-preview.js')] },
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'],
      channel: process.env.VIBE99_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined) });
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/diagram-test', route => route.fulfill({ contentType: 'text/html', body: `
      <html><head><style>body{margin:0;background:#111}#pane{width:560px;height:800px;overflow:auto;transform:translateX(30px);opacity:.7}</style></head>
      <body><button id="outside">Outside pane</button><div id="pane" class="preview-workspace"><article></article></div>
      <script type="module">import {createMarkdownPreview} from '/markdown-preview.js'; import '/preview-workspace.css';
      window.reader=createMarkdownPreview({container:document.querySelector('article'), readImage:async()=>{}, onError:e=>{throw e}});
      window.render=(text,path='test.md')=>reader.render({text,path,root:'/docs'});
      render('# Diagram review\\n\\n\`\`\`mermaid\\nflowchart LR\\nA[Agent reply] --> B[Markdown pane] --> C[Expanded diagram]\\n\`\`\`');
      </script></body></html>` }));
    await page.goto(server.resolvedUrls.local[0] + 'diagram-test');
    const expand = page.getByRole('button', { name: 'Expand Mermaid diagram 1' });
    await expand.waitFor({ timeout: 60000 });
    const originalSvg = await page.locator('.preview-diagram svg').getAttribute('id');
    await expand.click();
    const dialog = page.getByRole('dialog', { name: 'Expanded Mermaid diagram' });
    const canvas = page.locator('.diagram-canvas');
    const matrix = () => page.locator('.diagram-transform').evaluate(el => {
      const m = new DOMMatrix(getComputedStyle(el).transform); return { scale: m.a, x: m.e, y: m.f };
    });
    await dialog.waitFor();
    assert(await dialog.evaluate(el => el.matches(':modal') && el.parentElement === document.body));
    const box = await dialog.boundingBox();
    assert(box.width > 1100 && box.height > 800, 'expanded view spans the window outside its narrow translucent pane');
    assert.equal(await page.locator(`[id="${originalSvg}"]`).count(), 1, 'moving SVG avoids duplicate marker/style IDs');
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).opacity), '1');
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    const fit = await matrix(), c = await canvas.boundingBox();
    await page.mouse.move(c.x + c.width * .7, c.y + c.height * .4);
    await page.mouse.wheel(0, -300);
    await page.waitForFunction(scale => new DOMMatrix(getComputedStyle(document.querySelector('.diagram-transform')).transform).a > scale, fit.scale);
    const zoomed = await matrix();
    const cx = c.width * .7, cy = c.height * .4;
    assert(Math.abs((cx-fit.x)/fit.scale - (cx-zoomed.x)/zoomed.scale) < 2, 'wheel zoom anchors the point under the cursor');
    assert(Math.abs((cy-fit.y)/fit.scale - (cy-zoomed.y)/zoomed.scale) < 2);
    await page.mouse.move(c.x+150,c.y+150); await page.mouse.down();
    await page.mouse.move(c.x+230,c.y+190,{steps:6}); await page.mouse.up();
    const panned = await matrix();
    assert(Math.abs(panned.x-zoomed.x-80)<1 && Math.abs(panned.y-zoomed.y-40)<1, 'real pointer drag pans');
    await page.keyboard.press('ArrowLeft');
    assert(Math.abs((await matrix()).x-panned.x-60)<1);
    await page.keyboard.press('1'); assert.equal((await matrix()).scale,1);
    await page.keyboard.press('+'); assert((await matrix()).scale>1);
    await page.keyboard.press('-'); assert.equal((await matrix()).scale,1);
    await page.keyboard.press('0'); assert.equal((await matrix()).scale,fit.scale);
    await page.getByRole('button', { name: 'Zoom diagram in', exact: true }).click();
    assert((await matrix()).scale>fit.scale);
    await page.getByRole('button', { name: 'Zoom diagram out', exact: true }).click();
    await page.getByRole('button', { name: 'Diagram actual size', exact: true }).click();
    assert.equal((await matrix()).scale,1);
    await page.mouse.dblclick(c.x+100,c.y+100); assert.equal((await matrix()).scale,fit.scale);
    for (let i=0;i<10;i++) {
      await page.keyboard.press(i%2 ? 'Shift+Tab' : 'Tab');
      assert(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)));
    }
    await page.setViewportSize({ width: 700, height: 600 });
    await page.waitForFunction(() => document.querySelector('dialog').clientWidth < 700);
    await page.screenshot({path:'artifacts/diagram-viewer-narrow.png'});
    await page.keyboard.press('Escape'); assert.equal(await dialog.count(),0);
    assert(await expand.evaluate(el=>el===document.activeElement));
    assert.equal(await page.locator('.preview-diagram svg').getAttribute('id'),originalSvg);
    console.log('PASS: top-layer modal, unique SVG, cursor-anchored wheel zoom, drag/keyboard pan, zoom/actual/Fit/double-click, focus trap/return and resize');

    await expand.click();
    const beforeRefresh=await matrix();
    await page.evaluate(()=>render('# Updated\n\n```mermaid\nflowchart LR\nX[New snapshot] --> Y[After refresh]\n```'));
    await expand.waitFor({state:'attached'});
    assert.equal(await dialog.count(),1,'automatic refresh must not dismiss or move the diagram being read');
    assert.deepEqual(await matrix(),beforeRefresh);
    assert((await dialog.textContent()).includes('Agent reply'));
    await page.getByRole('button',{name:'Close diagram',exact:true}).click();
    await expand.click();
    assert((await dialog.textContent()).includes('New snapshot'),'reopening gets the latest rendered diagram');
    await page.evaluate(()=>render('# Another document','different.md'));
    assert.equal(await dialog.count(),0,'navigation dismisses snapshot');
    await page.evaluate(()=>render('```mermaid\nflowchart TD\nA-->B\n```'));
    await expand.click();
    await page.evaluate(()=>reader.clear());
    assert.equal(await dialog.count(),0,'clear dismisses snapshot');
    await page.evaluate(()=>render('```mermaid\nflowchart TD\nA-->B\n```'));
    await expand.click();
    await page.evaluate(()=>reader.dispose());
    assert.equal(await dialog.count(),0,'disposing owner dismisses snapshot');
    assert.deepEqual(errors,[]);
    console.log('PASS: refresh preserves expanded snapshot; reopening updates; navigation, clear and disposal release modal');

    await page.setViewportSize({ width: 1200, height: 850 });
    await page.evaluate(async () => {
      const { createMarkdownPreview } = await import('/markdown-preview.js');
      const fixture = document.createElement('canvas'); fixture.width = 1600; fixture.height = 800;
      const context = fixture.getContext('2d'); context.fillStyle = '#38bdf8'; context.fillRect(0,0,1600,800);
      window.firstImage = fixture.toDataURL('image/png');
      context.fillStyle = '#f472b6'; context.fillRect(0,0,1600,800);
      window.latestImage = fixture.toDataURL('image/png'); window.imageUrl = firstImage; window.imageReads = []; window.external = [];
      window.reader = createMarkdownPreview({ container: document.querySelector('article'),
        readImage: async args => { imageReads.push(args); if(args.source==='missing.png') throw Error('Image missing'); return {url:imageUrl,path:'/remote/docs/plot.png'}; },
        openExternalUrl: url => external.push(url), onError:e=>{throw e} });
      window.imageText = '# Image review\n\n[![Agent chart](plot.png)](https://example.com/chart)';
      reader.render({text:imageText,path:'/remote/docs/result.md',root:'/remote/docs'});
    });
    const imageButton = page.getByRole('button',{name:'Expand image: Agent chart'});
    await imageButton.waitFor();
    await page.waitForFunction(() => document.querySelector('.preview-image img').naturalWidth===1600);
    await imageButton.click();
    const imageDialog = page.getByRole('dialog',{name:'Expanded image'});
    await imageDialog.waitFor();
    assert(await imageDialog.evaluate(el=>el.matches(':modal') && el.parentElement===document.body));
    assert.equal(await page.locator('.preview-image img').count(),1,'inline image remains available for refresh');
    assert.equal(await page.locator('.diagram-transform').evaluate(el=>el.style.width),'1600px');
    assert.deepEqual(await page.evaluate(()=>external),[],'clicking a linked image expands rather than following its link');
    const imageFit=await matrix(), imageCanvas=await canvas.boundingBox();
    await page.mouse.move(imageCanvas.x+200,imageCanvas.y+180); await page.mouse.wheel(0,-300);
    await page.waitForFunction(scale=>new DOMMatrix(getComputedStyle(document.querySelector('.diagram-transform')).transform).a>scale,imageFit.scale);
    const imageZoom=await matrix();
    await page.mouse.down(); await page.mouse.move(imageCanvas.x+270,imageCanvas.y+220,{steps:5}); await page.mouse.up();
    const imagePan=await matrix();
    assert(Math.abs(imagePan.x-imageZoom.x-70)<1 && Math.abs(imagePan.y-imageZoom.y-40)<1);
    await page.keyboard.press('1'); assert.equal((await matrix()).scale,1);
    await page.getByRole('button',{name:'Fit image',exact:true}).click();
    assert.equal((await matrix()).scale,imageFit.scale);
    await page.evaluate(()=>{imageUrl=latestImage;reader.render({text:imageText,path:'/remote/docs/result.md',root:'/remote/docs',refreshImages:true});});
    await page.waitForFunction(()=>document.querySelector('.preview-image img').src===latestImage);
    assert(await imageDialog.locator('img').evaluate(el=>el.src===window.firstImage),'expanded image stays on its original bytes during refresh');
    await page.screenshot({path:'artifacts/image-viewer-expanded.png'});
    await page.keyboard.press('Escape');
    assert.equal(await imageDialog.count(),0); assert(await imageButton.evaluate(el=>el===document.activeElement));
    await page.keyboard.press('Enter'); await imageDialog.waitFor();
    assert(await imageDialog.locator('img').evaluate(el=>el.src===window.latestImage));
    await page.evaluate(()=>reader.render({text:'# Changed\n\n![Agent chart](plot.png)',path:'/remote/docs/result.md',root:'/remote/docs'}));
    assert.equal(await imageDialog.count(),1,'document refresh keeps image snapshot open');
    await page.evaluate(()=>reader.render({text:'# Next',path:'/remote/docs/next.md',root:'/remote/docs'}));
    assert.equal(await imageDialog.count(),0,'navigation dismisses image viewer');
    await page.evaluate(()=>reader.render({text:'![Agent chart](plot.png)',path:'/remote/docs/next.md',root:'/remote/docs'}));
    await imageButton.waitFor(); await page.waitForFunction(()=>document.querySelector('.preview-image img').naturalWidth>0);
    await imageButton.focus(); await page.keyboard.press('Space'); await imageDialog.waitFor();
    await page.evaluate(()=>reader.clear()); assert.equal(await imageDialog.count(),0);
    await page.evaluate(()=>reader.render({text:'![Agent chart](plot.png)',path:'/remote/docs/next.md',root:'/remote/docs'}));
    await imageButton.waitFor(); await page.waitForFunction(()=>document.querySelector('.preview-image img').naturalWidth>0);
    await imageButton.click(); await page.evaluate(()=>reader.dispose()); assert.equal(await imageDialog.count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: Markdown images share top-layer zoom/pan/Fit/actual controls, natural dimensions, linked-image and keyboard activation, stable refresh snapshots and owner cleanup');
  } finally { await browser?.close(); await server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
