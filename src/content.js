import {redact} from './core/redact.js';

if(!globalThis.__sentinelInstalled) {
  globalThis.__sentinelInstalled=true;
  let host,root,frame,overlay,rules={};
  const ids=new WeakMap(), targets=new Map(), documentId=crypto.randomUUID();
  let sequence=0,revision=0,lastSignature='';
  const idFor=el=>{if(!ids.has(el)){const id=`e${++sequence}`;ids.set(el,id);targets.set(id,el);}return ids.get(el);};
  const visible=el=>el && !host?.contains(el) && !['SCRIPT','STYLE','NOSCRIPT'].includes(el.tagName) && el.getClientRects().length && getComputedStyle(el).visibility!=='hidden' && getComputedStyle(el).display!=='none';
  const labelFor=el=>[...(el.labels || [])].map(x=>x.textContent).join(' ').trim() || el.getAttribute('aria-label') || el.getAttribute('placeholder') || (['BUTTON','A','SELECT'].includes(el.tagName)?el.textContent:'') || el.getAttribute('name') || el.tagName.toLowerCase();
  function textGroups() {
    const groups=new Map();
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) {
      const node=walker.currentNode,el=node.parentElement;
      if(!visible(el) || el.closest('script,style,noscript,textarea,select')) continue;
      const block=el.closest('p,div,li,td,th,section,article,header,footer,label,h1,h2,h3,h4,h5,h6,pre,blockquote') || document.body;
      if(!groups.has(block))groups.set(block,[]);
      groups.get(block).push(node);
    }
    return [...groups.values()].map(nodes=>({text:nodes.map(n=>n.textContent).join(''),nodes})).filter(g=>g.text.trim());
  }
  function collect() {
    const groups=textGroups(),text=groups.map(g=>g.text).join('\n').slice(0,30000);
    const elements=[], signatures=[];
    for(const el of document.querySelectorAll('input,textarea,select,button,a[href],[role="button"]')) {
      if(!visible(el) || el.disabled || el.type==='hidden') continue;
      const id=idFor(el),label=labelFor(el)+(el.value && ['INPUT','TEXTAREA'].includes(el.tagName)?' [FILLED]':'');
      elements.push({id,tag:el.tagName.toLowerCase(),type:el.type || '',label});
      signatures.push([id,label,el.type,el.readOnly,el.value || '',el.getAttribute('href'),el.getAttribute('formaction'),el.form?.action]);
      if(elements.length>=120) break;
    }
    const signature=JSON.stringify([location.href,text,signatures,scrollX,scrollY]);
    if(signature!==lastSignature) {revision++;lastSignature=signature;}
    return {revision:`${documentId}:${revision}`,url:location.href,text,elements,unsupported:document.querySelectorAll('img,canvas,video,iframe,svg').length};
  }
  function mask() {
    if(!overlay) return;
    overlay.replaceChildren();
    const add=rect=>{
      if(!rect.width || !rect.height || rect.bottom<0 || rect.top>innerHeight) return;
      const box=document.createElement('div');
      box.style.cssText=`position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:#192735;border-radius:3px;pointer-events:none;`;
      overlay.append(box);
    };
    // Mask the complete rendered text, independently of the model extraction limit.
    for(const group of textGroups()) if(redact(group.text,rules)!==group.text) for(const node of group.nodes) {
      const range=document.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects()) add(rect);
    }
    for(const el of document.querySelectorAll('input,textarea,select')) if(visible(el) && el.value) add(el.getBoundingClientRect());
  }
  function mount(token) {
    if(host) return;
    host=document.createElement('div');host.id='sentinel-root';
    host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    root=host.attachShadow({mode:'closed'});
    overlay=document.createElement('div');frame=document.createElement('iframe');
    frame.src=chrome.runtime.getURL(`panel.html#${token}`);frame.title='Sentinel private assistant';
    frame.style.cssText='position:fixed;right:18px;top:18px;width:min(620px,calc(100vw - 36px));height:calc(100vh - 36px);border:1px solid #cad4dd;border-radius:18px;box-shadow:0 20px 70px #10253655;pointer-events:auto;background:#f7f9fc;color-scheme:light;';
    root.append(overlay,frame);document.documentElement.append(host);
  }
  function execute(message) {
    const current=collect();
    if(current.revision!==message.revision) throw Error('The page changed. Scan and approve a new preview.');
    const a=message.action,el=targets.get(a.id);
    if(a.id && (!el?.isConnected || !visible(el) || el.disabled)) throw Error('The target is no longer available.');
    if(a.type==='click') {
      const link=el.closest('a[href]');
      if(link && !['http:','https:'].includes(new URL(link.href).protocol)) throw Error('This link type is not supported.');
      if(link && new URL(link.href).origin!==location.origin && !message.confirmed) return {navigation:link.href};
      const destination=el.hasAttribute('formaction')?el.formAction:el.form?.action;
      if(destination && new URL(destination,location.href).origin!==location.origin) throw Error('This form submits to another origin. Submit it manually.');
      if(!message.confirmed && message.mode==='ask') return {confirmation:true};
      el.click();
    } else if(a.type==='type' || a.type==='fillProfile') {
      if(!['INPUT','TEXTAREA','SELECT'].includes(el.tagName) || el.readOnly || ['file','hidden','checkbox','radio','submit','button'].includes(el.type)) throw Error('This field is not supported for text filling.');
      if(el.form && new URL(el.form.action,location.href).origin!==location.origin) throw Error('This form submits to another origin. Fill it manually.');
      const value=a.type==='fillProfile'?message.value:a.text;
      if(typeof value!=='string' || !value) throw Error('The requested profile field is empty.');
      const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,value);
      if(el.value!==value) throw Error('The website did not accept that value.');
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    } else if(a.type==='scroll') window.scrollBy(0,(a.direction==='up'?-1:1)*Math.round(innerHeight*.7));
    revision++; mask(); return {done:true};
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id || !message.sentinel) return;
    try {
      let result;
      if(message.type==='mount') {mount(message.token);result={};}
      else if(message.type==='scan') {rules=message.rules; const {nodes,...snapshot}=collect();mask();result=snapshot;}
      else if(message.type==='check') {const {nodes,...snapshot}=collect();result=snapshot;}
      else if(message.type==='execute') result=execute(message);
      else if(message.type==='close') {host?.remove();host=null;frame=null;overlay=null;rules={};result={};}
      else return;
      respond({ok:true,data:result});
    } catch(e) {respond({ok:false,error:e.message});}
  });
  let scheduled=false;
  const refresh=()=>{if(!host || scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;mask();});};
  new MutationObserver(refresh).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
  addEventListener('scroll',refresh,true);addEventListener('resize',refresh);addEventListener('input',refresh,true);
}
