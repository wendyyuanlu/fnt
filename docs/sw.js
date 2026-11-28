
const CACHE='fnt-shell-'+"assets/comparison-Cdyj2Fo7.css|assets/comparison-DOXfQkIE.js|assets/icons-CjjU4aPH.js|assets/ingredients-import-BvoZQty_.js|assets/main-BYZYKl00.js|assets/main-Bc3DfHYS.css|assets/main-CITv2EPT.css|assets/main-COAjRcbT.js|assets/master-import-BLNVKHyU.js|assets/meals-import-Bk_RdS6o.js|assets/preload-helper-DO0sjJph.js|assets/references-import-_TvTouGp.js|assets/sync-codec-worker-BfG7oGBE.js|assets/xlsx-C13V5yy0.js|assets/xlsx-export-NqPJcZnw.js|assets/xlsx-native-BvCzrz77.js|testing-workbook-version.json|game-character-v557-1795598713397";
const FILES=["./","./index.html","./icon.svg","./manifest.webmanifest","./testing-workbook.json","./testing-workbook-version.json","./assets/comparison-Cdyj2Fo7.css","./assets/main-CITv2EPT.css","./assets/main-Bc3DfHYS.css","./assets/comparison-DOXfQkIE.js","./assets/main-BYZYKl00.js","./assets/preload-helper-DO0sjJph.js","./assets/main-COAjRcbT.js","./assets/icons-CjjU4aPH.js","./assets/xlsx-C13V5yy0.js","./assets/references-import-_TvTouGp.js","./assets/master-import-BLNVKHyU.js","./assets/meals-import-Bk_RdS6o.js","./assets/xlsx-export-NqPJcZnw.js","./assets/xlsx-native-BvCzrz77.js","./assets/ingredients-import-BvoZQty_.js","./assets/sync-codec-worker-BfG7oGBE.js"];
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
    event.respondWith(fetch(event.request,{cache:'no-store'}).then(async response=>{
      if(!response.ok)throw Error('Website update returned '+response.status);
      const cache=await caches.open(CACHE);await cache.put(event.request,response.clone());return response;
    }).catch(async error=>{
      const cache=await caches.open(CACHE);
      const page=await cache.match(event.request)||(event.request.mode==='navigate'&&await cache.match(new URL('./index.html',self.registration.scope)));
      if(!page)throw error;
      const headers=new Headers(page.headers);headers.set('X-Fnt-Offline-Cache','1');
      return new Response(page.body,{status:page.status,statusText:page.statusText,headers});
    }));return;
  }
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request,{ignoreVary:true})).then(async hit=>hit||await caches.match(event.request,{ignoreVary:true})||fetch(event.request)));
});
