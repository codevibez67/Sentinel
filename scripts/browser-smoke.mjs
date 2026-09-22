import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,readdir,cp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const server=http.createServer(async(req,res)=>{res.setHeader('content-type','text/html');res.end(req.url.startsWith('/done')?'<h1>Registration complete</h1><p>Your test registration succeeded.</p>':await readFile('tests/fixture.html'));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const cache=path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
const installed=(await readdir(cache)).filter(x=>/^chromium-\d+$/.test(x)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]));
const executablePath=process.env.CHROME_PATH || path.join(cache,installed[0],'chrome-win64','chrome.exe');
function testDirectory(value,prefix) {
  const resolved=path.resolve(value),parent=path.resolve(os.tmpdir());
  if(path.dirname(resolved).toLowerCase()!==parent.toLowerCase() || !path.basename(resolved).startsWith(prefix))throw Error('Only an isolated Sentinel test directory may be reused.');
  return resolved;
}
const userDataDir=process.env.TEST_PROFILE?testDirectory(process.env.TEST_PROFILE,'sentinel-test-'):await mkdtemp(path.join(os.tmpdir(),'sentinel-test-'));
const extension=process.env.TEST_EXTENSION?testDirectory(process.env.TEST_EXTENSION,'sentinel-extension-'):await mkdtemp(path.join(os.tmpdir(),'sentinel-extension-'));
await cp(path.resolve('dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
// Grant only the loopback fixture origin, replacing the toolbar's activeTab grant in automation.
manifest.host_permissions.push(`${origin}/*`);
await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
// Capture the production toolbar handler only in the temporary test build.
const backgroundPath=path.join(extension,manifest.background.service_worker);
await writeFile(backgroundPath,`const registerToolbar=chrome.action.onClicked.addListener.bind(chrome.action.onClicked);chrome.action.onClicked.addListener=handler=>{globalThis.testToolbarClick=handler;registerToolbar(handler);};\n${await readFile(backgroundPath,'utf8')}`);
await writeFile(path.join(extension,'test-launch.html'),'<button id="launch">Open sidebar</button><script type="module" src="test-launch.js"></script>');
await writeFile(path.join(extension,'test-launch.js'),`import './background.js';const params=new URL(location.href).searchParams;const tab=await chrome.tabs.get(Number(params.get('tabId')));document.querySelector('#launch').onclick=async()=>{await globalThis.testToolbarClick(tab);document.body.dataset.launched='true';};`);
let context;
try {
  context=await chromium.launchPersistentContext(userDataDir,{executablePath,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1400,height:1050}});
  const sw=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page=await context.newPage();await page.goto(origin);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const tabId=await sw.evaluate(async origin=>(await chrome.tabs.query({})).find(t=>t.url?.startsWith(origin)).id,origin);
  const launcher=await context.newPage();
  const launcherURL=await sw.evaluate(({tabId,origin})=>chrome.runtime.getURL(`test-launch.html?tabId=${tabId}&origin=${encodeURIComponent(origin)}`),{tabId,origin});
  await launcher.goto(launcherURL);
  await launcher.locator('#launch').click();
  await launcher.locator('body[data-launched=true]').waitFor();
  await launcher.close();
  const launch=await sw.evaluate(async tabId=>({badge:await chrome.action.getBadgeText({tabId}),title:await chrome.action.getTitle({tabId}),options:await chrome.sidePanel.getOptions({tabId}),binding:(await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`]}),tabId);
  assert.equal(launch.badge,'',launch.title);
  assert.equal(launch.options.enabled,true,'Native sidebar is enabled');
  const token=launch.binding.token;
  // Close the native document before opening the automatable copy, so there is
  // only one panel listening to tab changes during the workflow assertions.
  await sw.evaluate(async({tabId,token})=>{
    await chrome.sidePanel.setOptions({enabled:false});
    const tab=await chrome.tabs.get(tabId);
    await chrome.storage.session.set({[`tab:${tabId}`]:{token,targetTabId:tabId,windowId:tab.windowId}});
  },{tabId,token});
  await page.waitForTimeout(500);
  // Headless Chromium does not expose browser-chrome side panel UI to Playwright.
  // Exercise the same extension document and tab binding in a separate test page.
  const panel=await context.newPage();
  const panelURL=await sw.evaluate(({tabId,token})=>chrome.runtime.getURL(`panel.html?tabId=${tabId}#${token}`),{tabId,token});
  await panel.goto(panelURL);
  await panel.waitForFunction(()=>document.querySelector('#preview').value.includes('elements')).catch(async error=>{console.log('Auto-scan diagnostic',await panel.locator('#notice').textContent(),await panel.locator('#activity').textContent());throw error;});
  assert.equal(page.frames().length,1,'Assistant no longer overlays the webpage with an iframe');
  await panel.locator('[data-page=profile]').click();
  await panel.locator('[name=name]').fill('Jane Sample');
  await panel.locator('[name=email]').fill('jane.secret@example.com');
  await panel.locator('[name=password]').fill('Private-Pass-998!');
  await panel.locator('#profile-form button').click();
  await panel.locator('[data-page=settings]').click();
  await panel.locator('#api-key').fill('TEST_KEY_ONLY');
  await panel.locator('#save-settings').click();
  await panel.locator('[data-page=redaction]').click();
  await panel.locator('#keywords').fill('Apollo Orchard');await panel.locator('#save-keywords').click();
  await panel.locator('[data-page=chat]').click();
  await panel.locator('#prompt').fill('Fill ');
  await page.waitForTimeout(900);
  assert.equal(await panel.locator('#prompt').isDisabled(),false,'Pausing while typing must not lock the task field');
  assert.equal(await panel.locator('#prompt').inputValue(),'Fill ','Typing preserves the exact draft');
  await panel.locator('#prompt').pressSequentially('and submit the registration form',{delay:40});
  assert.equal(await panel.locator('#prompt').inputValue(),'Fill and submit the registration form');
  assert.equal(await panel.locator('#stop').isVisible(),true,'Stop remains visible beside Run');
  await panel.locator('#provider').selectOption('gemini');
  let requests=0,nextAction;
  await context.route('https://generativelanguage.googleapis.com/**',async route=>{
    requests++;const body=route.request().postData();
    for(const secret of ['Jane Sample','jane.secret@example.com','Private-Pass-998!','Alice Martin','42 Market Road','alice@example.com','Apollo Orchard','TEST_KEY_ONLY'])assert.ok(!body.includes(secret),`Leaked ${secret}`);
    await route.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(nextAction)}]}}]})});
  });
  const scan=async()=>{
    await panel.locator('[data-page=privacy]').click();
    await panel.locator('#scan').click();await page.waitForTimeout(250);
    await panel.locator('[data-page=chat]').click();
    await panel.locator('#run').waitFor({state:'visible'});
  };
  const preview=async()=>JSON.parse(await panel.locator('#preview').inputValue());
  await page.waitForTimeout(700);
  assert.ok((await panel.locator('#preview').inputValue()).includes('elements'),'Task edits preserve the page preview');
  const second=await context.newPage();await second.goto(`${origin}/other`);
  await second.locator('h1').evaluate(el=>{el.textContent='Second tab marker';});
  await page.bringToFront();await page.waitForTimeout(600);
  await second.bringToFront();
  await panel.waitForFunction(()=>document.querySelector('#preview').value.includes('Second tab marker'));
  assert.ok(!(await panel.locator('#preview').inputValue()).includes('Alice Martin'),'Switched tab is redacted automatically');
  assert.equal(await panel.locator('#run').isDisabled(),false,'Run becomes available after the new tab is scanned');
  assert.equal(requests,0,'Automatic tab scans make no model calls');
  await page.bringToFront();
  await panel.waitForFunction(()=>document.querySelector('#preview').value.includes('Create your test account'));
  await second.close();
  await scan();
  assert.equal(requests,0,'Scan must not call a provider');
  await page.evaluate(()=>{
    const p=document.createElement('p');p.id='split-keyword';p.innerHTML='<span>Apollo</span> <strong>Orchard</strong>';document.body.prepend(p);
    const filler=document.createElement('p');filler.id='long-filler';filler.textContent='Public information. '.repeat(2000);document.body.append(filler);
    const late=document.createElement('p');late.id='late-private';late.textContent='Apollo Orchard';document.body.append(late);late.scrollIntoView();
  });
  await page.waitForTimeout(300);
  const cdp=await context.newCDPSession(page);
  const tree=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
  const flatten=n=>[n,...(n.children || []).flatMap(flatten),...(n.shadowRoots || []).flatMap(flatten)];
  const boxes=flatten(tree.root).filter(n=>n.nodeName==='DIV' && (n.attributes || []).some(v=>v.includes('background: rgb(25, 39, 53)')));
  assert.ok(boxes.length,'PII beyond extraction limit is visually masked when scrolled into view');
  await page.evaluate(()=>{document.querySelector('#long-filler').remove();document.querySelector('#late-private').remove();scrollTo(0,0);});
  await scan();
  let p=await preview();assert.ok(!JSON.stringify(p).includes('Alice Martin'));assert.ok(!JSON.stringify(p).includes('Apollo Orchard'));
  assert.ok(!p.text.includes('Apollo'),'Keywords split across inline markup are redacted');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/redaction-preview.png'});
  assert.equal(requests,0,'Scanning must not call a provider');
  await page.locator('#evidence').evaluate(el=>{el.textContent='Page changed after approval';});
  await panel.locator('#run').click();await page.waitForTimeout(250);
  assert.equal(requests,0,'Stale page must not reach a provider');
  assert.match(await panel.locator('#notice').innerText(),/changed/i);
  await scan();
  for(const field of ['name','email','password']) {
    p=await preview();const target=p.elements.find(e=>e.tag==='input' && e.label.toLowerCase().startsWith(field));
    assert.ok(target,`Find ${field} target`);nextAction={type:'fillProfile',id:target.id,field};
    await panel.locator('#run').click();
    await page.waitForTimeout(400);
    assert.ok(await page.locator(`input[name=${field}]`).inputValue());
    assert.equal(await panel.locator('#run').isDisabled(),false,'Run is available for the refreshed page');
  }
  await page.locator('button[type=submit]').evaluate(el=>el.setAttribute('formaction','https://other.example/collect'));
  await panel.locator('#mode').selectOption('auto');await scan();
  p=await preview();nextAction={type:'click',id:p.elements.find(e=>e.tag==='button').id};
  await panel.locator('#run').click();await page.waitForTimeout(350);
  assert.equal(new URL(page.url()).origin,origin,'Submit override cannot move private values to another origin');
  assert.match(await panel.locator('#notice').innerText(),/another origin/i);
  await page.locator('button[type=submit]').evaluate(el=>el.removeAttribute('formaction'));
  await panel.locator('#mode').selectOption('ask');await scan();
  p=await preview();nextAction={type:'click',id:p.elements.find(e=>e.tag==='button').id};
  await panel.locator('#run').click();
  await panel.locator('#confirmation').waitFor({state:'visible'});
  assert.equal(new URL(page.url()).pathname,'/','Ask mode must pause before submit');
  await panel.locator('#confirm-action').click();
  await page.waitForURL('**/done');await page.waitForTimeout(700);
  assert.ok(!panel.isClosed(),'Panel persists after navigation');
  await panel.locator('#preview').waitFor({state:'attached'});await page.waitForTimeout(300);
  assert.equal(await panel.locator('#run').isDisabled(),false);
  await panel.locator('#provider').selectOption('gemini');await scan();
  // Stop while an inference request is in flight; its eventual result cannot act.
  let release;
  await context.route('https://generativelanguage.googleapis.com/**',async route=>{
    await new Promise(resolve=>{release=resolve;});
    await route.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{text:'{"type":"finish","summary":"Should not be displayed"}'}]}}]})}).catch(()=>{});
  });
  await panel.locator('#run').click();
  for(let i=0;i<20 && !release;i++)await page.waitForTimeout(50);
  assert.ok(release,'Inference is pending');await panel.locator('#stop').click();release();await page.waitForTimeout(150);
  assert.ok(!(await panel.locator('#activity').innerText()).includes('Should not be displayed'));
  await context.unrouteAll({behavior:'wait'});
  await context.route('https://generativelanguage.googleapis.com/**',async route=>route.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(nextAction)}]}}]})}));
  await scan();
  nextAction={type:'finish',summary:'Registration complete is visible on the page.'};
  await panel.locator('#run').click();await page.waitForTimeout(300);
  assert.equal(await panel.locator('#status').innerText(),'FINISHED');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/extension-smoke.png'});
  assert.deepEqual(errors,[]);
  if(process.env.TEST_LOCAL==='1') {
    await panel.locator('[data-page=settings]').click();await panel.locator('#download').click();
    const started=Date.now();let ready=false;
    while(Date.now()-started<Number(process.env.LOCAL_TIMEOUT_MS || 1200000)){
      await page.waitForTimeout(5000);const progress=await panel.locator('#download-status').innerText();console.log('Local model:',progress);
      if(progress.includes('Files are cached')){ready=true;break;}
      const warning=await panel.locator('#notice').innerText();if(/could not|failed/i.test(warning))throw Error(warning);
    }
    assert.ok(ready,'Local model downloads and initializes with packaged WASM');
    await panel.locator('[data-page=chat]').click();
    await panel.locator('#prompt').fill('Registration is complete. Finish the task.');
    await panel.locator('#provider').selectOption('local');await scan();
    await panel.locator('#run').click();
    for(let i=0;i<60;i++){await page.waitForTimeout(2000);if(await panel.locator('#status').innerText()!=='RUNNING')break;}
    console.log('Local inference result:',await panel.locator('#status').innerText(),await panel.locator('#notice').innerText());
    assert.equal(await panel.locator('#status').innerText(),'FINISHED','Actual local model completes the simple fixture task');
  }
  console.log(`PASS: real extension onboarding, redaction, no-call approval, stale-page rejection, three profile fills, submit confirmation, navigation, and completion. ${requests} intercepted Gemini requests, no seeded secrets leaked.`);
}finally{await context?.close();server.close();}
