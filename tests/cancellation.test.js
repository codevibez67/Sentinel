import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {saveVault} from '../src/core/vault.js';

test('Stop invalidates an action while its privileged page check is awaiting',async()=>{
  let receiver,hold=false,release,entered,dispatches=0;
  const checked=new Promise(r=>{entered=r;});
  const storage={'tab:1':{token:'test'}};
  const raw={revision:'r1',url:'https://example.com',text:'form',elements:[{id:'e1',tag:'input',type:'text',label:'name'}]};
  globalThis.chrome={
    runtime:{id:'extension',getURL:p=>`chrome-extension://extension/${p}`,onMessage:{addListener:f=>{receiver=f;}}},
    storage:{session:{get:async key=>({[key]:storage[key]}),set:async values=>Object.assign(storage,values)}},
    action:{onClicked:{addListener(){}}},
    scripting:{executeScript:async()=>{}},
    tabs:{onActivated:{addListener(){}},onUpdated:{addListener(){}},onRemoved:{addListener(){}},sendMessage:async(_id,message)=>{
      if(message.type==='check' && hold){entered();await new Promise(r=>{release=r;});}
      if(message.type==='execute')dispatches++;
      return {ok:true,data:raw};
    }},
  };
  await import(`../src/background.js?cancel-test=${Date.now()}`);
  await saveVault({profile:{name:'Jane'},apiKey:'',keywords:[]});
  const rpc=(type,extra={})=>new Promise(resolve=>receiver({type,token:'test',...extra},{id:'extension',url:'chrome-extension://extension/panel.html?tabId=1#test'},resolve));
  const untrusted=await new Promise(resolve=>receiver({type:'ping',token:'test'},{id:'extension',url:'chrome-extension://extension/panel.html?tabId=2#test'},resolve));
  assert.equal(untrusted.ok,false,'Panel cannot target a tab without its matching binding');
  await rpc('scan',{prompt:'fill name',provider:'local'});
  await rpc('approve',{page:{text:'form',elements:raw.elements},prompt:'Fill the complete form for Jane after I finish typing',provider:'gemini',mode:'auto'});
  const run=await rpc('run');assert.ok(run.ok);
  assert.ok(run.data.payload.prompt.includes('after I finish typing'),'Run uses the complete current task, not the earlier scan prompt');
  assert.ok(!run.data.payload.prompt.includes('Jane'),'The current task is redacted before inference');
  assert.equal(run.data.payload.provider,'gemini','Run uses the current model selection');
  hold=true;
  const result=rpc('execute',{id:run.data.id,action:{type:'fillProfile',id:'e1',field:'name'}});
  await checked;await rpc('stop');release();
  assert.equal((await result).ok,false);
  assert.equal(dispatches,0,'Cancelled action must not be dispatched');
  hold=false;
  await rpc('save',{vault:{profile:{name:'Jane'},apiKey:'',keywords:['fill name']}});
  assert.equal((await rpc('approve',{page:{text:'form',elements:raw.elements}})).ok,false,'Changed privacy rules require a fresh scan including the task prompt');
});
