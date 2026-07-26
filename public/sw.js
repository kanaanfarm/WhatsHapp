const CACHE="connectchat-v6756";
const ASSETS=["/","/index.html","/style.css?v=6756","/app.js?v=6756","/manifest.json","/logo.svg"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener("fetch",e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=="GET"||url.pathname.startsWith("/api/")||url.pathname.startsWith("/socket.io/"))return;
  e.respondWith(fetch(e.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(e.request,copy));return response}).catch(()=>caches.match(e.request)));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=event.notification.data?.url||"/?v=6756";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(windows=>{
    const existing=windows[0];
    if(existing){existing.navigate(target);return existing.focus()}
    return clients.openWindow(target);
  }));
});
