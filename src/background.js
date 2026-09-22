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
  await send(tabId,{type:'mount'});
}
chrome.action.onClicked.addListener(async tab=>{
  if(!tab.id || !/^https?:/.test(tab.url || '')) {await chrome.action.setBadgeText({text:'!',tabId:tab.id});return;}
  try {
    const token=crypto.randomUUID();
    states.delete(tab.id);
    const ready=chrome.storage.session.set({[`tab:${tab.id}`]:{token,windowId:tab.windowId,targetTabId:tab.id}});
    // Keep open() in the original toolbar gesture; awaiting setup can expire it.
    const configured=chrome.sidePanel.setOptions({path:`panel.html?tabId=${tab.id}#${token}`,enabled:true});
    const opened=chrome.sidePanel.open({windowId:tab.windowId});
    await Promise.all([ready,configured,opened]);
    await chrome.action.setBadgeText({text:'',tabId:tab.id});
    await chrome.action.setTitle({title:'Open Sentinel',tabId:tab.id});
  } catch(error) {
    console.error('Sentinel sidebar failed to open:',error);
    await chrome.action.setBadgeText({text:'!',tabId:tab.id});
    await chrome.action.setTitle({title:`Sentinel: ${error.message || 'Could not open the sidebar'}`,tabId:tab.id});
  }
});
chrome.tabs.onActivated.addListener(()=>{
  for(const state of states.values()){state.session.invalidate();state.execution=null;}
});
chrome.tabs.onUpdated.addListener(async(tabId,change)=>{
  if(change.status==='loading') states.delete(tabId);
  if(change.status==='complete') {
    const records=await chrome.storage.session.get(null);
    const b=Object.entries(records).find(([key,value])=>key.startsWith('tab:') && (value.targetTabId || Number(key.slice(4)))===tabId)?.[1];
    if(b) try {
      await mount(tabId,b.token);
      await chrome.runtime.sendMessage({type:'page-ready',tabId}).catch(()=>{});
    } catch {await chrome.action.setBadgeText({tabId,text:'!'});}
  }
});
// The panel's launch binding survives closing its original tab; it now follows
// the window's active tab and is removed when the panel is explicitly closed.
chrome.tabs.onRemoved.addListener(tabId=>{states.delete(tabId);});
async function authorize(sender,token,targetTabId) {
  const url=new URL(sender.url || 'about:blank'),expected=new URL(chrome.runtime.getURL('panel.html'));
  const tabId=Number(url.searchParams.get('tabId'));
  if(sender.id!==chrome.runtime.id || url.protocol!==expected.protocol || url.host!==expected.host || url.pathname!==expected.pathname || !Number.isInteger(tabId) || tabId<=0 || url.hash.slice(1)!==token) throw Error('Untrusted extension request.');
  const b=await binding(tabId);
  if(!b || b.token!==token) throw Error('Open Sentinel using the extension toolbar button.');
  const target=b.targetTabId || tabId;
  if(targetTabId!==undefined && targetTabId!==target)throw Error('The active tab changed. Wait for the new preview.');
  return target;
}
function stateFor(tabId,steps=0) {
  if(!states.has(tabId)) states.set(tabId,{session:new Session(),steps});
  return states.get(tabId);
}
async function recordStep(tabId,state) {
  state.steps++;
  const records=await chrome.storage.session.get(null);
  const entry=Object.entries(records).find(([key,value])=>key.startsWith('tab:') && (value.targetTabId || Number(key.slice(4)))===tabId);
  if(entry) await chrome.storage.session.set({[entry[0]]:{...entry[1],steps:state.steps}});
}
async function handle(message,sender) {
  const tabId=await authorize(sender,message.token,message.type==='init'?undefined:message.targetTabId);
  const anchorId=Number(new URL(sender.url).searchParams.get('tabId'));
  const b=await binding(anchorId),state=stateFor(tabId,b?.steps || 0);
  if(message.type==='switch-tab') {
    const tab=await chrome.tabs.get(message.nextTabId);
    if(tab.windowId!==b.windowId || !tab.active)throw Error('Select a tab in this browser window.');
    state.session.invalidate();state.execution=null;
    await chrome.storage.session.set({[`tab:${anchorId}`]:{...b,targetTabId:tab.id,steps:0}});
    return {tabId:tab.id};
  }
  if(message.type==='ping')return {};
  if(message.type==='init') {
    let currentTabId=tabId;
    // Native panels have no sender.tab. Reopening one must follow the current
    // tab even if the user changed tabs while the panel was closed.
    if(!sender.tab && b.windowId!==undefined){
      const [active]=await chrome.tabs.query({active:true,windowId:b.windowId});
      if(active && active.id!==tabId){
        currentTabId=active.id;state.session.invalidate();state.execution=null;
        await chrome.storage.session.set({[`tab:${anchorId}`]:{...b,targetTabId:currentTabId,steps:0}});
      }
    }
    return {vault:await readVault(),tabId:currentTabId,windowId:b.windowId,draft:(await chrome.storage.session.get(`draft:${currentTabId}`))[`draft:${currentTabId}`] || ''};
  }
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
  if(message.type==='close') {
    states.delete(tabId);await chrome.storage.session.remove([`tab:${anchorId}`,`draft:${tabId}`]);
    await send(tabId,{type:'close'}).catch(()=>{});
    await chrome.sidePanel.setOptions({enabled:false});return {};
  }
  if(message.type==='scan') {
    state.session.invalidate();state.execution=null;
    await mount(tabId,b.token);
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
    const prompt=message.prompt===undefined?state.payload.prompt:redact(String(message.prompt),rules).slice(0,3000);
    const route=message.provider===undefined?{provider:state.payload.provider}:chooseProvider(message.provider,prompt,!!vault.apiKey);
    const payload={...state.payload,prompt,provider:route.provider,model:route.provider==='gemini'?vault.geminiModel:'SmolLM2-360M',page:boundPage({...state.payload.page,text:redact(edited.text,rules),elements},route.provider)};
    if(message.mode!==undefined)state.mode=message.mode==='auto'?'auto':'ask';
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
