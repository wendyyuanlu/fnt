
const CACHE='fnt-shell-'+"assets/index-D3lscW84.css|assets/index-IyalMIMK.js|assets/ingredients-import-CNck_j3T.js|assets/references-import-DrJYcQfA.js|assets/xlsx-DJsx0Ig8.js|assets/xlsx-export-CryG2bij.js|assets/xlsx-native-CU88vb43.js";
const FILES=["./","./index.html","./icon.svg","./manifest.webmanifest","./assets/index-D3lscW84.css","./assets/index-IyalMIMK.js","./assets/xlsx-DJsx0Ig8.js","./assets/references-import-DrJYcQfA.js","./assets/xlsx-export-CryG2bij.js","./assets/xlsx-native-CU88vb43.js","./assets/ingredients-import-CNck_j3T.js"];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fnt-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request,{ignoreVary:true})).then(hit=>hit||fetch(event.request).catch(error=>{
    if(event.request.mode==='navigate')return caches.match(new URL('./index.html',self.registration.scope)).then(page=>page||Promise.reject(error));
    throw error;
  })));
});
