
const CACHE='fnt-shell-'+"assets/index-B6L9c45E.js|assets/index-yZV76Zrh.css|assets/ingredients-import-BmhC5aAz.js|assets/references-import-02AdKgzs.js|assets/xlsx-DthUxqdB.js|assets/xlsx-export-BLkFlpiD.js|assets/xlsx-native-CtQ8GDMw.js";
const FILES=["./","./index.html","./icon.svg","./manifest.webmanifest","./testing-workbook.json","./assets/index-yZV76Zrh.css","./assets/index-B6L9c45E.js","./assets/xlsx-DthUxqdB.js","./assets/references-import-02AdKgzs.js","./assets/xlsx-export-BLkFlpiD.js","./assets/xlsx-native-CtQ8GDMw.js","./assets/ingredients-import-BmhC5aAz.js"];
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
  if(event.request.mode==='navigate'||new URL(event.request.url).pathname===new URL('./testing-workbook.json',self.registration.scope).pathname){
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
