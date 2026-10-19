import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve(import.meta.dirname,'../prototype');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8'};
const host='127.0.0.1',port=Number(process.env.PORT||8789);
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,`http://${host}`);
  const target=resolve(root,decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname).replace(/^\/+/,''));
  if(!(target===root||target.startsWith(root+sep))){res.writeHead(403).end();return;}
  if(!(await stat(target)).isFile()){res.writeHead(404).end();return;}
  const bytes=await readFile(target);
  res.writeHead(200,{'content-type':types[extname(target)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(bytes);
 }catch{res.writeHead(404).end('Not found');}
}).listen(port,host,()=>console.log(`SmartOps demo: http://${host}:${port}`));
