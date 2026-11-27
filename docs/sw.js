
const CACHE='fnt-shell-'+"assets/comparison-CWXHKNHg.js|assets/comparison-T1mvZhHw.css|assets/icons-DZK8uoOe.js|assets/ingredients-import-C1ypvwhp.js|assets/main-B1syqK5S.js|assets/main-Bc3DfHYS.css|assets/main-Bn3HvW6m.js|assets/main-JWVCrswM.css|assets/master-import-BYz_6qMk.js|assets/meals-import---dwWqJb.js|assets/preload-helper-DO0sjJph.js|assets/references-import-BdNV3t3A.js|assets/sync-codec-worker-DZQPU6Gz.js|assets/xlsx-Bnu3H3_G.js|assets/xlsx-export-DezLZK_3.js|assets/xlsx-native-m6ncC5BT.js|testing-workbook-version.json|game-character-v557-1795598713397";
const FILES=["./","./index.html","./icon.svg","./manifest.webmanifest","./testing-workbook.json","./testing-workbook-version.json","./assets/comparison-T1mvZhHw.css","./assets/main-JWVCrswM.css","./assets/main-Bc3DfHYS.css","./assets/comparison-CWXHKNHg.js","./assets/main-Bn3HvW6m.js","./assets/preload-helper-DO0sjJph.js","./assets/main-B1syqK5S.js","./assets/icons-DZK8uoOe.js","./assets/xlsx-Bnu3H3_G.js","./assets/references-import-BdNV3t3A.js","./assets/master-import-BYz_6qMk.js","./assets/meals-import---dwWqJb.js","./assets/xlsx-export-DezLZK_3.js","./assets/xlsx-native-m6ncC5BT.js","./assets/ingredients-import-C1ypvwhp.js","./assets/sync-codec-worker-DZQPU6Gz.js"];
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
