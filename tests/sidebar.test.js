import test from 'node:test';
import assert from 'node:assert/strict';

test('toolbar opens the sidebar before asynchronous setup loses the user gesture',async()=>{
  let clicked,inGesture=true,opened=false,configured,stored;
  const badges=[];
  globalThis.chrome={
    runtime:{onMessage:{addListener(){}}},
    storage:{session:{set:()=>new Promise(resolve=>{stored=resolve;})}},
    action:{onClicked:{addListener:fn=>{clicked=fn;}},setBadgeText:async value=>badges.push(value.text),setTitle:async()=>{}},
    sidePanel:{
      setOptions:options=>{
        assert.equal(options.tabId,undefined,'Shared sidebar remains visible across tabs');
        assert.match(options.path,/^panel\.html\?tabId=1#/);
        return new Promise(resolve=>{configured=resolve;});
      },
      open:async options=>{
        assert.ok(inGesture,'open() must be called synchronously from the toolbar click');
        assert.equal(options.windowId,7);opened=true;
      }
    },
    tabs:{onActivated:{addListener(){}},onUpdated:{addListener(){}},onRemoved:{addListener(){}}}
  };
  await import(`../src/background.js?sidebar-test=${Date.now()}`);
  const launch=clicked({id:1,windowId:7,url:'https://example.com'});
  inGesture=false;
  assert.equal(opened,true,'Opening must not wait for storage or sidebar configuration');
  configured();stored();await launch;
  assert.deepEqual(badges,['']);
});
