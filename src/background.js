import {readVault,saveVault,clearVault} from './core/vault.js';
import {redact,sanitizeSnapshot} from './core/redact.js';
import {chooseProvider,validateAction,PROFILE_FIELDS,boundPage} from './core/policy.js';
import {Session} from './core/session.js';
import {upgradeGeminiModel} from './core/models.js';

const states=new Map();
async function binding(tabId) {return (await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`];}
async function send(tabId,message) {
  const r=await chrome.tabs.sendMessage(tabId,{sentinel:true,...message},{frameId:0});
  if(!r?.ok) throw Error(r?.error || 'The page is unavailable. Click the extension again.');
  return r.data;
}
async function mount(tabId,token) {
  await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
  await send(tabId,{type:'mount',token});
}
chrome.action.onClicked.addListener(async tab=>{
  if(!tab.id || !/^https?:/.test(tab.url || '')) {await chrome.action.setBadgeText({text:'!',tabId:tab.id});return;}
  try {
    const old=await binding(tab.id);
    const token=old?.token || crypto.randomUUID();
    await chrome.storage.session.set({[`tab:${tab.id}`]:{token}});
    await mount(tab.id,token);await chrome.action.setBadgeText({text:'',tabId:tab.id});
  } catch {await chrome.action.setBadgeText({text:'!',tabId:tab.id});}
});
chrome.tabs.onUpdated.addListener(async(tabId,change)=>{
  if(change.status==='loading') states.delete(tabId);
  if(change.status==='complete') {
    const b=await binding(tabId);
    if(b) try {await mount(tabId,b.token);} catch {await chrome.action.setBadgeText({tabId,text:'!'});}
  }
});
chrome.tabs.onRemoved.addListener(tabId=>{states.delete(tabId);chrome.storage.session.remove(`tab:${tabId}`);});
async function authorize(sender,token) {
  if(sender.id!==chrome.runtime.id || !sender.tab?.id || !sender.url?.startsWith(chrome.runtime.getURL('panel.html'))) throw Error('Untrusted extension request.');
  const b=await binding(sender.tab.id);
  if(!b || b.token!==token) throw Error('Open Sentinel using the extension toolbar button.');
  return sender.tab.id;
}
function stateFor(tabId,steps=0) {
  if(!states.has(tabId)) states.set(tabId,{session:new Session(),steps});
  return states.get(tabId);
}
async function recordStep(tabId,state) {
  state.steps++;
  const b=await binding(tabId);
  if(b) await chrome.storage.session.set({[`tab:${tabId}`]:{...b,steps:state.steps}});
}
async function handle(message,sender) {
  const tabId=await authorize(sender,message.token), b=await binding(tabId),state=stateFor(tabId,b?.steps || 0);
  if(message.type==='ping')return {};
  if(message.type==='init') return {vault:await readVault(),draft:(await chrome.storage.session.get(`draft:${tabId}`))[`draft:${tabId}`] || ''};
  if(message.type==='save') {
    state.session.invalidate();state.execution=null;
    const v=message.vault;
    const profile=Object.fromEntries(PROFILE_FIELDS.map(f=>[f,String(v.profile?.[f] || '').slice(0,2000)]));
    await saveVault({profile,apiKey:String(v.apiKey || '').trim(),keywords:(v.keywords || []).filter(x=>typeof x==='string' && x.trim()).slice(0,200),geminiModel:upgradeGeminiModel(String(v.geminiModel || '').trim()),localConsent:!!v.localConsent});
    for(const s of states.values()) {s.session.invalidate();s.execution=null;s.payload=null;s.raw=null;}
    return {};
  }
  if(message.type==='delete') {await clearVault();for(const s of states.values()){s.session.invalidate();s.execution=null;s.payload=null;s.raw=null;}return {};}
  if(message.type==='stop') {state.session.invalidate();state.execution=null;return {};}
  if(message.type==='close') {states.delete(tabId);await chrome.storage.session.remove([`tab:${tabId}`,`draft:${tabId}`]);return send(tabId,{type:'close'});}
  if(message.type==='scan') {
    state.session.invalidate();state.execution=null;
    const vault=await readVault(),rules={profile:{...vault.profile,apiKey:vault.apiKey},keywords:vault.keywords};
    const raw=await send(tabId,{type:'scan',rules:{profile:vault.profile,keywords:vault.keywords}});
    const prompt=redact(String(message.prompt || ''),rules).slice(0,3000);
    const route=chooseProvider(message.provider,prompt,!!vault.apiKey);
    const payload={prompt,page:boundPage(sanitizeSnapshot(raw,rules),route.provider),provider:route.provider,model:route.provider==='gemini'?vault.geminiModel:'SmolLM2-360M'};
    state.raw=raw;state.payload=payload;state.mode=message.mode==='auto'?'auto':'ask';state.session.review(payload);
    await chrome.storage.session.set({[`draft:${tabId}`]:{prompt,provider:message.provider,mode:state.mode}});
    return {payload,reason:route.reason,origin:new URL(raw.url).origin};
  }
  if(message.type==='approve') {
    if(!state.payload) throw Error('Scan a page first.');
    const current=await send(tabId,{type:'check'});
    if(current.revision!==state.raw.revision) throw Error('The page changed. Scan again.');
    const vault=await readVault(),rules={profile:{...vault.profile,apiKey:vault.apiKey},keywords:vault.keywords};
    const edited=message.page;
    if(!edited || typeof edited.text!=='string' || !Array.isArray(edited.elements)) throw Error('Preview must contain text and elements.');
    const elements=edited.elements.map(e=>{
      const original=state.payload.page.elements.find(x=>x.id===e.id);
      if(!original || typeof e.label!=='string') throw Error('Do not change element IDs in the preview.');
      return {...original,label:redact(e.label,rules)};
    });
    const payload={...state.payload,page:boundPage({...state.payload.page,text:redact(edited.text,rules),elements},state.payload.provider)};
    state.payload=payload;state.session.review(payload);state.session.approve();return payload;
  }
  if(message.type==='run') {
    const current=await send(tabId,{type:'check'});
    if(current.revision!==state.raw?.revision) {state.session.invalidate();throw Error('The page changed. Scan and approve again.');}
    if(state.steps>=30) throw Error('Task reached the 30-action limit. Close and reopen to start a new task.');
    const payload=state.session.take();state.execution={id:crypto.randomUUID(),payload};
    return {id:state.execution.id,payload};
  }
  if(message.type==='execute') {
    if(!state.execution || message.id!==state.execution.id) throw Error('Execution was stopped or approval expired.');
    const execution=state.execution,{payload}=execution;
    const stillAuthorized=()=>{if(state.execution!==execution || states.get(tabId)!==state) throw Error('Execution was stopped or approval expired.');};
    const action=validateAction(message.action,payload.page.elements);
    if(['finish','error'].includes(action.type)) {
      const current=await send(tabId,{type:'check'});
      if(current.revision!==state.raw.revision) throw Error('Page changed before the result could be verified.');
      stillAuthorized();
      state.execution=null;
      const vault=await readVault();return {finished:true,type:action.type,summary:redact(action.summary,{profile:{...vault.profile,apiKey:vault.apiKey},keywords:vault.keywords})};
    }
    if(action.type==='navigate') {
      const current=await send(tabId,{type:'check'});
      if(current.revision!==state.raw.revision) throw Error('The page changed. Scan and approve again.');
      if(!message.confirmed) return {navigation:action.url};
      if(!await chrome.permissions.contains({origins:[`${new URL(action.url).origin}/*`]})) throw Error('Grant access to the destination before navigating.');
      stillAuthorized();
      await recordStep(tabId,state);stillAuthorized();state.execution=null;
      await chrome.tabs.update(tabId,{url:action.url});return {navigated:true};
    }
    const current=await send(tabId,{type:'check'});
    if(current.revision!==state.raw.revision) {state.execution=null;throw Error('The page changed. Scan and approve again.');}
    const vault=await readVault();
    stillAuthorized();
    const result=await send(tabId,{type:'execute',action,revision:state.raw.revision,mode:state.mode,confirmed:!!message.confirmed,value:action.type==='fillProfile'?vault.profile[action.field]:undefined});
    if(!result.confirmation && !result.navigation){state.execution=null;await recordStep(tabId,state);}
    return result;
  }
  throw Error('Unsupported extension request.');
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!message || message.sentinel || !message.token) return;
  handle(message,sender).then(data=>respond({ok:true,data})).catch(e=>respond({ok:false,error:e.message || 'Extension operation failed.'}));
  return true;
});
