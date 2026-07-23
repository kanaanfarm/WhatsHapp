const CACHE="connectchat-v51";
const ASSETS=["/","/index.html","/style.css?v=44","/app.js?v=44","/manifest.json","/logo.svg"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener("fetch",e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=="GET"||url.pathname.startsWith("/api/")||url.pathname.startsWith("/socket.io/"))return;
  e.respondWith(fetch(e.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(e.request,copy));return response}).catch(()=>caches.match(e.request)));
});
