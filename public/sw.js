const CACHE="amalchat-v6866";
const ASSETS=["/","/index.html","/style.css?v=6866","/style-6864.css?v=6866","/face-filters.js?v=6866","/app.js?v=6866","/manifest.json","/logo.svg"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener("fetch",e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=="GET"||url.pathname.startsWith("/api/")||url.pathname.startsWith("/socket.io/"))return;
  e.respondWith(fetch(e.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(e.request,copy));return response}).catch(()=>caches.match(e.request)));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=event.notification.data?.url||"/?v=6866";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(windows=>{
    const existing=windows[0];
    if(existing){existing.navigate(target);return existing.focus()}
    return clients.openWindow(target);
  }));
});

self.addEventListener("push",event=>{
  let data={};try{data=event.data?event.data.json():{}}catch{data={body:event.data?.text()||"New AmalChat notification"}}
  const title=data.title||"AmalChat";
  const isCall=data.type==="call";const options={body:data.body||"New notification",icon:"/logo.svg",badge:"/logo.svg",tag:data.tag||"amalchat",renotify:true,requireInteraction:isCall,vibrate:isCall?[300,120,300,120,500]:[120],data:{url:data.url||"/?v=6866"}};
  event.waitUntil(self.registration.showNotification(title,options));
});
