// Opt-in native companion-reader test; no application test hooks are installed.
// Usage: node scripts/test-native-companion.cjs <final.exe> <authorized-ssh-host> [--release]
// Default: isolated Review7. --release: exact production com.vibe99.app v0.8.0 gate.
const { chromium } = require('playwright');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const { resolve, join, dirname, basename } = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { randomUUID, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const execFileAsync = promisify(execFile);

(async () => {
  assert(process.argv[2] && process.argv[3], 'Pass the final Review7 executable and explicitly authorized SSH host');
  const executable = resolve(process.argv[2]), host = process.argv[3];
  const releaseMode = process.argv.includes('--release');
  const identifier = releaseMode ? 'com.vibe99.app' : 'com.vibe99.review7';
  const evidenceTag = releaseMode ? 'release-0.8.0' : 'review7';
  const evidencePath = name => resolve('artifacts', name.replaceAll('review7', evidenceTag));
  assert(/^[A-Za-z0-9][A-Za-z0-9_.@:-]*$/.test(host), 'Use an explicitly authorized simple SSH host');
  const bytes = fs.readFileSync(executable), hash = createHash('sha256').update(bytes).digest('hex');
  if(!releaseMode)assert(bytes.includes(Buffer.from(identifier)), 'Review executable must match its selected identifier');
  if(releaseMode) {
    const script = `(Get-Item -LiteralPath '${executable.replaceAll("'", "''")}').VersionInfo.ProductVersion`;
    const version = (await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:10000})).stdout.trim();
    assert(/^0\.8\.0(?:\.0)?$/.test(version),`Production binary version must be 0.8.0, received ${version}`);
  } else assert(bytes.includes(Buffer.from('Vibe99 Review 7')), 'Only isolated Review7 is permitted in default mode');
  const port = releaseMode ? 9258 : 9257;
  try { await fetch(`http://127.0.0.1:${port}/json/version`); throw Error(`CDP port ${port} is occupied`); }
  catch (error) { if (error.message.includes('occupied')) throw error; }
  const settingsPath = join(process.env.APPDATA, identifier, 'settings.json');
  const settingsBefore = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath) : null;
  fs.mkdirSync(resolve('artifacts'), {recursive:true});
  if(settingsBefore !== null)fs.writeFileSync(evidencePath('native-settings-before-review7.bin'),settingsBefore);
  fs.writeFileSync(evidencePath('native-settings-before-review7.json'),JSON.stringify({path:settingsPath,existed:settingsBefore!==null,sha256:settingsBefore?createHash('sha256').update(settingsBefore).digest('hex'):null,binarySha256:hash},null,2));
  const fixture = fs.mkdtempSync(join(tmpdir(), 'vc7-'));
  const profile = fs.mkdtempSync(join(tmpdir(), 'vibe99-companion-webview-'));
  const localPath = join(fixture, 'local.md');
  fs.writeFileSync(localPath, '# Local companion proof\n\nOpened by one click from the original PowerShell terminal.\n');
  const localUnicode = join(fixture, '本地 note.md');
  fs.writeFileSync(localUnicode, '# Local Unicode OSC8 proof\n\nUnicode and spaces resolve safely.\n');
  const remoteRoot = '/tmp/vc7-' + randomUUID().slice(0, 8), remotePath = remoteRoot + '/remote.md';
  const remotePython = async source => {
    const encoded = Buffer.from(source).toString('base64');
    const command = `python3 -c 'import base64;exec(compile(base64.b64decode("${encoded}"),"companion_fixture","exec"))'`;
    const result = await execFileAsync('ssh.exe', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '--', host, command],
      { windowsHide: true, timeout: 25000, maxBuffer: 1024 * 1024 });
    return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  };
  let child, browser, page, remoteCreated = false, source, sourcePid;
  const errors = [], results = [];
  fs.mkdirSync(resolve('artifacts'), { recursive: true });
  const record = (test, data = {}) => { const entry = { test, ...data }; results.push(entry); console.log(JSON.stringify(entry)); };
  try {
    assert.equal(await remotePython(`import os,json\np=${JSON.stringify(remoteRoot)}\nos.mkdir(p,0o700)\nopen(p+'/remote.md','w').write('# Remote companion proof\\n\\nAn existing SSH terminal supplies the connection automatically.\\n')\nopen(p+'/osc.md','w').write('# OSC8 companion proof\\n\\nThe link opens a second document in the same companion.\\n')\nprint(json.dumps(p))`), remoteRoot);
    remoteCreated = true;
    await remotePython(`import json\nopen(${JSON.stringify(remoteRoot + '/远程 note.md')},'w',encoding='utf-8').write('# Remote relative Unicode proof\\n\\nResolved relative to this source terminal.\\n')\nprint(json.dumps(True))`);
    const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: profile };
    delete env.VIBE99_WINDOWS_SHELL;
    child = spawn(executable, [], { windowsHide: true, stdio: 'ignore', env });
    for (let attempt = 0; attempt < 120; attempt++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; }
      catch { if (child.exitCode !== null) throw Error(`Review7 exited: ${child.exitCode}`); }
      await delay(500);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15000 });
    const context = browser.contexts()[0];
    page = context.pages()[0] || await context.waitForEvent('page');
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__TAURI__?.core && document.querySelector('#tabs-add'));
    const nativeTitle = await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().title());
    assert(releaseMode ? nativeTitle === 'Vibe99' : nativeTitle.includes('Vibe99 Review 7'));
    if(releaseMode) {
      assert.equal(await page.evaluate(()=>window.__TAURI__.app.getVersion()),'0.8.0');
      assert.equal(await page.evaluate(()=>window.__TAURI__.app.getIdentifier()),identifier);
    }
    assert.equal(resolve(await page.evaluate(() => window.__TAURI__.path.appDataDir())).toLowerCase(), dirname(settingsPath).toLowerCase());
    // Listen before creating our own pane; IDs come only from real UI/events.
    await page.evaluate(async () => {
      window.__companionEvidence = { packets: [], exits: [], workspace: [], ipc: [] };
      // Tauri freezes invoke/ipc. Observe the real protocol fetch instead, using
      // cloned responses while returning the original promise and response.
      const originalFetch = window.fetch;
      window.fetch = function(input, options) {
        const promise = originalFetch.apply(this, arguments);
        let command;
        try { const uri = new URL(String(input)); if(uri.hostname === 'ipc.localhost') command = decodeURIComponent(uri.pathname.slice(1)); } catch {}
        if (['plugin:opener|open_url','workspace_open','workspace_close'].includes(command)) {
          const args = JSON.parse(typeof options.body === 'string' ? options.body : new TextDecoder().decode(options.body));
          const record = {command,args,status:'pending'};
          window.__companionEvidence.ipc.push(record);
          promise.then(async response => {
            const body = await response.clone().text();
            if(response.headers.get('Tauri-Response') === 'ok') {record.status='fulfilled';try{record.result=JSON.parse(body);}catch{record.result=body;}}
            else {record.status='rejected';record.error=body;}
          },error=>{record.status='rejected';record.error=String(error);});
        }
        return promise;
      };
      await window.__TAURI__.event.listen('vibe99:terminal-data', ({ payload }) => window.__companionEvidence.packets.push(payload));
      await window.__TAURI__.event.listen('vibe99:terminal-exit', ({ payload }) => window.__companionEvidence.exits.push(payload));
      await window.__TAURI__.event.listen('vibe99:workspace-event', ({ payload }) => window.__companionEvidence.workspace.push(payload));
    });
    const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI__.core.invoke(command, args), { command, args });
    const write = data => invoke('terminal_write', { ...source, data: Buffer.from(data).toString('base64') });
    const packetIndex = () => page.evaluate(() => window.__companionEvidence.packets.length);
    const waitOutput = (from, text) => page.waitForFunction(({ from, text, source }) => window.__companionEvidence.packets.slice(from)
      .filter(p => p.paneId === source.paneId && p.sessionId === source.sessionId).map(p => p.data).join('').includes(text),
      { from, text, source }, { timeout: 25000 });
    const existingIds = await page.locator('.tab').evaluateAll(tabs => tabs.map(t => t.dataset.paneId));
    await page.locator('#tabs-add').click();
    await page.waitForFunction(ids => [...document.querySelectorAll('.tab')].some(t => !ids.includes(t.dataset.paneId)), existingIds);
    const paneId = await page.locator('.tab').evaluateAll((tabs, ids) => tabs.find(t => !ids.includes(t.dataset.paneId)).dataset.paneId, existingIds);
    await page.waitForFunction(paneId => window.__companionEvidence.packets.some(p => p.paneId === paneId), paneId, { timeout: 25000 });
    source = await page.evaluate(paneId => { const packet = window.__companionEvidence.packets.find(p => p.paneId === paneId); return { paneId, sessionId: packet.sessionId }; }, paneId);
    const sourcePane = async () => {
      const index = await page.locator('.tab').evaluateAll((tabs, id) => tabs.findIndex(t => t.dataset.paneId === id), paneId);
      assert(index >= 0, 'Original source pane remains present');
      return page.locator('.pane').nth(index);
    };
    const focusSource = async () => {
      await page.bringToFront();
      await page.locator(`.tab[data-pane-id="${paneId}"] .tab-main`).click();
    };
    const clickTopLink = async (control = false, evidenceName = null) => {
      await focusSource();
      const screen = (await sourcePane()).locator('.xterm-screen');
      const box = await screen.boundingBox();
      assert(box && box.width > 100 && box.height > 30, 'Source terminal is visible');
      await page.mouse.move(box.x + 90, box.y + 55, { steps: 4 });
      await page.mouse.wheel(0, 10000);
      await delay(150);
      await page.mouse.move(box.x + 90, box.y + 55, { steps: 2 });
      await page.mouse.move(box.x + 42, box.y + 9, { steps: 5 });
      if(evidenceName) {
        await page.screenshot({path:evidencePath(`native-link-before-${evidenceName}-review7.png`)});
        const viewport=await (await sourcePane()).locator('.xterm-viewport').evaluate(el=>({scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
        record('preclick-view',{kind:evidenceName,point:{x:box.x+42,y:box.y+9},viewport});
      }
      await (await sourcePane()).locator('.xterm-cursor-pointer').waitFor({ timeout: 5000 });
      if(control)await page.keyboard.down('Control');
      try { await page.mouse.click(box.x + 42, box.y + 9); }
      finally { if(control)await page.keyboard.up('Control'); }
    };
    const readers = [];
    const paneFor = async id => {
      const observed = page.locator(`.pane[data-native-observed-pane="${id}"]`);
      if(await observed.count())return observed;
      const index = await page.locator('.tab').evaluateAll((tabs, id) => tabs.findIndex(t => t.dataset.paneId === id), id);
      assert(index >= 0, `Pane ${id} remains present`);
      return page.locator('.pane').nth(index);
    };
    const printLocal = async (payload, label) => {
      await focusSource(); const from = await packetIndex();
      const encoded = Buffer.from('\x1b[3J\x1b[2J\x1b[H' + payload + '\r\n').toString('base64');
      await write(`[Console]::Write([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))\r`);
      await waitOutput(from, label); await delay(200);
    };
    const printRemote = async (payload, label) => {
      await focusSource(); const from = await packetIndex();
      const encoded = Buffer.from('\x1b[3J\x1b[2J\x1b[H' + payload + '\r\n').toString('base64');
      await write(`python3 -c 'import sys,base64;sys.stdout.write(base64.b64decode("${encoded}").decode())'\r`);
      await waitOutput(from, label); await delay(200);
    };
    const clickDocument = async (heading, allowLocation = false) => {
      const before = await page.locator('.tab').evaluateAll(t => t.map(x => x.dataset.paneId));
      await clickTopLink();
      if (allowLocation) {
        await page.waitForFunction(heading => [...document.querySelectorAll('h1')].some(e => e.textContent === heading) || document.querySelector('.preview-context-dialog[open]'), heading, {timeout:15000});
        const dialog = page.locator('.preview-context-dialog[open]');
        if (await dialog.count()) {
          await dialog.locator('input[name=target]').fill(host);
          await dialog.locator('input[name=root]').fill(remoteRoot);
          await dialog.getByRole('button',{name:'Open preview',exact:true}).click();
          record('relative-location-explicit-fallback', { reason:'OSC7 unavailable through this terminal transport' });
        } else record('relative-location-osc7-inherited');
      }
      await page.getByRole('heading', {name:heading,exact:true}).last().waitFor({timeout:35000});
      const after = await page.locator('.tab').evaluateAll(t => t.map(x => x.dataset.paneId));
      const added = after.filter(id => !before.includes(id));
      assert.equal(added.length,1,'Every click creates one distinct ordinary reader');
      assert.equal(after.indexOf(added[0]),after.indexOf(paneId)+1,'New reader inserted directly right of source');
      // Observe the actual new DOM root; tab insertion does not reorder existing roots.
      await page.getByRole('heading',{name:heading,exact:true}).last().locator('xpath=ancestor::article[contains(@class,"pane-preview")]').evaluate((element,id)=>{element.dataset.nativeObservedPane=id;},added[0]);
      readers.push(added[0]);
      const preview = (await paneFor(added[0])).locator('.preview-document');
      assert.equal(await preview.locator('form,input,select,.preview-toolbar,.preview-terminal-toggle,.xterm').count(),0);
      assert.equal(await page.locator('.preview-context-dialog[open]').count(),0);
      assert.equal(await (await sourcePane()).locator('.xterm').count(),1);
      return added[0];
    };
    const closeReader = async id => {
      await page.locator(`.tab[data-pane-id="${id}"] .tab-close`).click();
      await page.locator(`.tab[data-pane-id="${id}"]`).waitFor({state:'detached'});
      readers.splice(readers.indexOf(id),1);
    };
    await printLocal(localPath, localPath);
    const firstLocal = await clickDocument('Local companion proof');
    await printLocal(localPath,localPath);
    const repeatedLocal = await clickDocument('Local companion proof');
    assert.notEqual(firstLocal,repeatedLocal);
    await closeReader(firstLocal); await closeReader(repeatedLocal);
    await printLocal(`\x1b]8;;${pathToFileURL(localUnicode).href}\x07Local Unicode document\x1b]8;;\x07`, 'Local Unicode document');
    const unicodeLocalReader = await clickDocument('Local Unicode OSC8 proof');
    let from = await packetIndex(); await write("Write-Output ('LOCAL_'+'SOURCE_STILL_USABLE')\r");
    await waitOutput(from,'LOCAL_SOURCE_STILL_USABLE');
    await page.screenshot({path:evidencePath('native-companion-local-review7.png')});
    record('local-plain-repeated-and-unicode-osc8',{source,distinctReaders:true});

    await focusSource(); await write(`ssh ${host}\r`);
    let detected;
    for(let attempt=0;attempt<8;attempt++) {
      detected=await invoke('terminal_preview_context',source);
      if(detected.kind==='ssh')break;
      await delay(500);
    }
    assert.deepEqual(detected,{kind:'ssh',target:host}); await delay(1000);
    from=await packetIndex();
    await write(`cd '${remoteRoot}'; printf '%s' "$$" > '${remoteRoot}/source.pid'; printf '%s%s\n' REMOTE_ READY\r`);
    await waitOutput(from,'REMOTE_READY');
    sourcePid=await remotePython(`import json\nprint(json.dumps(int(open(${JSON.stringify(remoteRoot+'/source.pid')}).read())))`);
    assert(Number.isSafeInteger(sourcePid)&&sourcePid>1);
    await printRemote(remotePath,remotePath);
    const remoteReader=await clickDocument('Remote companion proof');
    assert((await (await paneFor(remoteReader)).locator('.preview-document-name').getAttribute('title')).includes(host));
    await printRemote(`\x1b]8;;file://${remoteRoot}/osc.md\x07Open OSC8 document\x1b]8;;\x07`,'Open OSC8 document');
    const remoteOscReader=await clickDocument('OSC8 companion proof');
    await printRemote(`\x1b]7;file://quant${remoteRoot}\x07"远程 note.md"`,'远程 note.md');
    const relativeReader=await clickDocument('Remote relative Unicode proof',true);
    record('remote-plain-osc8-relative-unicode',{detected,sourcePid,remoteReader,remoteOscReader,relativeReader});

    // These are genuine plugin-opener calls forwarded unchanged to Windows.
    // Only the promise results are recorded; no opener mock or unsafe URI is used.
    for(const [style,url] of [['plain','http://example.com/?vibe99-review7=plain'],['osc8','https://example.com/?vibe99-review7=osc8']]) {
      const count=await page.evaluate(()=>window.__companionEvidence.ipc.filter(x=>x.command==='plugin:opener|open_url').length);
      const payload=style==='plain'?url:`\x1b]8;;${url}\x07Open HTTPS example\x1b]8;;\x07`;
      await printRemote(payload,style==='plain'?url:'Open HTTPS example');
      await clickTopLink(true,style);
      await page.waitForFunction(count=>window.__companionEvidence.ipc.filter(x=>x.command==='plugin:opener|open_url').length>count && window.__companionEvidence.ipc.filter(x=>x.command==='plugin:opener|open_url').at(-1).status!=='pending',count,{timeout:10000});
      const call=await page.evaluate(()=>window.__companionEvidence.ipc.filter(x=>x.command==='plugin:opener|open_url').at(-1));
      assert.equal(call.args.url,url);assert.equal(call.status,'fulfilled',call.error);
      assert.equal(await page.locator('.preview-context-dialog[open]').count(),0);
      record('real-remote-http-opener',{style,url,gesture:'Ctrl+click',status:call.status});
    }
    // Native regression: old MD hover cache must not activate after the same
    // visible row is replaced by HTTPS. No reset/clear/resize between these two.
    await printRemote(remotePath,remotePath);
    await focusSource();
    const regressionBox=await (await sourcePane()).locator('.xterm-screen').boundingBox();
    await page.mouse.move(regressionBox.x+90,regressionBox.y+55);
    await page.mouse.move(regressionBox.x+42,regressionBox.y+9);
    await (await sourcePane()).locator('.xterm-cursor-pointer').waitFor({timeout:5000});
    await page.mouse.move(5,5); // leave BEFORE the output changes
    const redrawUrl='https://example.com/?vibe99-review7=redraw';
    const redraw=Buffer.from('\x1b[H\x1b]8;;'+redrawUrl+'\x07New redraw HTTPS\x1b]8;;\x07\x1b[K').toString('base64');
    from=await packetIndex();
    await write(`python3 -c 'import sys,base64;sys.stdout.write(base64.b64decode("${redraw}").decode())'\r`);
    await waitOutput(from,'New redraw HTTPS');await delay(550);
    await page.mouse.move(regressionBox.x+50,regressionBox.y+9); // adjacent cell, same row
    await (await sourcePane()).locator('.xterm-cursor-pointer').waitFor({timeout:5000});
    await page.screenshot({path:evidencePath('native-link-before-redraw-review7.png')});
    const counts=await page.evaluate(()=>({openers:window.__companionEvidence.ipc.filter(x=>x.command==='plugin:opener|open_url').length,workspaces:window.__companionEvidence.ipc.filter(x=>x.command==='workspace_open').length}));
    await page.keyboard.down('Control');
    try{await page.mouse.click(regressionBox.x+50,regressionBox.y+9);}finally{await page.keyboard.up('Control');}
    await page.waitForFunction(count=>window.__companionEvidence.ipc.filter(x=>x.command==='plugin:opener|open_url').length>count && window.__companionEvidence.ipc.filter(x=>x.command==='plugin:opener|open_url').at(-1).status!=='pending',counts.openers,{timeout:10000});
    const redrawCall=await page.evaluate(()=>window.__companionEvidence.ipc.filter(x=>x.command==='plugin:opener|open_url').at(-1));
    assert.equal(redrawCall.args.url,redrawUrl);assert.equal(redrawCall.status,'fulfilled',redrawCall.error);
    assert.equal(await page.evaluate(()=>window.__companionEvidence.ipc.filter(x=>x.command==='workspace_open').length),counts.workspaces,'Redrawn HTTPS must not open stale Markdown');
    record('native-same-row-md-to-https-redraw',{url:redrawUrl,status:redrawCall.status,noStaleMarkdown:true});
    from=await packetIndex();await write("printf '%s%s\n' SOURCE_SSH_ STILL_USABLE\r");await waitOutput(from,'SOURCE_SSH_STILL_USABLE');
    await closeReader(remoteOscReader);
    assert.equal((await invoke('terminal_preview_context',source)).kind,'ssh');
    assert.equal(await remotePython(`import os,json\nprint(json.dumps(os.path.exists('/proc/${sourcePid}')))`),true);
    record('closing-reader-preserves-source');
    await page.locator(`.tab[data-pane-id="${paneId}"] .tab-close`).click();
    await page.waitForFunction(source=>window.__companionEvidence.exits.some(e=>e.paneId===source.paneId&&e.sessionId===source.sessionId),source,{timeout:20000});
    for(const id of readers)assert.equal(await page.locator(`.tab[data-pane-id="${id}"]`).count(),1,'Source close must preserve independent readers');
    const cleaned=await remotePython(`import os,json,time\npid=${sourcePid}\ndef alive():\n try:return open('/proc/%d/stat'%pid).read().split(') ')[1].split()[0]!='Z'\n except FileNotFoundError:return False\nfor _ in range(100):\n if not alive():break\n time.sleep(.1)\nprint(json.dumps(not alive()))`);
    assert.equal(cleaned,true);
    const refreshedText = '# Refreshed after source exit\n\nThe reader independently stays connected.\n';
    await remotePython(`import json\nopen(${JSON.stringify(remotePath)},'w').write(${JSON.stringify(refreshedText)})\nprint(json.dumps(True))`);
    await page.locator(`.tab[data-pane-id="${remoteReader}"] .tab-main`).click();
    await (await paneFor(remoteReader)).getByRole('heading',{name:'Refreshed after source exit',exact:true}).waitFor({timeout:15000});
    assert.equal(await (await paneFor(unicodeLocalReader)).getByRole('heading',{name:'Local Unicode OSC8 proof',exact:true}).count(),1);
    record('source-close-preserves-readers-and-live-refresh',{sourceCleaned:cleaned,readers:readers.length});
    await page.screenshot({path:evidencePath('native-companion-independent-review7.png')});
    const workspaceIds=await page.evaluate(()=>window.__companionEvidence.ipc.filter(x=>x.command==='workspace_open'&&x.status==='fulfilled').map(x=>x.args.workspaceId));
    for(const id of [...readers])await closeReader(id);
    await page.waitForFunction(ids=>ids.every(id=>window.__companionEvidence.ipc.some(x=>x.command==='workspace_close'&&x.args.workspaceId===id&&x.status==='fulfilled')),workspaceIds,{timeout:10000});
    for(const workspaceId of workspaceIds)await assert.rejects(invoke('workspace_request',{workspaceId,method:'stat',args:{path:remotePath}}),/not found/i);
    const openers=await page.evaluate(()=>window.__companionEvidence.ipc.filter(x=>x.command==='plugin:opener|open_url'));
    assert.equal(openers.length,3);assert(openers.every(x=>/^https?:/.test(x.args.url)&&x.status==='fulfilled'));
    assert.deepEqual(errors,[],'No page runtime errors');
    record('reader-helper-cleanup',{closedWorkspaces:workspaceIds.length});
    record('PASS',{executableSha256:hash,identifier,releaseMode});
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: evidencePath('native-companion-failure-review7.png') }).catch(() => {});
      const evidence = await page.evaluate(() => ({
        tabs: [...document.querySelectorAll('.tab')].map(t => ({ id: t.dataset.paneId, text: t.textContent })),
        dialog: document.querySelector('.preview-context-dialog[open]')?.textContent,
        status: document.querySelector('.preview-document-status')?.textContent,
        events: window.__companionEvidence,
      })).catch(() => ({}));
      fs.writeFileSync(evidencePath('native-companion-failure-review7.json'), JSON.stringify({ error: String(error), hash, errors, ...evidence }, null, 2));
    }
    throw error;
  } finally {
    if (page) await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(() => {});
    await browser?.close().catch(() => {});
    if (child) {
      for (let attempt = 0; child.exitCode === null && attempt < 50; attempt++) await delay(100);
      if (child.exitCode === null) await execFileAsync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      for (let attempt = 0; child.exitCode === null && attempt < 20; attempt++) await delay(100);
      assert(child.exitCode !== null, 'Review7 must exit before restoring its settings');
      if (settingsBefore === null) fs.rmSync(settingsPath, { force: true });
      else { fs.mkdirSync(dirname(settingsPath), { recursive: true }); fs.writeFileSync(settingsPath, settingsBefore); }
      assert(settingsBefore === null ? !fs.existsSync(settingsPath) : fs.readFileSync(settingsPath).equals(settingsBefore), 'Exact pre-test settings must be restored');
      record('settings-restored',{identifier,originallyExisted:settingsBefore!==null,ownedProcessExited:true});
    }
    if (remoteCreated) await remotePython(`import os,shutil,json\np=os.path.realpath(${JSON.stringify(remoteRoot)})\nassert os.path.dirname(p)=='/tmp' and os.path.basename(p).startswith('vc7-')\nif os.path.isdir(p):shutil.rmtree(p)\nprint(json.dumps({'removed':not os.path.exists(p)}))`);
    for (const [directory, prefix] of [[fixture, 'vc7-'], [profile, 'vibe99-companion-webview-']]) {
      const canonical = fs.realpathSync(directory);
      assert(dirname(canonical) === fs.realpathSync(tmpdir()) && basename(canonical).startsWith(prefix));
      fs.rmSync(canonical, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    fs.writeFileSync(evidencePath('native-companion-review7-results.json'), JSON.stringify({ hash, results, errors }, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });


