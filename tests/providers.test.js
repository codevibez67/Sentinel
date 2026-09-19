import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMessages, parseAction, callGemini, verifyGemini, checkGeminiConnection } from '../src/providers.js';
test('model messages only include approved fields and never pass incidental metadata',()=>{
  const messages=makeMessages({prompt:'fill form',page:{text:'safe',elements:[],origin:'https://example.com',revision:'x',html:'SECRET'},apiKey:'SECRET',profile:{password:'SECRET'}});
  assert.ok(!JSON.stringify(messages).includes('SECRET'));
  assert.ok(JSON.stringify(messages).includes('fill form'));
});
test('404 identifies unavailable model and points to Settings rather than blaming quota',async()=>{
  await assert.rejects(callGemini({prompt:'test',page:{text:'test',elements:[]}},'key','obsolete',undefined,async()=>({ok:false,status:404})),/model.*unavailable.*404.*Settings/i);
});
test('temporary 503 retries the same approved model once and returns its action',async()=>{
  const urls=[];
  const action=await callGemini({prompt:'test',page:{text:'test',elements:[]}},'key','gemini-3.6-flash',undefined,async url=>{
    urls.push(url);return urls.length===1?{ok:false,status:503}:{ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"type":"finish","summary":"Done"}'}]}}]})};
  });assert.equal(action.type,'finish');assert.equal(urls.length,2);assert.equal(urls[0],urls[1]);
});
test('connection verification uses synthetic content only',async()=>{
  let body;
  await verifyGemini('key','gemini-3.6-flash',undefined,async(_url,options)=>{body=options.body;return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"type":"finish","summary":"Connection verified"}'}]}}]})};});
  assert.ok(body.includes('Connection test'));assert.ok(!body.includes('undefined'));
});
test('connection check validates the selected model before sending synthetic content',async()=>{
  const calls=[];
  await checkGeminiConnection('key','gemini-3.6-flash',undefined,async(url,options={})=>{
    calls.push({url,method:options.method || 'GET'});
    return calls.length===1 ? {ok:true,json:async()=>({name:'models/gemini-3.6-flash'})} : {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"type":"finish","summary":"Connection verified"}'}]}}]})};
  });
  assert.deepEqual(calls.map(c=>c.method),['GET','POST']);
  assert.match(calls[0].url,/models\/gemini-3\.6-flash$/);
});
test('connection check stops before generation when the selected model is unavailable',async()=>{
  let calls=0;
  await assert.rejects(checkGeminiConnection('key','missing',undefined,async()=>{calls++;return {ok:false,status:404};}),/unavailable.*404/i);
  assert.equal(calls,1);
});
test('parses one JSON action and rejects prose and action batches',()=>{
  assert.equal(parseAction('{"type":"finish","summary":"Done"}').type,'finish');
  assert.throws(()=>parseAction('Here is some text'));
  assert.throws(()=>parseAction('[{"type":"click","id":"e1"}]'));
});
test('Gemini sends the key only in authentication and rejects HTTP errors without exposing response bodies',async()=>{
  let request;
  const fetcher=async(url,options)=>{request={url,...options};return {ok:false,status:403,text:async()=> 'SECRET'};};
  await assert.rejects(callGemini({prompt:'safe',page:{text:'safe',elements:[]}},'PRIVATE_KEY','gemini-2.5-flash',undefined,fetcher), e=>!e.message.includes('SECRET'));
  assert.equal(request.headers['x-goog-api-key'],'PRIVATE_KEY');
  assert.ok(!request.body.includes('PRIVATE_KEY'));
});
