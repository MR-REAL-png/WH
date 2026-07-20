# Handoff — Warehouse App “Gudang”

Dokumen ini buat dikasih ke Claude di percakapan/akun lain supaya bisa langsung lanjut kerjain project ini tanpa mengulang dari nol. Upload file ini + semua file project (`gudang-app/`) di awal chat baru, terus bilang: **“Lanjutkan project ini, baca HANDOFF.md dulu.”**

-----

## Konteks singkat

Aplikasi web offline-first untuk mencari lokasi fisik barang di gudang 1 ruangan. Dipakai di **PDA Zebra TC52** yang WiFi-nya cuma bisa akses jaringan internal kantor (bisa buka SAP GUI dkk), **tapi tidak ada akses internet sama sekali**. Data stok berasal dari SAP, diexport manual ke Excel oleh user, lalu diimport ke app ini. User (Ril) kerja dari iPhone, tidak punya akses komputer/Android Studio, dan mengelola kode lewat GitHub Mobile + GitHub Pages (hosting statis gratis).

## Keputusan arsitektur penting (jangan diubah tanpa alasan kuat)

1. **100% offline saat dipakai** — tidak ada server, tidak ada Supabase/API call saat runtime. Semua data di **IndexedDB** lokal per-device.
1. **Update data via import Excel manual** — bukan sinkronisasi otomatis, karena PDA tidak pernah online. User export dari SAP → pindahkan file ke PDA (USB/kabel, atau via QR transfer kalau port dikunci — lihat bagian QR Transfer di bawah) → import lewat halaman Import.
1. **`lokasi_rak`** (kode rak fisik, misal `R1-A2`) itu **secara default dikelola manual** oleh user di halaman Rak. Kolom `lokasi rak` di Excel **memang dikenali** oleh parser import (`COLUMN_ALIASES.lokasi_rak` di `js/import.js`) dan **akan menimpa** `lokasi_rak` existing kalau kolom itu terisi di baris — ini **disengaja** (fallback kalau suatu saat user mau bulk-set lokasi rak lewat Excel), bukan bug. Excel asli SAP saat ini tidak punya kolom ini sama sekali, jadi dalam praktiknya `lokasi_rak` tidak pernah tersentuh oleh import rutin. **Kalau nanti ternyata SAP export punya kolom yang kebetulan match salah satu alias (`rak`, `lokasi`, `kode rak`, dst) dan itu TIDAK diinginkan, kabari Claude untuk hapus `lokasi_rak` dari `COLUMN_ALIASES`.**
1. **Storage location SAP** (field `stok` di tiap barang) itu BUKAN lokasi gudang berbeda, tapi tahap barang:

- `1101` = Supplier Lokal
- `1102` = Unpack (sudah dibongkar dari highrack, masih di gudang)
- `1401` = Highrack (awalnya disebut “CKD/Import”, di-rename atas permintaan user)
- `2101` (Line Produksi) — **SUDAH DIHAPUS** dari sistem, tidak diimport/ditampilkan sama sekali (barang dianggap sudah keluar gudang)

1. Satu part number bisa muncul di **beberapa baris Excel** (beda storage location per baris) — saat import, baris-baris itu di-**group per part number** jadi 1 record dengan breakdown qty per lokasi (field `stok: {1101, 1102, 1401}`).
1. Struktur Excel asli SAP: kolom **Part Number, Name Part, Satuan, Storage Loacation** (typo asli SAP, dua-duanya dikenali), **Qty**. Tidak ada kolom Kategori atau Tanggal Kedatangan di file asli.

## Kode QR zona gudang (PENTING — koreksi dari draft handoff sebelumnya)

Draft HANDOFF versi lama sempat menyebut format teks `ZONA:LOKAL` / `ZONA:UNPACK` / `ZONA:HIGHRACK`. **Itu salah / sudah tidak berlaku.** Implementasi aktual di `matchZoneCode()` (`js/db.js`) mencocokkan **kode storage location SAP polos**: `1101`, `1102`, `1401` — sama persis dengan kode yang dipakai di field `stok`. Jadi QR/papan zona fisik di gudang harus digenerate dengan isi teks salah satu dari tiga angka itu saja, bukan format `ZONA:...`. Tidak ada konstanta `ZONE_CODES` terpisah di kode — `STORAGE_LOCATION_ORDER` di `db.js` dipakai untuk itu juga.

## Instalasi ke PDA

- Dibuat sebagai **PWA** (manifest.json + service-worker.js untuk offline caching), lalu di-wrap jadi APK via **PWABuilder.com** (bukan Capacitor, karena user tidak punya akses Android Studio/komputer).
- Setting PWABuilder yang WAJIB: **Signing key → New** (bukan None, supaya bisa di-install), **Fallback behavior → WebView** (bukan Custom Tabs, supaya tidak muncul address bar — meski di percobaan ini kadang masih muncul, belum 100% konsisten).
- Hosting: **GitHub Pages** (`https://mr-real-png.github.io/...`), diakses dari Safari lalu di-generate APK-nya dari situ.
- Setiap kali ada update kode: **APK TIDAK PERLU di-generate ulang** (karena mode WebView cuma “cangkang” yang load URL). Cukup: upload file baru ke GitHub → naikkan versi `CACHE_NAME` di `service-worker.js` → buka app 1x pakai internet (WiFi biasa, bukan WiFi PDA) supaya service worker fetch ulang semua file → baru dipakai offline lagi. **Versi cache terakhir: `gudang-cache-v11` — cek isi `service-worker.js`, naikkan +1 setiap kali kirim update.**

## Device quirks yang sudah ditemukan (penting!)

- Scanner fisik Zebra (via **DataWedge**) mengirim hasil scan sebagai **IME text commit** ke field yang sedang fokus — BUKAN event `keydown` per karakter biasa. Ini kenapa listener global harus pakai trik **hidden focus-stealing input**, bukan buffer keydown biasa (lihat `initGlobalScanCapture` di `js/app.js`).
- Keyboard virtual **tidak muncul sama sekali** di PDA ini kalau field kosong & belum ada teks — device mendeteksi scanner sebagai “hardware keyboard” sehingga Android menyembunyikan keyboard virtual secara default. Ini device behavior, bukan bug — solusinya adalah mengandalkan scan, bukan ngetik manual.
- Barcode fisik di kemasan barang **berisi part number TAPI bercampur teks lain** (contoh hasil scan nyata: `00250924-SJ375V1000 09FEBRIYAN`). Makanya logic pencarian barcode barang pakai `raw.includes(part_number)` — cari part number mana yang jadi SUBSTRING dari hasil scan, bukan sebaliknya.

## Fitur “scan-first” workflow

Alur kerja yang diminta user: scan papan/QR **zona gudang dulu** (Lokal/Unpack/Highrack, kode `1101`/`1102`/`1401` — lihat bagian di atas) untuk filter list, baru scan **barang fisik** untuk cari detailnya. Field pencarian & field kode rak sekarang punya kecerdasan universal:

- Kode zona (`1101`, `1102`, atau `1401` persis) → filter list otomatis via `matchZoneCode()` di `js/db.js`.
- Barcode barang (part number sebagai substring) → langsung buka detail kalau 1 match, tampilkan list kalau beberapa match.
- Field otomatis clear/select-all setelah tiap scan supaya tidak menumpuk.
- `initGlobalScanCapture()` di `js/app.js` aktif di halaman Beranda & Rak — scan bisa langsung dilakukan tanpa tap field dulu.

## Fitur QR Transfer Import (untuk PC yang port USB/Bluetooth dikunci)

Sudah **selesai di-wiring** ke `import.html` (sebelumnya file `qr-import.js` sudah ada tapi belum terhubung ke UI — sudah diperbaiki):

- `import.html` sekarang punya toggle mode **“Pilih File”** vs **“Scan QR (dari PC)”** di bagian atas.
- Mode file: alur lama, upload Excel langsung dari PDA.
- Mode scan: user buka `qr-generator.html` di PC (halaman terpisah, pakai CDN karena PC ada internet — tidak perlu offline), upload Excel di sana, lalu PDA scan QR yang muncul satu per satu lewat kamera (`js/vendor/html5-qrcode.min.js`, di-download manual dari `https://github.com/mebjas/html5-qrcode` — **belum ada di repo, WAJIB ditambahkan user sebelum mode scan bisa dipakai**, sama seperti `xlsx.full.min.js`).
- Format payload QR: `GDG1|<batchId>|<index>|<total>|<payload CSV>`. Begitu semua chunk terkumpul, digabung jadi CSV lalu masuk pipeline import yang sama dengan mode file (`parseSheetRows` → `mapRowToLocationRow` → `groupRowsBySku` → `buildPreview`, semua dari `import.js`).
- `service-worker.js` sudah dinaikkan ke `gudang-cache-v11` untuk memastikan `import.html` versi baru ke-cache ulang.

## File & struktur

```
gudang-app/
├── index.html       (Beranda/Search — halaman utama)
├── import.html       (Import Excel — mode file & mode scan QR)
├── rak.html          (Kelola lokasi rak)
├── qr-generator.html  (dibuka di PC, generate QR chunk dari Excel — pakai CDN, bukan bagian PWA offline)
├── manifest.json      (PWA metadata)
├── service-worker.js  (offline caching — CACHE_NAME: gudang-cache-v11, naikkan tiap update)
├── css/style.css      (design tokens: warna biru/hijau terang, motif corner-bracket)
├── js/
│   ├── app.js        (nav, toast, icons, fuzzy search util, initGlobalScanCapture)
│   ├── db.js         (IndexedDB, skema barang, STORAGE_LOCATIONS, matchZoneCode)
│   ├── search.js      (logic Beranda, handleScanSubmit)
│   ├── import.js      (parsing Excel via SheetJS, grouping per part number)
│   ├── qr-import.js    (mode scan QR di import.html, terima chunk dari qr-generator.html)
│   ├── rak.js         (logic halaman Rak, assign lokasi)
│   └── vendor/
│       ├── xlsx.full.min.js       (SheetJS, WAJIB self-hosted, download manual dari cdn.sheetjs.com)
│       └── html5-qrcode.min.js     (WAJIB self-hosted kalau mau pakai mode scan QR & kamera fallback di Rak — download manual dari github.com/mebjas/html5-qrcode, BELUM ADA di repo)
└── assets/icon-*.png   (ikon app, motif kotak/crate biru)
```

## Yang belum kelar / next steps potensial

- `js/vendor/html5-qrcode.min.js` belum ada di repo — harus di-download manual oleh user dan diupload ke GitHub sebelum mode “Scan QR (dari PC)” di Import dan tombol kamera fallback di Rak bisa jalan. Tanpa file ini, mode file tetap normal, hanya mode scan yang akan menampilkan toast error.
- QR code untuk 3 papan zona (isi teks `1101`/`1102`/`1401`) belum digenerate — user diarahkan pakai situs QR generator gratis manual.
- Fallback behavior “WebView” di PWABuilder belum 100% konsisten menghilangkan address bar — mungkin perlu investigasi lebih lanjut atau terima sebagai limitasi kosmetik.
- Belum ada fitur stok opname / audit berkala.
- Belum ada export data lokasi rak (buat backup manual atau kalau nanti nambah PDA kedua).
- Field `tanggal_kedatangan` ada di skema tapi tidak pernah diisi dari import (kolom itu tidak ada di Excel asli SAP) — kalau dibutuhkan, perlu diisi manual atau dicek ulang ke user apakah SAP punya sumber data ini di kolom lain.

## Cara melanjutkan

1. Upload semua file `gudang-app/` (dari GitHub repo user, path `mr-real-png.github.io/WH/` atau sejenisnya) ke chat baru
1. Upload file ini (`HANDOFF.md`)
1. Lanjutkan sesuai permintaan user berikutnya — semua keputusan desain di atas adalah hasil diskusi panjang, jangan diubah kecuali user minta eksplisit