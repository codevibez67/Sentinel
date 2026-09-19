export const PROFILE_FIELDS=['name','username','email','phone','address','password'];
export function boundPage(page,provider) {
  return {...page,text:page.text.slice(0,provider==='local'?4000:18000),elements:page.elements.slice(0,provider==='local'?40:120)};
}
const shapes={click:['type','id'],type:['type','id','text'],fillProfile:['type','id','field'],scroll:['type','direction'],navigate:['type','url'],finish:['type','summary'],error:['type','summary']};
export function validateAction(action,elements=[]) {
  if(!action || typeof action!=='object' || Array.isArray(action) || !Object.hasOwn(shapes,action.type)) throw Error('Model returned an unsupported action.');
  const keys=shapes[action.type];
  if(Object.keys(action).length!==keys.length || keys.some(k=>typeof action[k]!=='string') || Object.keys(action).some(k=>!keys.includes(k))) throw Error('Invalid action fields.');
  if(action.id) {
    const el=elements.find(e=>e.id===action.id);
    if(!el) throw Error('The requested element is not in this preview.');
    if(action.type==='type' && (el.type==='password' || /password|otp|verification|passcode/i.test(el.label || ''))) throw Error('Private values must come from the local profile.');
    if(['type','fillProfile'].includes(action.type) && !['input','textarea','select'].includes(el.tag)) throw Error('Target is not a supported input.');
  }
  if(action.type==='fillProfile' && !PROFILE_FIELDS.includes(action.field)) throw Error('Unknown profile field.');
  if(action.type==='scroll' && !['up','down'].includes(action.direction)) throw Error('Invalid scroll direction.');
  if(action.type==='navigate') {
    const u=new URL(action.url);
    if(!['http:','https:'].includes(u.protocol) || u.username || u.password) throw Error('Only ordinary HTTP(S) navigation is allowed.');
  }
  if(Object.values(action).some(v=>v.length>2000)) throw Error('Action is too large.');
  return action;
}
export function chooseProvider(choice,prompt,hasCloud) {
  if(choice==='local' || choice==='gemini') return {provider:choice,reason:'Selected by you.'};
  if(choice!=='auto') throw Error('Unknown provider.');
  const complex=/compare|research|analy[sz]e|across|summari[sz]e|multiple|plan|\band then\b/i.test(prompt) || prompt.length>240;
  return complex && hasCloud ? {provider:'gemini',reason:'This task needs broader reasoning; Auto selected Gemini.'} : {provider:'local',reason:complex?'No Gemini key is configured; Auto selected local.':'A short, focused task; Auto selected local.'};
}
