// Real app IPC, local filesystem and optional authorized SSH host. No workspace mocks.
const {chromium}=require('playwright');
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {pdfFixture}=require('./media-fixtures.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const executable=path.resolve(process.argv[2]),host=process.argv[3];
 assert(fs.readFileSync(executable).includes(Buffer.from('com.vibe99.review12')),'Use isolated Review 12');
 assert(host && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(host),'Pass an explicitly authorized SSH configuration alias');
 const remoteRoot='/tmp/vibe99-media-'+randomUUID(), localRoot=path.resolve('artifacts/native-media-'+randomUUID());fs.mkdirSync(localRoot);
 const runPython=code=>execFileSync('ssh.exe',['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10',host,"python3 -c 'import sys;exec(sys.stdin.buffer.read())'"],{input:code,windowsHide:true,timeout:30000}).toString();
 const settings=path.join(process.env.APPDATA,'com.vibe99.review12','settings.json');fs.mkdirSync(path.dirname(settings),{recursive:true});
 const ui=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'com.vibe99.app','settings.json'))).ui;fs.writeFileSync(settings,JSON.stringify({version:4,ui}));
 const port=9254;
 try{await fetch(`http://127.0.0.1:${port}/json/version`);throw Error('Port occupied');}catch(e){if(e.message==='Port occupied')throw e;}
 const child=spawn(executable,[],{detached:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});child.unref();let browser,success=false;
 try{
  for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok)break;}catch{}await delay(300);}
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const page=browser.contexts()[0].pages()[0];
  await page.waitForSelector('#tabs-preview');
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=900;const x=c.getContext('2d');x.fillStyle='#267780';x.fillRect(0,0,1600,900);x.fillStyle='#fff';x.font='60px Segoe UI';x.fillText('Vibe99 local + SSH images',70,180);return c.toDataURL().split(',')[1];});
  fs.writeFileSync(path.join(localRoot,'report.pdf'),pdfFixture());fs.writeFileSync(path.join(localRoot,'picture.png'),Buffer.from(image,'base64'));
  runPython(`import os,base64\np=${JSON.stringify(remoteRoot)}\nos.mkdir(p,0o700)\nopen(p+'/report.pdf','wb').write(base64.b64decode('${pdfFixture().toString('base64')}'))\nopen(p+'/picture.png','wb').write(base64.b64decode('${image}'))`);
  const open=async file=>{await page.locator('#tabs-preview').click();await page.locator('.preview-context-dialog input[name=path]').fill(file);await page.getByRole('button',{name:'Open preview',exact:true}).click();};
  const pdfCheck=async()=>{
   const pane=page.locator('.pane.is-focused');await pane.locator('canvas[aria-label="PDF page 1 of 2"]').waitFor();
   assert(await pane.locator('canvas').evaluate(c=>c.width>100&&c.height>100));
   await pane.getByRole('button',{name:'Next PDF page'}).click();await pane.locator('canvas[aria-label="PDF page 2 of 2"]').waitFor();
   const w=await pane.locator('canvas').evaluate(c=>c.style.width);await pane.getByRole('button',{name:'Zoom PDF in',exact:true}).click();await page.waitForFunction(w=>document.querySelector('.pane.is-focused canvas').style.width!==w,w);
   await pane.getByRole('button',{name:'Fit width',exact:true}).click();await page.waitForFunction(w=>document.querySelector('.pane.is-focused canvas').style.width===w,w);
  };
  const imageCheck=async()=>{
   const image=page.locator('.pane.is-focused').getByRole('button',{name:'Expand image: picture.png'});await image.waitFor();await page.waitForFunction(()=>document.querySelector('.pane.is-focused .file-media-preview img')?.naturalWidth===1600);
   await image.click();await page.getByRole('dialog',{name:'Expanded image'}).waitFor();
   const area=await page.locator('.diagram-canvas').boundingBox();const matrix=()=>page.locator('.diagram-transform').evaluate(e=>{const m=new DOMMatrix(getComputedStyle(e).transform);return {scale:m.a,x:m.e,y:m.f};});
   const fit=await matrix();await page.mouse.move(area.x+200,area.y+200);await page.mouse.wheel(0,-250);await page.waitForFunction(s=>new DOMMatrix(getComputedStyle(document.querySelector('.diagram-transform')).transform).a>s,fit.scale);
   const zoom=await matrix();await page.mouse.down();await page.mouse.move(area.x+250,area.y+240,{steps:5});await page.mouse.up();const pan=await matrix();assert(Math.abs(pan.x-zoom.x-50)<1);
   await page.keyboard.press('Escape');assert.equal(await page.locator('dialog.diagram-viewer').count(),0);
  };
  await open(path.join(localRoot,'report.pdf'));await pdfCheck();await open(path.join(localRoot,'picture.png'));await imageCheck();
  await open(`vscode-remote://ssh-remote+${host}${remoteRoot}/report.pdf`);await pdfCheck();
  await open(`vscode-remote://ssh-remote+${host}${remoteRoot}/picture.png`);await imageCheck();
  await page.screenshot({path:'artifacts/review12-native-media.png'});
  // Leave a local PDF for manual Save As verification; close all remote readers first.
  const remoteIds=await page.evaluate(root=>[...document.querySelectorAll('.pane')].filter(p=>p.querySelector('.preview-document-name')?.title.includes(root)).map(p=>p.dataset.inputPaneId),remoteRoot);
  for(const id of remoteIds) await page.locator(`.tab[data-pane-id="${id}"] .tab-main`).click({button:'middle'});
  await open(path.join(localRoot,'report.pdf'));await pdfCheck();
  fs.writeFileSync('artifacts/review12-native-media.json',JSON.stringify({success:true,localPdf:true,remotePdf:true,localImage:true,remoteImage:true,pages:true,zoom:true,pan:true,host,localRoot,pid:child.pid,binarySha256:createHash('sha256').update(fs.readFileSync(executable)).digest('hex')},null,2));
  console.log('PASS: real local/SSH PDF pages + zoom + fit, image expand + wheel zoom + drag pan');success=true;
 }finally{
  runPython(`import os\np=${JSON.stringify(remoteRoot)}\nif os.path.isdir(p):\n for n in ('report.pdf','picture.png'):\n  f=p+'/'+n\n  if os.path.isfile(f): os.unlink(f)\n os.rmdir(p)`);
  await browser?.close();if(!success)child.kill();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
