/* =========================================================
   GUDANG — Service Worker
   Strategi: cache-first untuk semua asset app (HTML/CSS/JS/vendor),
   supaya app tetap jalan 100% walau device offline total setelah
   pertama kali dibuka & di-cache.
   ========================================================= */
const CACHE_NAME = 'gudang-cache-v12';

// App shell inti — WAJIB ke-cache saat install.
// Vendor script (xlsx, html5-qrcode) SENGAJA dimasukkan ke sini juga —
// sebelumnya cuma runtime-cached (baru ke-cache SETELAH pernah berhasil
// di-fetch sekali), jadi kalau install pertama kebetulan gak sempat fetch
// itu, halaman yang butuh vendor script itu (mis. Import) bisa nyangkut
// nunggu fetch offline gak akan pernah selesai. Dengan masuk CORE_ASSETS,
// dia ikut di-precache paksa saat install (asal file-nya memang ada di repo).
const CORE_ASSETS = [
  './',
  './index.html',
  './import.html',
  './rak.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/search.js',
  './js/import.js',
  './js/qr-import.js',
  './js/rak.js',
  './js/vendor/xlsx.full.min.js',
  './js/vendor/html5-qrcode.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll akan gagal total kalau 1 saja 404 — pakai individual add
      // supaya file vendor yang mungkin belum ada tidak menggagalkan install.
      Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          // Runtime cache: simpan juga file yang belum ada di precache
          // (misal js/vendor/xlsx.full.min.js, js/vendor/html5-qrcode.min.js)
          // begitu berhasil diambil sekali.
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline & tidak ada di cache — tidak banyak yang bisa dilakukan
          // selain membiarkan request gagal secara natural.
          return new Response('Offline dan file belum ter-cache.', { status: 503 });
        });
    })
  );
});
