import { defineConfig } from 'vite';
export default defineConfig({
  base: './', server: { host: '127.0.0.1' },
  plugins:[{
    name:'fnt-offline-shell',
    generateBundle(_options,bundle){
      const files=['./','./index.html','./icon.svg','./manifest.webmanifest',...Object.keys(bundle).map(k=>'./'+k)];
      const version=Object.keys(bundle).sort().join('|');
      this.emitFile({type:'asset',fileName:'sw.js',source:`
const CACHE='fnt-shell-'+${JSON.stringify(version)};
const FILES=${JSON.stringify(files)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fnt-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request,{ignoreVary:true})).then(hit=>hit||fetch(event.request).catch(error=>{
    if(event.request.mode==='navigate')return caches.match(new URL('./index.html',self.registration.scope)).then(page=>page||Promise.reject(error));
    throw error;
  })));
});
`});
    },
  }],
});
