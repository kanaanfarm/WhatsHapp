const CACHE="connectchat-v6844";
const ASSETS=["/","/index.html","/style.css?v=6844","/style-6844.css?v=6844","/face-filters.js?v=6844","/app.js?v=6844","/manifest.json","/logo.svg"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener("fetch",e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=="GET"||url.pathname.startsWith("/api/")||url.pathname.startsWith("/socket.io/"))return;
  e.respondWith(fetch(e.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(e.request,copy));return response}).catch(()=>caches.match(e.request)));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=event.notification.data?.url||"/?v=6844";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(windows=>{
    const existing=windows[0];
    if(existing){existing.navigate(target);return existing.focus()}
    return clients.openWindow(target);
  }));
});

self.addEventListener("push",event=>{
  let data={};try{data=event.data?event.data.json():{}}catch{data={body:event.data?.text()||"New ConnectChat notification"}}
  const title=data.title||"ConnectChat";
  const isCall=data.type==="call";const options={body:data.body||"New notification",icon:"/logo.svg",badge:"/logo.svg",tag:data.tag||"connectchat",renotify:true,requireInteraction:isCall,vibrate:isCall?[300,120,300,120,500]:[120],data:{url:data.url||"/?v=6844"}};
  event.waitUntil(self.registration.showNotification(title,options));
});
