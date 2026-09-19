import {upgradeGeminiModel} from './models.js';
export const createKey = () => crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
export async function encrypt(key,value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));
  return {iv:Array.from(iv),data:Array.from(new Uint8Array(data))};
}
export async function decrypt(key,record) {
  const bytes = await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(record.iv)},key,new Uint8Array(record.data));
  return JSON.parse(new TextDecoder().decode(bytes));
}
function database() {
  return new Promise((resolve,reject)=>{
    const r = indexedDB.open('sentinel-vault',1);
    r.onupgradeneeded = ()=>r.result.createObjectStore('records');
    r.onsuccess = ()=>resolve(r.result); r.onerror=()=>reject(r.error);
  });
}
async function transaction(mode, operation) {
  const db = await database();
  try { return await new Promise((resolve,reject)=>{
    const tx=db.transaction('records',mode), store=tx.objectStore('records');
    let result; const request=operation(store);
    if(request) request.onsuccess=()=>{result=request.result;};
    tx.oncomplete=()=>resolve(result); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
  }); } finally { db.close(); }
}
export async function readVault() {
  const key=await transaction('readonly',s=>s.get('key'));
  const data=await transaction('readonly',s=>s.get('data'));
  const vault=key && data ? await decrypt(key,data) : {profile:{},apiKey:'',keywords:[],localConsent:false};
  return {...vault,geminiModel:upgradeGeminiModel(vault.geminiModel)};
}
export async function saveVault(value) {
  const key=(await transaction('readonly',s=>s.get('key'))) || await createKey();
  const record=await encrypt(key,value);
  await transaction('readwrite',s=>{s.put(key,'key');s.put(record,'data');});
}
export const clearVault = ()=>transaction('readwrite',s=>s.clear());
