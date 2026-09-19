import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, sanitizeSnapshot } from '../src/core/redact.js';
import { createKey, encrypt, decrypt } from '../src/core/vault.js';
import { validateAction, chooseProvider, boundPage } from '../src/core/policy.js';
import { Session } from '../src/core/session.js';

test('redacts profile secrets and literal keywords without regex interpretation', () => {
  const text = redact('Jane Doe uses a+b and secret! at jane@example.com', {profile:{name:'Jane Doe',password:'secret!'},keywords:['a+b']});
  for (const secret of ['Jane Doe','a+b','secret!','jane@example.com']) assert.ok(!text.includes(secret));
});
test('private multiword phrases match HTML whitespace variations',()=>{
  assert.ok(!redact('Jane\n  Doe',{keywords:['Jane Doe']}).includes('Jane'));
});
test('detects email, phone, labeled names and addresses without a saved profile', () => {
  const text = redact('Name: Alice Martin\nAddress: 42 Market Road\nEmail alice@example.com\nPhone +1 (415) 555-0199\nOTP: 123456', {});
  for (const secret of ['Alice Martin','42 Market Road','alice@example.com','555-0199','123456']) assert.ok(!text.includes(secret), secret);
});
test('payload sanitizer drops arbitrary metadata and URL tokens', () => {
  const snapshot = sanitizeSnapshot({revision:'r1',url:'https://example.com/path?token=SECRET',text:'hello',html:'SECRET',elements:[{id:'e1',tag:'input',label:'x@example.com',value:'SECRET',type:'password'}]}, {});
  assert.ok(!JSON.stringify(snapshot).includes('SECRET'));
  assert.ok(!JSON.stringify(snapshot).includes('x@example.com'));
  assert.equal(snapshot.origin, 'https://example.com');
});
test('sensitive profile values in a hostname are removed from model origin metadata',()=>{
  const p=sanitizeSnapshot({revision:'r',url:'https://janesample.example.com',text:'',elements:[]},{profile:{username:'janesample'}});
  assert.ok(!JSON.stringify(p).includes('janesample'));
});
test('vault ciphertext roundtrips with fresh nonces and rejects wrong key or corruption', async () => {
  const key = await createKey();
  assert.equal(key.extractable, false);
  const a = await encrypt(key,{password:'secret'}), b = await encrypt(key,{password:'secret'});
  assert.notDeepEqual(a.iv,b.iv);
  assert.deepEqual(await decrypt(key,a),{password:'secret'});
  await assert.rejects(decrypt(await createKey(),a));
  a.data[0] ^= 1;
  await assert.rejects(decrypt(key,a));
});
test('approval is required, single use, and invalidated by edits', () => {
  const s = new Session();
  s.review({revision:'r1'});
  assert.throws(()=>s.take());
  s.approve();
  assert.equal(s.take().revision,'r1');
  assert.throws(()=>s.take());
  s.review({revision:'r2'}); s.approve(); s.invalidate();
  assert.throws(()=>s.take());
});
test('approved snapshot cannot be modified through a caller reference', () => {
  const s = new Session(), p = {revision:'one',text:'safe'};
  s.review(p); s.approve(); p.text='SECRET';
  assert.equal(s.take().text,'safe');
});
test('rejects arbitrary code, invented elements, extra fields and unsafe URLs', () => {
  const elements = [{id:'e1',tag:'input',type:'password'}];
  for(const action of [{type:'eval',code:'x'}, {type:'click',id:'unknown'}, {type:'navigate',url:'javascript:alert(1)'}, {type:'click',id:'e1',script:'x'}, {type:'type',id:'e1',text:'password'}, {type:'fillProfile',id:'e1',field:'apiKey'}]) assert.throws(()=>validateAction(action,elements));
  assert.deepEqual(validateAction({type:'fillProfile',id:'e1',field:'password'},elements),{type:'fillProfile',id:'e1',field:'password'});
});
test('Auto selects by task and never silently changes an explicit choice', () => {
  assert.equal(chooseProvider('local','research everything',true).provider,'local');
  assert.equal(chooseProvider('auto','fill this form',true).provider,'local');
  assert.equal(chooseProvider('auto','compare products across websites',true).provider,'gemini');
  assert.equal(chooseProvider('auto','compare products across websites',false).provider,'local');
});
test('small local model receives a bounded preview while Gemini retains the larger budget',()=>{
  const page={text:'x'.repeat(18000),elements:Array.from({length:120},(_,i)=>({id:`e${i}`}))};
  const local=boundPage(page,'local');
  assert.equal(local.text.length,4000);assert.equal(local.elements.length,40);
  assert.equal(boundPage(page,'gemini').text.length,18000);
});
