import {callGemini,checkGeminiConnection} from './providers.js';
import {upgradeGeminiModel} from './core/models.js';
import {PROFILE_FIELDS} from './core/policy.js';
const $=id=>document.getElementById(id),token=location.hash.slice(1);
let vault,worker,workerPending,aborter,epoch=0,pending,busy=false;
const rpc=async(type,extra={})=>{
  const r=await chrome.runtime.sendMessage({type,token,...extra});
  if(!r?.ok) throw Error(r?.error || 'The extension could not connect. Reopen it from the toolbar.');
  return r.data;
};
function notice(text) {$('notice').textContent=text;$('notice').hidden=!text;}
function log(text) {const li=document.createElement('li');li.textContent=text;$('activity').append(li);while($('activity').children.length>40)$('activity').firstElementChild.remove();}
function show(page) {document.querySelectorAll('.page').forEach(e=>e.classList.toggle('active',e.id===page));document.querySelectorAll('[data-page]').forEach(e=>e.classList.toggle('active',e.dataset.page===page));}
function status(text) {$('status').textContent=text;}
function setBusy(value) {
  busy=value;
  for(const id of ['scan','approve','run','prompt','provider','mode','preview','download']) $(id).disabled=value;
  $('stop').disabled=!value;
  if(!value) {$('run').disabled=true;$('approve').disabled=!$('preview').value;}
}
async function invalidate() {
  epoch++;aborter?.abort();pending=null;$('confirmation').hidden=true;
  if(workerPending){worker?.terminate();worker=null;workerPending.reject(Error('Stopped.'));workerPending=null;}
  await rpc('stop');setBusy(false);$('run').disabled=true;status('NEEDS REVIEW');
}
function localCall(type,payload) {
  if(!vault.localConsent) throw Error('Download the local model in Settings first.');
  if(!worker) {
    worker=new Worker(chrome.runtime.getURL('local-worker.js'),{type:'module'});
    worker.onmessage=({data})=>{
      if(data.kind==='progress') {$('download-status').textContent=data.text;$('model-progress').textContent=data.text;return;}
      const p=workerPending;workerPending=null;if(!p)return;
      if(data.kind==='error')p.reject(Error(data.text));else p.resolve(data.action);
    };
    worker.onerror=()=>{workerPending?.reject(Error('The local model worker could not start.'));workerPending=null;worker?.terminate();worker=null;};
  }
  return new Promise((resolve,reject)=>{
    const timer=type==='generate'?setTimeout(()=>{worker?.terminate();worker=null;workerPending=null;reject(Error('Local processing exceeded three minutes. Finish the model download in Settings, or select Gemini and approve again.'));},180000):null;
    workerPending={resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};worker.postMessage({type,payload});
  });
}
async function scan() {
  await invalidate();notice('');log('Reading page and redacting locally…');setBusy(true);
  try {
    const result=await rpc('scan',{prompt:$('prompt').value,provider:$('provider').value,mode:$('mode').value});
    $('prompt').value=result.payload.prompt;
    $('preview').value=JSON.stringify({text:result.payload.page.text,elements:result.payload.page.elements},null,2);
    $('route').textContent=`${result.payload.provider.toUpperCase()} · ${result.payload.model} · ${result.reason}`;
    $('destination').textContent=`Approved filling destination: ${result.origin}`;
    $('unsupported').textContent=`${result.payload.page.unsupported} image/frame regions excluded`;
    log('Redacted preview ready. Review it, then Approve.');status('NEEDS REVIEW');
  } finally {setBusy(false);}
}
async function afterAction(result) {
  if(result.finished) {setBusy(false);status(result.type==='finish'?'FINISHED':'ERROR');log(`${result.type==='finish'?'Model reports completion':'Task stopped'}: ${result.summary}`);$('approve').disabled=true;return;}
  if(result.navigated) {log('Opening destination. Review the new page before continuing.');return;}
  log('Action executed. Reading the updated page…');await scan();
}
async function execute(action,id,confirmed=false) {
  const result=await rpc('execute',{action,id,confirmed});
  if(result.confirmation || result.navigation) {
    pending={action,id,url:result.navigation};
    $('confirmation-text').textContent=result.navigation?`Allow access and navigate to ${new URL(result.navigation).origin}?`:`Allow this click on the approved page? Target ${action.id}.`;
    $('confirmation').hidden=false;log('Waiting for your action confirmation.');return;
  }
  await afterAction(result);
}
async function run() {
  notice('');const runEpoch=++epoch;setBusy(true);status('RUNNING');
  try {
    const {id,payload}=await rpc('run');
    log(`Processing approved text with ${payload.provider==='local'?'the local model':'Gemini'}…`);
    $('model-progress').textContent=`Waiting for ${payload.model}…`;
    aborter=new AbortController();
    const action=payload.provider==='local'?await localCall('generate',payload):await callGemini(payload,vault.apiKey,payload.model,aborter.signal);
    $('model-progress').textContent='Model response received.';
    if(epoch!==runEpoch)return;
    log(`Checking requested action: ${action.type}.`);await execute(action,id);
  } catch(e) {
    if(epoch===runEpoch){await invalidate();throw e;}
  }
}
function guard(fn) {return async event=>{try{await fn(event);}catch(e){notice(e.message);log(e.message);if(busy)await invalidate().catch(()=>{});}};}
function fillSettings() {
  for(const field of PROFILE_FIELDS) document.querySelector(`[name="${field}"]`).value=vault.profile[field] || '';
  $('api-key').value=vault.apiKey;$('gemini-model').value=vault.geminiModel;$('keywords').value=vault.keywords.join('\n');
}
async function save() {await invalidate();await rpc('save',{vault});$('preview').value='';$('approve').disabled=true;notice('Saved encrypted on this device. Scan again to apply your changes.');}
for(const field of PROFILE_FIELDS) {
  const label=document.createElement('label');label.textContent=field[0].toUpperCase()+field.slice(1);
  const input=document.createElement('input');input.name=field;input.type=field==='password'?'password':field==='email'?'email':'text';input.autocomplete='off';label.append(input);$('profile-fields').append(label);
}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>show(b.dataset.page));
$('scan').onclick=guard(scan);
$('approve').onclick=guard(async()=>{
  if(!$('prompt').value.trim())throw Error('Enter a task before approving.');
  const payload=await rpc('approve',{page:JSON.parse($('preview').value)});
  $('preview').value=JSON.stringify({text:payload.page.text,elements:payload.page.elements},null,2);
  $('run').disabled=false;$('approve').disabled=true;status('APPROVED');log('Preview approved. Run is a separate step.');
});
$('run').onclick=guard(run);
$('stop').onclick=guard(async()=>{await invalidate();log('Stopped. No further actions will run.');});
$('close').onclick=guard(async()=>{await invalidate();worker?.terminate();await rpc('close');});
for(const id of ['prompt','provider','mode']) $(id).addEventListener('input',guard(async()=>{await invalidate();$('preview').value='';$('approve').disabled=true;}));
$('preview').addEventListener('input',guard(invalidate));
$('confirm-action').onclick=guard(async()=>{
  if(!pending)return;const p=pending;
  if(p.url && !await chrome.permissions.request({origins:[`${new URL(p.url).origin}/*`]})) throw Error('Destination access was not granted.');
  pending=null;$('confirmation').hidden=true;await execute(p.action,p.id,true);
});
$('cancel-action').onclick=guard(async()=>{await invalidate();log('Action cancelled.');});
$('profile-form').onsubmit=guard(async event=>{event.preventDefault();vault.profile=Object.fromEntries(PROFILE_FIELDS.map(f=>[f,document.querySelector(`[name="${f}"]`).value]));await save();show('chat');});
$('save-keywords').onclick=guard(async()=>{vault.keywords=$('keywords').value.split('\n').map(s=>s.trim()).filter(Boolean);await save();});
$('keyword-selection').onclick=guard(async()=>{
  const p=$('preview'),selection=p.value.slice(p.selectionStart,p.selectionEnd).trim();
  if(!selection)throw Error('Select the missed text in the preview first.');
  vault.keywords=[...new Set([...vault.keywords,selection])];$('keywords').value=vault.keywords.join('\n');await save();await scan();
});
$('save-settings').onclick=guard(async()=>{vault.apiKey=$('api-key').value.trim();vault.geminiModel=upgradeGeminiModel($('gemini-model').value.trim());$('gemini-model').value=vault.geminiModel;await save();});
$('verify-gemini').onclick=guard(async()=>{
  const button=$('verify-gemini');button.disabled=true;
  try {
    await invalidate();notice('Checking API key and model…');
    const key=$('api-key').value.trim(),model=upgradeGeminiModel($('gemini-model').value.trim());
    await checkGeminiConnection(key,model,undefined,fetch,notice);
    vault.apiKey=key;vault.geminiModel=model;$('gemini-model').value=model;await save();$('provider').value='gemini';
    notice(`Gemini connected: ${model}. Open Assistant, scan, approve, and Run.`);log(`Gemini connection verified: ${model}.`);
  } finally {button.disabled=false;}
});
$('download').onclick=guard(async()=>{
  vault.localConsent=true;await save();setBusy(true);log('Downloading the local model. Page content is not sent.');
  try {await localCall('download');$('download-status').textContent='Local model ready. Files are cached in this browser.';log('Local model ready.');}finally{setBusy(false);}
});
$('delete-data').onclick=guard(async()=>{
  if(!confirm('Delete your encrypted profile, Gemini key, keywords, and downloaded model cache?'))return;
  await invalidate();worker?.terminate();worker=null;await rpc('delete');
  for(const name of await caches.keys())await caches.delete(name);
  vault=(await rpc('init')).vault;fillSettings();$('preview').value='';$('prompt').value='';$('approve').disabled=true;notice('Local profile, settings and model cache deleted.');
});
try {
  const initial=await rpc('init');vault=initial.vault;fillSettings();
  // Keep the ephemeral approval/execution state alive while this interface is open.
  // If the browser suspends the interface, the worker still fails closed on lost state.
  setInterval(()=>rpc('ping').catch(()=>{}),20000);
  $('prompt').value=typeof initial.draft==='string'?initial.draft:(initial.draft.prompt || '');
  if(initial.draft.provider)$('provider').value=initial.draft.provider;
  if(initial.draft.mode)$('mode').value=initial.draft.mode;
  if(!Object.values(vault.profile).some(Boolean))show('profile');else await scan();
}catch(e){notice(e.message);document.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=true);}
