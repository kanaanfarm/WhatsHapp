const CACHE="connectchat-pro-v9";
const ASSETS=["/","/index.html","/style.css?v=18","/app.js?v=18","/manifest.json","/logo.svg"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener("fetch",e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=="GET"||url.pathname.startsWith("/api/")||url.pathname.startsWith("/socket.io/"))return;
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
