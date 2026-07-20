<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<title>Gudang — Import Data</title>
<link rel="stylesheet" href="css/style.css">
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#1B5FA8">
</head>
<body>

<header class="topbar">
  <span class="topbar__eyebrow">Gudang · Sinkronisasi</span>
  <h1 class="topbar__title">Import Data SAP</h1>
  <div class="topbar__meta" id="lastImportMeta">
    <span class="dot"></span>
    <span>Memuat…</span>
  </div>
</header>

<main class="container">

  <!-- Mode toggle: file langsung vs terima lewat QR (PC yang port-nya dikunci) -->
  <div class="filters" id="importModeToggle" style="margin-bottom:4px;">
    <button class="filter-pill active" id="modeFileBtn">Pilih File</button>
    <button class="filter-pill" id="modeScanBtn">Scan QR (dari PC)</button>
  </div>

  <!-- ===== Mode: pilih file langsung ===== -->
  <div id="fileImportSection">
    <div class="dropzone" id="dropzone" style="margin-top:14px;">
      <div id="dropIconSlot"></div>
      <h3>Pilih file Excel</h3>
      <p>.xlsx atau .csv hasil export dari SAP</p>
      <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" style="display:none;">
    </div>
  </div>

  <!-- ===== Mode: scan QR chunk dari qr-generator.html ===== -->
  <div id="scanImportSection" style="display:none; margin-top:14px;">
    <div class="card">
      <span class="section-label">Scan QR dari layar PC</span>
      <p class="text-muted" style="font-size:12.5px; line-height:1.6;">
        Buka <span class="mono">qr-generator.html</span> di PC (butuh internet untuk load library, terpisah dari app ini), upload Excel di sana, lalu arahkan kamera PDA ke tiap QR yang muncul satu-satu.
      </p>
      <div id="qrReader" style="margin-top:14px; border-radius:var(--radius-sm); overflow:hidden; background:#000; min-height:220px;"></div>
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button class="btn btn--primary btn--block" id="startScanBtn">Mulai Kamera</button>
        <button class="btn btn--secondary btn--block" id="stopScanBtn" style="display:none;">Stop Kamera</button>
      </div>
    </div>

    <div class="card" id="scanProgressCard" style="display:none; margin-top:12px;">
      <span class="section-label">Progress transfer</span>
      <div class="progress-label" id="scanProgressLabel" style="font-family:var(--font-display); font-size:20px; font-weight:700; text-align:center;">0 / 0</div>
      <p class="text-muted" id="scanMissingLabel" style="font-size:12.5px; text-align:center; margin-top:6px;"></p>
    </div>
  </div>

  <div class="card" style="margin-top:16px;">
    <span class="section-label">Format kolom yang dikenali</span>
    <p class="text-muted" style="font-size:13px; line-height:1.6;">
      Part Number · Name Part · Satuan · Storage Location · Qty
    </p>
    <p class="text-muted" style="font-size:12px; line-height:1.5; margin-top:8px;">
      Satu part number boleh muncul di beberapa baris (beda storage location) — otomatis digabung jadi 1 barang dengan breakdown qty per lokasi.
    </p>
  </div>

  <div id="previewArea" style="display:none; margin-top:16px;">
    <div class="card">
      <span class="section-label">Ringkasan perubahan</span>
      <div class="summary-grid">
        <div class="summary-stat"><b id="statNew">0</b><span>Baru</span></div>
        <div class="summary-stat"><b id="statUpdated">0</b><span>Diupdate</span></div>
        <div class="summary-stat"><b id="statTotal">0</b><span>Total baris</span></div>
      </div>
      <p class="text-muted" style="font-size:12.5px; margin-top:12px; line-height:1.5;">
        Lokasi rak yang sudah kamu assign <b>tidak akan berubah</b>. Qty per storage location (Lokal/Unpack/Highrack) diupdate sesuai file terbaru.
      </p>
    </div>

    <button class="btn btn--primary btn--block btn--lg" id="confirmImportBtn" style="margin-top:14px;">
      Konfirmasi Import
    </button>
    <button class="btn btn--ghost btn--block" id="cancelImportBtn" style="margin-top:8px;">Batal</button>
  </div>
</main>

<!-- SheetJS: harus di-hosting lokal karena app jalan offline di PDA (tidak ada CDN saat runtime). -->
<script src="js/vendor/xlsx.full.min.js"></script>
<!-- html5-qrcode: dipakai untuk mode "Scan QR (dari PC)". Self-hosted, download manual dari
     https://github.com/mebjas/html5-qrcode ke js/vendor/html5-qrcode.min.js — sama seperti xlsx,
     WAJIB self-hosted karena tidak ada CDN saat runtime di PDA. Kalau file belum ada, mode file
     tetap jalan normal; hanya mode scan yang akan menampilkan pesan error saat dibuka. -->
<script src="js/vendor/html5-qrcode.min.js"></script>
<script src="js/db.js"></script>
<script src="js/app.js"></script>
<script src="js/import.js"></script>
<script src="js/qr-import.js"></script>
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js'));
  }
</script>
</body>
</html>
