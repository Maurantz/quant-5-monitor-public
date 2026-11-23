'use strict';
const PREFIX=`quant-5-shell-${encodeURIComponent(new URL(self.registration.scope).pathname)}-`;
const CACHE=`${PREFIX}v28`;
const SHELL=['./','./index.html','./styles.css?v=28','./apex.js?v=28','./app.js?v=28','./manifest.json','./vendor/chart.umd.js','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png'];
const SHELL_PATHS=new Set(SHELL.map(path=>new URL(path,self.registration.scope).pathname));
const VERSIONED_PATHS=new Set(['./app.js','./apex.js','./styles.css'].map(path=>new URL(path,self.registration.scope).pathname));
const DATA_PATHS=new Set(['./data/dashboard.json','./data/ensemble-archive.json'].map(path=>new URL(path,self.registration.scope).pathname));
self.addEventListener('install',event=>{
  const requests=SHELL.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'}));
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(requests)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url),scope=new URL(self.registration.scope);
  if(request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  if(DATA_PATHS.has(url.pathname)){
    // The page retains its validated last snapshot and explicitly marks failed
    // synchronisation. A cached HTTP200 must never disguise a failed bot run.
    event.respondWith(fetch(request,{cache:'no-store'}));
    return;
  }
  if(!SHELL_PATHS.has(url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // Keep this release together until the next worker installs its complete shell.
    const matchOptions=VERSIONED_PATHS.has(url.pathname)?{}:{ignoreSearch:true};
    const cached=await cache.match(request,matchOptions);
    if(cached)return cached;
    try{return await fetch(request,{cache:'no-cache'});}catch{return Response.error();}
  })());
});
