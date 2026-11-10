'use strict';
const PREFIX=`quant-5-shell-${encodeURIComponent(new URL(self.registration.scope).pathname)}-`;
const CACHE=`${PREFIX}v19`;
const SHELL=['./','./index.html','./styles.css?v=19','./app.js?v=19','./manifest.json','./vendor/chart.umd.js','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png'];
const SHELL_PATHS=new Set(SHELL.map(path=>new URL(path,self.registration.scope).pathname));
const VERSIONED_PATHS=new Set(['./app.js','./styles.css'].map(path=>new URL(path,self.registration.scope).pathname));
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url),scope=new URL(self.registration.scope);
  if(request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  if(url.pathname===new URL('./data/dashboard.json',scope).pathname){
    // The page retains its validated last snapshot and explicitly marks failed
    // synchronisation. A cached HTTP200 must never disguise a failed bot run.
    event.respondWith(fetch(request,{cache:'no-store'}));
    return;
  }
  if(!SHELL_PATHS.has(url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // Never pair a new HTML shell with cached JavaScript/CSS from another
    // release. Navigation query strings do not change the installed shell.
    const matchOptions=VERSIONED_PATHS.has(url.pathname)?{}:{ignoreSearch:true};
    try{
      const response=await fetch(request,{cache:'no-cache'});
      if(response?.ok){
        try{await cache.put(request,response.clone());}catch{/* Read-only shell also works when storage is full. */}
        return response;
      }
      // A temporary hosting error must not discard an already installed shell.
      // Market snapshots use the separate network-only branch above.
      const cached=await cache.match(request,matchOptions);
      return cached||response;
    }catch{
      const cached=await cache.match(request,matchOptions);
      return cached||Response.error();
    }
  })());
});
