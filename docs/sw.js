
const CACHE='fnt-shell-'+"assets/index-CRzAlvS6.css|assets/index-D0WUlCSW.js|assets/ingredients-import-oHaHDa4w.js|assets/master-import-CjLlU7QW.js|assets/meals-import-BEHF0hY2.js|assets/references-import-3YVKZQlK.js|assets/xlsx-DhM4y63J.js|assets/xlsx-export-BS8Wqokt.js|assets/xlsx-native-D7G-_vIu.js|testing-workbook-version.json|game-character-v368-1795595681415";
const FILES=["./","./index.html","./icon.svg","./manifest.webmanifest","./testing-workbook.json","./testing-workbook-version.json","./assets/index-CRzAlvS6.css","./assets/index-D0WUlCSW.js","./assets/xlsx-DhM4y63J.js","./assets/references-import-3YVKZQlK.js","./assets/master-import-CjLlU7QW.js","./assets/meals-import-BEHF0hY2.js","./assets/xlsx-export-BS8Wqokt.js","./assets/xlsx-native-D7G-_vIu.js","./assets/ingredients-import-oHaHDa4w.js"];
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
