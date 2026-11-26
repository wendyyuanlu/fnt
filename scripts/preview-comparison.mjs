import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdtemp,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {build} from 'vite';
import {comparisonSample} from '../prototypes/comparison/sample.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
export async function startComparisonPreview({port=5188,dataDir,locationFile}={}){
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid comparison port.');
  if(dataDir){
    dataDir=resolve(dataDir);
    const within=relative(repo,dataDir);
    if(!isAbsolute(within)&&within!=='..'&&!within.startsWith('..'+sep))throw Error('Private comparison data must be outside the repository.');
    for(const name of ['left.json','right.json','source-meta.json']){
      if(!(await stat(join(dataDir,name))).isFile())throw Error('Missing private comparison source.');
    }
  }
  const output=await mkdtemp(join(tmpdir(),'fnt-comparison-'));
  let server;
  try{
    await build({configFile:false,root:join(repo,'prototypes','comparison'),base:'./',logLevel:'error',
      build:{outDir:output,emptyOutDir:true,minify:false,sourcemap:false}});
    const files=new Map(),types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
    async function addFiles(directory,prefix=''){
      for(const entry of await readdir(directory,{withFileTypes:true})){
        if(entry.isDirectory())await addFiles(join(directory,entry.name),prefix+entry.name+'/');
        else{
          const extension=entry.name.slice(entry.name.lastIndexOf('.'));
          if(types[extension])files.set(prefix+entry.name,{file:join(directory,entry.name),type:types[extension]});
        }
      }
    }
    await addFiles(output);
    const sample=comparisonSample(),sources=new Map([
      ['left.json',sample.left],['right.json',sample.right],['source-meta.json',sample.meta],
    ]);
    const prefix='/review/'+randomBytes(16).toString('hex')+'/';
    server=createServer((request,response)=>{
      const actualPort=server.address().port;
      if(![`127.0.0.1:${actualPort}`,`localhost:${actualPort}`].includes(request.headers.host??'')){
        response.writeHead(403);response.end('Local preview only.');return;
      }
      const url=new URL(request.url,'http://127.0.0.1');
      const name=url.pathname===prefix?'index.html':url.pathname.startsWith(prefix)?url.pathname.slice(prefix.length):'';
      if(request.method!=='GET'||(!files.has(name)&&!sources.has(name))){response.writeHead(404);response.end('Not found');return;}
      const asset=files.get(name);
      response.writeHead(200,{'Content-Type':(asset?.type??'application/json')+'; charset=utf-8','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'self'; connect-src 'self' https://api.github.com; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
      if(!asset&&!dataDir){response.end(JSON.stringify(sources.get(name)));return;}
      const stream=createReadStream(asset?.file??join(dataDir,name));
      stream.on('error',()=>response.destroy());stream.pipe(response);
    });
    await new Promise((success,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',success);});
    const url=`http://127.0.0.1:${server.address().port}${prefix}`;
    if(locationFile)await writeFile(locationFile,JSON.stringify({url}));
    return{url,close:async()=>{await new Promise((success,fail)=>server.close(error=>error?fail(error):success()));await rm(output,{recursive:true});}};
  }catch(error){
    if(server?.listening)await new Promise(done=>server.close(done));
    await rm(output,{recursive:true});throw error;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const preview=await startComparisonPreview({
    port:process.env.FNT_COMPARISON_PORT===undefined?5188:Number(process.env.FNT_COMPARISON_PORT),
    dataDir:process.env.FNT_COMPARISON_DATA_DIR,locationFile:process.env.FNT_COMPARISON_LOCATION,
  });
  console.log(`Comparison prototype (${process.env.FNT_COMPARISON_DATA_DIR?'private local sources':'invented sample data'}): ${preview.url}`);
  let closing=false;
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{
    if(closing)return;closing=true;await preview.close();process.exit(0);
  });
}
