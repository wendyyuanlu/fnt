
const CACHE='fnt-shell-'+"assets/comparison-BadpaedL.js|assets/comparison-Cdyj2Fo7.css|assets/icons-DQmOIGVW.js|assets/ingredients-import-CCrNCjX4.js|assets/main-8LkjqXoa.js|assets/main-Bc3DfHYS.css|assets/main-CITv2EPT.css|assets/main-ZYnPieZn.js|assets/master-import-c0kQmdD8.js|assets/meals-import-D23NaBHz.js|assets/preload-helper-DO0sjJph.js|assets/references-import-BA7nqO3I.js|assets/sync-codec-worker-BfG7oGBE.js|assets/xlsx-DaFDlz-9.js|assets/xlsx-export-DChyi77j.js|assets/xlsx-native-CbA4LkWU.js|testing-workbook-version.json|game-character-v557-1795598713397";
const FILES=["./","./index.html","./icon.svg","./manifest.webmanifest","./testing-workbook.json","./testing-workbook-version.json","./assets/comparison-Cdyj2Fo7.css","./assets/main-CITv2EPT.css","./assets/main-Bc3DfHYS.css","./assets/comparison-BadpaedL.js","./assets/main-ZYnPieZn.js","./assets/preload-helper-DO0sjJph.js","./assets/main-8LkjqXoa.js","./assets/icons-DQmOIGVW.js","./assets/xlsx-DaFDlz-9.js","./assets/references-import-BA7nqO3I.js","./assets/master-import-c0kQmdD8.js","./assets/meals-import-D23NaBHz.js","./assets/xlsx-export-DChyi77j.js","./assets/xlsx-native-CbA4LkWU.js","./assets/ingredients-import-CCrNCjX4.js","./assets/sync-codec-worker-BfG7oGBE.js"];
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
