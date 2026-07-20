/* =========================================================
   GUDANG — Scan Import (QR chunk transfer)
   Menangkap QR yang dihasilkan qr-generator.html (dibuka di PC
   yang port USB/Bluetooth-nya dikunci), format per QR:
     GDG1|<batchId>|<index>|<total>|<payload CSV>
   Begitu semua chunk 0..total-1 terkumpul, digabung jadi CSV utuh,
   diparse via SheetJS, lalu masuk ke pipeline import yang SAMA
   dengan mode file (buildHeaderMap/mapRowToLocationRow/groupRowsBySku
   dari import.js — file itu harus dimuat SEBELUM file ini).
   ========================================================= */
let qrScanner = null;
let scanBatchId = null;
let scanTotal = 0;
let scanReceived = new Map(); // index -> payload string

function initQrImportUI() {
  document.getElementById('modeFileBtn').addEventListener('click', () => setImportMode('file'));
  document.getElementById('modeScanBtn').addEventListener('click', () => setImportMode('scan'));
  document.getElementById('startScanBtn').addEventListener('click', startQrScan);
  document.getElementById('stopScanBtn').addEventListener('click', stopQrScan);
}

function setImportMode(mode) {
  const isFile = mode === 'file';
  document.getElementById('modeFileBtn').classList.toggle('active', isFile);
  document.getElementById('modeScanBtn').classList.toggle('active', !isFile);
  document.getElementById('fileImportSection').style.display = isFile ? 'block' : 'none';
  document.getElementById('scanImportSection').style.display = isFile ? 'none' : 'block';
  if (isFile) stopQrScan();
}

function resetScanState() {
  scanBatchId = null;
  scanTotal = 0;
  scanReceived = new Map();
  document.getElementById('scanProgressCard').style.display = 'none';
}

async function startQrScan() {
  if (typeof Html5Qrcode === 'undefined') {
    showToast('Library kamera (html5-qrcode) belum tersedia di js/vendor/', 'error');
    return;
  }
  resetScanState();
  document.getElementById('startScanBtn').style.display = 'none';
  document.getElementById('stopScanBtn').style.display = 'block';

  qrScanner = new Html5Qrcode('qrReader');
  try {
    await qrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 240 },
      onQrDecoded,
      () => {} // abaikan error per-frame (wajar saat kamera belum fokus ke QR)
    );
  } catch (err) {
    showToast('Gagal buka kamera: ' + err.message, 'error');
    document.getElementById('startScanBtn').style.display = 'block';
    document.getElementById('stopScanBtn').style.display = 'none';
  }
}

async function stopQrScan() {
  if (qrScanner) {
    try {
      await qrScanner.stop();
      qrScanner.clear();
    } catch (e) { /* kamera mungkin sudah berhenti, aman diabaikan */ }
    qrScanner = null;
  }
  document.getElementById('startScanBtn').style.display = 'block';
  document.getElementById('stopScanBtn').style.display = 'none';
}

function onQrDecoded(decodedText) {
  const parts = decodedText.split('|');
  if (parts.length < 5 || parts[0] !== 'GDG1') {
    return; // bukan QR dari qr-generator.html, abaikan diam-diam
  }
  const [, batchId, idxStr, totalStr, ...rest] = parts;
  const payload = rest.join('|');
  const index = parseInt(idxStr, 10);
  const total = parseInt(totalStr, 10);

  // Batch baru terdeteksi (misal mulai import dari file Excel yang beda) -> reset otomatis
  if (scanBatchId !== batchId) {
    scanBatchId = batchId;
    scanTotal = total;
    scanReceived = new Map();
    document.getElementById('scanProgressCard').style.display = 'block';
  }

  if (!scanReceived.has(index)) {
    scanReceived.set(index, payload);
    showToast(`Chunk ${index + 1}/${total} diterima`, 'default');
  }

  renderScanProgress();

  if (scanReceived.size === scanTotal) {
    finishScanImport();
  }
}

function renderScanProgress() {
  document.getElementById('scanProgressLabel').textContent = `${scanReceived.size} / ${scanTotal}`;
  const missing = [];
  for (let i = 0; i < scanTotal; i++) {
    if (!scanReceived.has(i)) missing.push(i + 1);
  }
  document.getElementById('scanMissingLabel').textContent =
    missing.length === 0 ? 'Semua chunk lengkap ✓' : `Belum diterima, lompat ke #: ${missing.join(', ')}`;
}

async function finishScanImport() {
  await stopQrScan();
  showToast('Semua chunk lengkap, memproses data…', 'success');

  const orderedChunks = [];
  for (let i = 0; i < scanTotal; i++) orderedChunks.push(scanReceived.get(i));
  const csvText = orderedChunks.join('\n');

  try {
    const workbook = XLSX.read(csvText, { type: 'string' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const parsed = parseSheetRows(sheet);
    if (!parsed) {
      showToast('Kolom Part Number / Name Part tidak ditemukan di data hasil scan', 'error');
      return;
    }
    const locationRows = parsed.dataRows.map((r) => mapRowToLocationRow(r, parsed.headerMap)).filter(Boolean);
    const grouped = groupRowsBySku(locationRows);
    await buildPreview(grouped);
    resetScanState();
  } catch (err) {
    console.error(err);
    showToast('Gagal memproses data hasil scan: ' + err.message, 'error');
  }
}

initQrImportUI();
