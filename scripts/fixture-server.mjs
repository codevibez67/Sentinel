import http from 'node:http';
import {readFile} from 'node:fs/promises';
const port=Number(process.env.PORT || 4173);
http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url.startsWith('/done')){res.end('<h1>Registration complete</h1><p>Your test registration succeeded.</p>');return;}
  res.end(await readFile(new URL('../tests/fixture.html',import.meta.url)));
}).listen(port,'127.0.0.1',()=>console.log(`Test website: http://127.0.0.1:${port}`));
