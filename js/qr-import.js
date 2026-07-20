/* =========================================================
   GUDANG — Scan Import (QR chunk transfer)
   Menangkap QR yang dihasilkan qr-generator.html (dibuka di PC
   yang port USB/Bluetooth-nya dikunci), format per QR:
     GDG1|<batchId>|<index>|<total>|<payload CSV>

   PENTING: ini pakai SCANNER FISIK PDA (via DataWedge), BUKAN kamera
   browser. TC52 punya imager yang bisa baca QR juga, hasilnya masuk
   sebagai keystroke ke field yang fokus — sama persis mekanismenya
   dengan scan part number/zona di Beranda & Rak (lihat
   initGlobalScanCapture di js/app.js). Jadi tinggal arahkan & pencet
   trigger di PDA, tidak perlu izin kamera / buka kamera sama sekali.

   Begitu semua chunk 0..total-1 terkumpul, digabung jadi CSV utuh,
   diparse via SheetJS, lalu masuk ke pipeline import yang SAMA
   dengan mode file (buildHeaderMap/mapRowToLocationRow/groupRowsBySku
   dari import.js — file itu harus dimuat SEBELUM file ini).

   CATATAN FIX (newline placeholder):
   qr-generator.html meng-escape newline literal (\n) di dalam tiap
   chunk jadi placeholder teks '~n~' sebelum di-encode ke QR. Ini
   karena \n asli yang ikut ke-embed di teks QR di-translate DataWedge
   jadi tombol Enter waktu discan ke <input>, yang bisa motong sisa
   teks di tengah proses dan bikin 1 chunk keputus jadi 2+ "hasil scan"
   terpisah (yang belakang gak punya prefix GDG1| -> ditolak sebagai
   "Bukan QR transfer Gudang"). Makanya di sini, SEBELUM di-parse
   SheetJS, placeholder '~n~' itu diubah balik jadi '\n' asli (lihat
   finishScanImport). Placeholder harus sama persis dengan yang dipakai
   di qr-generator.html (NEWLINE_PLACEHOLDER).
   ========================================================= */
const NEWLINE_PLACEHOLDER = '~n~';

let scanModeActive = false;
let scanBatchId = null;
let scanTotal = 0;
let scanReceived = new Map(); // index -> payload string

function initQrImportUI() {
  document.getElementById('modeFileBtn').addEventListener('click', () => setImportMode('file'));
  document.getElementById('modeScanBtn').addEventListener('click', () => setImportMode('scan'));

  // Aktif sejak halaman dibuka — scan bisa langsung dilakukan tanpa
  // perlu tap field dulu, sama seperti di Beranda/Rak. Chunk GDG1|...
  // cuma diproses kalau mode scan sedang aktif (lihat processScannedText),
  // supaya gak nyangkut kalau kebetulan ada scan lain waktu masih di mode file.
  initGlobalScanCapture(processScannedText);
}

function setImportMode(mode) {
  const isFile = mode === 'file';
  scanModeActive = !isFile;
  document.getElementById('modeFileBtn').classList.toggle('active', isFile);
  document.getElementById('modeScanBtn').classList.toggle('active', !isFile);
  document.getElementById('fileImportSection').style.display = isFile ? 'block' : 'none';
  document.getElementById('scanImportSection').style.display = isFile ? 'none' : 'block';
  if (isFile) resetScanState();
}

function resetScanState() {
  scanBatchId = null;
  scanTotal = 0;
  scanReceived = new Map();
  document.getElementById('scanProgressCard').style.display = 'none';
  document.getElementById('scanReadyLabel').textContent = 'Siap menerima scan — arahkan scanner PDA ke QR pertama di layar PC.';
}

/**
 * Dipanggil untuk SETIAP hasil scan di halaman ini (dari initGlobalScanCapture).
 * Kalau lagi tidak di mode scan, atau teksnya bukan format chunk GDG1,
 * diabaikan diam-diam — supaya tidak ganggu kalau user kebetulan lagi
 * scan barang/zona sementara masih buka halaman Import mode file.
 */
function processScannedText(raw) {
  if (!scanModeActive) return;

  const parts = raw.split('|');
  if (parts.length < 5 || parts[0] !== 'GDG1') {
    showToast('Bukan QR transfer Gudang, diabaikan', 'error');
    return;
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
  } else {
    showToast(`Chunk ${index + 1}/${total} sudah ada (scan ulang, diabaikan)`, 'default');
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
  showToast('Semua chunk lengkap, memproses data…', 'success');

  const orderedChunks = [];
  for (let i = 0; i < scanTotal; i++) orderedChunks.push(scanReceived.get(i));
  // Gabung chunk jadi CSV utuh, lalu kembalikan placeholder '~n~' jadi '\n'
  // asli — lihat catatan fix newline placeholder di header file ini.
  const csvText = orderedChunks.join('\n').split(NEWLINE_PLACEHOLDER).join('\n');

  try {
    const workbook = XLSX.read(csvText, { type: 'string' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const parsed = parseSheetRows(sheet);
    if (!parsed) {
      showToast('Kolom Part Number / Name Part tidak ditemukan di data hasil scan', 'error');
      return;
    }
    if (parsed.usedFallback) {
      showToast('Header tidak terdeteksi, asumsi urutan kolom standar', 'default');
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
