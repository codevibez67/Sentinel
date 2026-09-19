import {pipeline,env} from '@huggingface/transformers';
import {makeMessages,parseAction} from './providers.js';
env.allowLocalModels=false;
env.backends.onnx.wasm.wasmPaths=new URL('./wasm/',self.location.href).href;
env.backends.onnx.wasm.numThreads=1;
env.backends.onnx.wasm.proxy=false;
let generator;
self.onmessage=async({data})=>{
  try {
    if(!generator) generator=await pipeline('text-generation','onnx-community/SmolLM2-360M-Instruct-ONNX',{
      dtype:'q8',device:'wasm',progress_callback:p=>self.postMessage({kind:'progress',text:p.status==='progress'?`Downloading ${p.file}: ${Math.round(p.progress || 0)}%`:p.status==='ready'?'Local model ready.':'Preparing local model…'}),
    });
    if(data.type==='download') {self.postMessage({kind:'ready'});return;}
    const messages=makeMessages(data.payload);
    const formatted=generator.tokenizer.apply_chat_template(messages,{tokenize:false,add_generation_prompt:true});
    const encoded=await generator.tokenizer(formatted);
    if(encoded.input_ids.dims[1]>6000){self.postMessage({kind:'error',text:'The local model input is too large. Shorten the preview or select Gemini and approve again.'});return;}
    const result=await generator(messages,{max_new_tokens:180,do_sample:false,return_full_text:false});
    const generated=result[0].generated_text;
    const text=typeof generated==='string'?generated:generated.at(-1).content;
    self.postMessage({kind:'action',action:parseAction(text)});
  } catch {self.postMessage({kind:'error',text:'Local model could not complete this request. Check available memory/network, or select Gemini and approve again.'});}
};
