import { defineConfig } from 'vite';
import {readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
let publicDirectory='';
let publishedVersion:{modified:number;size:number;id:string}|undefined;
function publishedId():string{
  const file=resolve(publicDirectory,'testing-workbook.json'),info=statSync(file);
  if(publishedVersion?.modified===info.mtimeMs&&publishedVersion.size===info.size)return publishedVersion.id;
  const archive=JSON.parse(readFileSync(file,'utf8')),snapshot=archive.format==='fnt-packed-v1'?archive.data:archive;
  if(snapshot?.format!=='fnt-published-testing'||typeof snapshot.id!=='string'||!snapshot.id)throw Error('Invalid published testing workbook.');
  publishedVersion={modified:info.mtimeMs,size:info.size,id:snapshot.id};
  return snapshot.id;
}
export default defineConfig({
  base: process.env.FNT_BASE_PATH ?? './', server: { host: '127.0.0.1' },
  plugins:[{
    name:'fnt-offline-shell',
    configResolved(config){publicDirectory=config.publicDir;},
    configureServer(server){
      server.middlewares.use((request,response,next)=>{
        if(request.url?.split('?')[0]!=='/testing-workbook-version.json'){next();return;}
        try{
          response.setHeader('Content-Type','application/json');
          response.setHeader('Cache-Control','no-cache');
          response.end(JSON.stringify({format:'fnt-published-version',version:1,id:publishedId()}));
        }catch(error){next(error);}
      });
    },
    generateBundle(_options,bundle){
      const id=publishedId();
      this.emitFile({type:'asset',fileName:'testing-workbook-version.json',source:JSON.stringify({format:'fnt-published-version',version:1,id})});
      const files=[...new Set(['./','./index.html','./icon.svg','./manifest.webmanifest','./testing-workbook.json','./testing-workbook-version.json',...Object.keys(bundle).map(k=>'./'+k)])];
      const version=Object.keys(bundle).sort().join('|')+'|'+id;
      this.emitFile({type:'asset',fileName:'sw.js',source:`
const CACHE='fnt-shell-'+${JSON.stringify(version)};
const FILES=${JSON.stringify(files)};
const loaded=new Map();
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim().then(()=>self.clients.matchAll()).then(clients=>{for(const client of clients)client.postMessage({type:'fnt-update-ready',files:FILES});})));
self.addEventListener('message',event=>{
  if(event.data?.type!=='fnt-shell-loaded'||!event.source?.id)return;
  loaded.set(event.source.id,event.data.file);
  event.waitUntil(self.clients.matchAll().then(async clients=>{
    const current=FILES.map(file=>new URL(file,self.registration.scope).href);
    if(clients.length&&clients.every(client=>current.includes(loaded.get(client.id)))){
      const keys=await caches.keys();
      await Promise.all(keys.filter(key=>key.startsWith('fnt-shell-')&&key!==CACHE).map(key=>caches.delete(key)));
    }
  }));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  if(event.request.mode==='navigate'||['./testing-workbook.json','./testing-workbook-version.json'].some(file=>new URL(event.request.url).pathname===new URL(file,self.registration.scope).pathname)){
    event.respondWith(fetch(event.request).then(async response=>{
      if(!response.ok)throw Error('Website update returned '+response.status);
      const cache=await caches.open(CACHE);await cache.put(event.request,response.clone());return response;
    }).catch(async error=>{
      const cache=await caches.open(CACHE);
      const page=await cache.match(event.request)||(event.request.mode==='navigate'&&await cache.match(new URL('./index.html',self.registration.scope)));
      if(!page)throw error;return page;
    }));return;
  }
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request,{ignoreVary:true})).then(async hit=>hit||await caches.match(event.request,{ignoreVary:true})||fetch(event.request)));
});
`});
    },
  }],
});
