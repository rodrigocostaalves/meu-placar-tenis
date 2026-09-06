// Retire the web UI only. Never intercept API, authentication, APK or privacy requests.
const CACHE='deuce-score-web-paused-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/index.html','/icons/share-logo.png'])));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname==='/'||url.pathname==='/index.html')event.respondWith(fetch('/index.html',{cache:'no-store'}).then(response=>{
  if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put('/index.html',copy)));}return response;
 }).catch(()=>caches.match('/index.html',{cacheName:CACHE})));
 else if(url.pathname==='/icons/share-logo.png')event.respondWith(caches.match(event.request,{cacheName:CACHE}).then(cached=>cached||fetch(event.request)));
});
// Existing push subscriptions are not deleted by the UI pause.
self.addEventListener('push',event=>{let data={};try{data=event.data?event.data.json():{};}catch(e){data={body:event.data?event.data.text():''};}
event.waitUntil(self.registration.showNotification(data.title||'Deuce Score',{body:data.body||'',icon:'/icon-192.png',badge:'/icon-192.png'}));});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window'}).then(list=>{const client=list.find(c=>'focus' in c);return client?client.focus():self.clients.openWindow('/');}));});
