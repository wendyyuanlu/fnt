
const CACHE='fnt-shell-'+"assets/comparison-CCXS8lnb.js|assets/comparison-CWgl1OYE.css|assets/icons-CyGL3MqI.js|assets/ingredients-import-CC2IP8BH.js|assets/main-BSJP970N.js|assets/main-DIX6XYuH.js|assets/main-zYJmEht4.css|assets/master-import-Dec_rKSK.js|assets/meals-import-BC84hUEV.js|assets/preload-helper-DO0sjJph.js|assets/references-import-4CiesApH.js|assets/sync-codec-worker-DZQPU6Gz.js|assets/xlsx-3xUmqVHe.js|assets/xlsx-export-C3zow1yK.js|assets/xlsx-native-DxE69owf.js|testing-workbook-version.json|game-character-v557-1795598713397";
const FILES=["./","./index.html","./icon.svg","./manifest.webmanifest","./testing-workbook.json","./testing-workbook-version.json","./assets/comparison-CWgl1OYE.css","./assets/main-zYJmEht4.css","./assets/comparison-CCXS8lnb.js","./assets/main-DIX6XYuH.js","./assets/preload-helper-DO0sjJph.js","./assets/main-BSJP970N.js","./assets/icons-CyGL3MqI.js","./assets/xlsx-3xUmqVHe.js","./assets/references-import-4CiesApH.js","./assets/master-import-Dec_rKSK.js","./assets/meals-import-BC84hUEV.js","./assets/xlsx-export-C3zow1yK.js","./assets/xlsx-native-DxE69owf.js","./assets/ingredients-import-CC2IP8BH.js","./assets/sync-codec-worker-DZQPU6Gz.js"];
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
