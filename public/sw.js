const CACHE="connectchat-pro-v8";
const ASSETS=["/","/index.html","/style.css?v=17","/app.js?v=17","/manifest.json","/logo.svg"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
