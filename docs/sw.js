
const CACHE='fnt-shell-'+"assets/index-B5IfC-lK.js|assets/index-CTCKUjhj.css|assets/ingredients-import-vgBxh8VR.js|assets/references-import-BzBQrZKS.js|assets/xlsx-BKPRRkRC.js|assets/xlsx-export-DkQw2Ht0.js|assets/xlsx-native-BD0s02mv.js";
const FILES=["./","./index.html","./icon.svg","./manifest.webmanifest","./assets/index-CTCKUjhj.css","./assets/index-B5IfC-lK.js","./assets/xlsx-BKPRRkRC.js","./assets/references-import-BzBQrZKS.js","./assets/xlsx-export-DkQw2Ht0.js","./assets/xlsx-native-BD0s02mv.js","./assets/ingredients-import-vgBxh8VR.js"];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fnt-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request,{ignoreVary:true})).then(hit=>hit||fetch(event.request).catch(error=>{
    if(event.request.mode==='navigate')return caches.match(new URL('./index.html',self.registration.scope)).then(page=>page||Promise.reject(error));
    throw error;
  })));
});
