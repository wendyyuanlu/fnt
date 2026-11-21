
const CACHE='fnt-shell-'+"assets/index-Bs1CdZnf.js|assets/index-D9yDSBwP.css|assets/ingredients-import-D3ROG26N.js|assets/references-import-DDCGtWkH.js|assets/xlsx-DGygHjzX.js|assets/xlsx-export-MCVQtsBg.js|assets/xlsx-native-Df2e3Pjn.js";
const FILES=["./","./index.html","./icon.svg","./manifest.webmanifest","./assets/index-D9yDSBwP.css","./assets/index-Bs1CdZnf.js","./assets/xlsx-DGygHjzX.js","./assets/references-import-DDCGtWkH.js","./assets/xlsx-export-MCVQtsBg.js","./assets/xlsx-native-Df2e3Pjn.js","./assets/ingredients-import-D3ROG26N.js"];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fnt-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request,{ignoreVary:true})).then(hit=>hit||fetch(event.request).catch(error=>{
    if(event.request.mode==='navigate')return caches.match(new URL('./index.html',self.registration.scope)).then(page=>page||Promise.reject(error));
    throw error;
  })));
});
