const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pdfFixture } = require('./media-fixtures.cjs');
(async()=>{
  const { createServer } = await import('vite');
  const server = await createServer({cacheDir:'../node_modules/.vite-media-test',optimizeDeps:{entries:[path.resolve('src/preview-document.js')]},server:{host:'127.0.0.1',port:1437,strictPort:true}});
  await server.listen();let browser;
  try {
    browser=await chromium.launch({headless:true,channel:process.env.VIBE99_TEST_BROWSER || (process.platform==='win32'?'msedge':undefined)});
    const page=await browser.newPage({viewport:{width:950,height:800}}), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/media-test',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0}#test{height:800px}*{box-sizing:border-box}</style><div id="test"></div>'}));
    await page.goto('http://127.0.0.1:1437/media-test', {timeout:60000});
    await page.evaluate(async pdf => {
      const {createPreviewDocument}=await import('/preview-document.js');
      const c=document.createElement('canvas');c.width=1400;c.height=900;const x=c.getContext('2d');x.fillStyle='#267980';x.fillRect(0,0,1400,900);x.fillStyle='white';x.font='48px sans-serif';x.fillText('Vibe99 image preview',50,150);
      window.files={'/test/a.pdf':{mime:'application/pdf',data:pdf,stamp:'1'},'/test/picture.png':{mime:'image/png',data:c.toDataURL().split(',')[1],stamp:'1'}};
      window.calls=[];window.saves=[];window.reader=createPreviewDocument({container:document.querySelector('#test'),workspaceId:'media-test',
        api:{open:async()=>({root:'/test'}),close:async()=>{},onEvent:handler=>{window.emit=handler;return()=>{};},request:async request=>{calls.push(request);const file=files[request.args.path];if(request.method==='stat')return {stamp:file.stamp};if(request.method==='media')return {...file,path:request.args.path};throw Error('Unexpected read');}},saveAs:async value=>{saves.push(value);return 'Downloads/copy';}});
    },pdfFixture().toString('base64'));
    await page.evaluate(()=>reader.open({target:null,root:'/test',path:'a.pdf'}));
    await page.locator('canvas[aria-label="PDF page 1 of 2"]').waitFor();
    assert.equal(await page.getByRole('button',{name:'Previous PDF page'}).isDisabled(),true);
    const pixels=await page.evaluate(()=>{const c=document.querySelector('canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let colors=0;for(let i=0;i<d.length;i+=4)if(d[i]<230&&d[i+1]>50)colors++;return colors;});assert(pixels>1000,'PDF graphics rendered');
    await page.getByRole('button',{name:'Next PDF page'}).click();await page.locator('canvas[aria-label="PDF page 2 of 2"]').waitFor();
    assert(await page.getByRole('button',{name:'Next PDF page'}).isDisabled());
    const width=await page.locator('canvas').evaluate(c=>c.style.width);
    await page.getByRole('button',{name:'Zoom PDF in',exact:true}).click();await page.waitForFunction(w=>document.querySelector('canvas').style.width!==w,width);
    await page.getByRole('button',{name:'Fit width',exact:true}).click();await page.waitForFunction(w=>document.querySelector('canvas').style.width===w,width);
    await page.getByRole('button',{name:'Save file as'}).click();assert.equal(await page.evaluate(()=>saves[0].data),pdfFixture().toString('base64'));
    await page.evaluate(()=>reader.open({target:'ssh-fixture',root:'/test',path:'picture.png'}));
    await page.getByRole('button',{name:'Expand image: picture.png'}).click();await page.getByRole('dialog',{name:'Expanded image'}).waitFor();
    await page.getByRole('button',{name:'Zoom image in',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.locator('dialog.diagram-viewer').count(),0);
    await page.getByRole('button',{name:'Save file as'}).click();assert(await page.evaluate(()=>saves[1].data===files['/test/picture.png'].data));
    // Supersede a pending PDF import/parse with an image and then dispose a loading PDF.
    await page.evaluate(async()=>{await Promise.all([reader.open({target:null,root:'/test',path:'a.pdf'}),reader.open({target:null,root:'/test',path:'picture.png'})]);});
    assert.equal(await page.locator('canvas').count(),0);await page.getByRole('button',{name:'Expand image: picture.png'}).waitFor();
    await page.evaluate(async()=>{files['/test/bad.pdf']={mime:'application/pdf',data:btoa('not a pdf'),stamp:'1'};await reader.open({target:null,root:'/test',path:'bad.pdf'});});
    assert(await page.locator('.preview-document-status.is-error').isVisible());
    await page.evaluate(async()=>{const p=reader.open({target:null,root:'/test',path:'a.pdf'});reader.dispose();await p;});
    assert.equal(await page.locator('.preview-document').count(),0);assert.deepEqual(errors,[]);
    console.log('PASS: PDF real rendering/pages/zoom/fit, binary Save As, SSH image/expand, stale navigation, corrupt PDF, worker disposal');
  }finally{await browser?.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
