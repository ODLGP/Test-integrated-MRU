const CACHE_NAME = 'mop-mjerenje-v59';
const urlsToCache = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './ble.js',
  './qrscan.js',
  // Slike uređaja
  './slike/uredjaji/GA5000.jpg',
  './slike/uredjaji/Optima-Biogas.png',
  // Slike odlagališta
  './slike/odlagalista/Krizevci.jpg',
  './slike/odlagalista/Koprivnica.jpg',
  './slike/odlagalista/Virovitica.jpg',
  './slike/odlagalista/Grubisno-Polje.jpg',
  './slike/odlagalista/Belisce.jpg',
  './slike/odlagalista/Beli-Manastir.jpg',
  './slike/odlagalista/Pag.jpg',
  './slike/odlagalista/Otocac.jpg',
  './slike/odlagalista/Zadar.jpg',
  './slike/odlagalista/Karepovac.jpg',
  './slike/odlagalista/Knin.jpg',
  './slike/odlagalista/Obrovac.jpg',
  './slike/odlagalista/Labin.jpg',
  './slike/odlagalista/Zapresic.jpg',
  './slike/odlagalista/Griza.jpg',
  './slike/odlagalista/Cres.jpg',
  './slike/odlagalista/Bedekovcina.jpg',
  './slike/odlagalista/Rovinj.jpg',
  './slike/odlagalista/Pazin.jpg',
  './slike/odlagalista/Biljane-Donje.jpg',
  'https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js'
];

self.addEventListener('install', event => {
  // Odmah preuzmi kontrolu bez čekanja
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  // Odmah preuzmi kontrolu nad svim tabovima
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(cacheNames =>
        Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => caches.delete(name))
        )
      )
    ])
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Za HTML fajlove - uvijek dohvati s mreže, cache kao fallback
  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Za ostale resurse - cache first, mreža kao fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
