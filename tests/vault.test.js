import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {saveVault,readVault,clearVault} from '../src/core/vault.js';
test('persisted nonextractable key reopens data and deletion removes it', async()=>{
  await saveVault({profile:{name:'Jane'},apiKey:'secret'});
  assert.equal((await readVault()).profile.name,'Jane');
  await clearVault();
  assert.deepEqual((await readVault()).profile,{});
});
test('upgrades obsolete saved Gemini default without changing credentials or custom model choices',async()=>{
  await saveVault({profile:{name:'Jane'},apiKey:'private',geminiModel:'gemini-2.5-flash'});
  const upgraded=await readVault();assert.equal(upgraded.geminiModel,'gemini-3.6-flash');assert.equal(upgraded.apiKey,'private');assert.equal(upgraded.profile.name,'Jane');
  await saveVault({...upgraded,geminiModel:'gemini-3.5-flash'});assert.equal((await readVault()).geminiModel,'gemini-3.5-flash');
});
