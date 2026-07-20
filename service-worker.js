/* =========================================================
   GUDANG — Service Worker
   Strategi: cache-first untuk semua asset app (HTML/CSS/JS/vendor),
   supaya app tetap jalan 100% walau device offline total setelah
   pertama kali dibuka & di-cache.
   ========================================================= */
const CACHE_NAME = 'gudang-cache-v15';

// App shell inti — WAJIB ke-cache saat install.
// xlsx.full.min.js SENGAJA dimasukkan ke sini juga (bukan cuma runtime-cached
// opportunistic) — kalau tidak, halaman Import bisa nyangkut nunggu fetch itu
// selesai saat offline kalau kebetulan belum pernah berhasil di-fetch sekali.
// html5-qrcode.min.js opsional — cuma dipakai sebagai fallback tombol kamera
// di halaman Rak (bukan untuk fitur scan-transfer Import, itu sekarang pakai
// scanner fisik PDA langsung, lihat js/qr-import.js). Aman kalau file ini
// belum ada di repo, precache-nya bakal skip tanpa bikin install gagal.
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
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          return new Response('Offline dan file belum ter-cache.', { status: 503 });
        });
    })
  );
});
