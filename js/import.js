/* =========================================================
   GUDANG — Import page logic
   Parsing via SheetJS (js/vendor/xlsx.full.min.js — self-hosted,
   NOT a CDN import, so it still works fully offline on the PDA).
   ========================================================= */
let pendingRows = []; // hasil merge yang siap disimpan

const COLUMN_ALIASES = {
  part_number: ['part number', 'part_number', 'sku', 'kode', 'material', 'no material'],
  nama_barang: ['nama barang', 'nama_barang', 'material description', 'deskripsi', 'nama'],
  kategori: ['kategori', 'category', 'group', 'material group'],
  stok_qty: ['stok qty', 'stok', 'stock', 'qty', 'quantity', 'jumlah'],
  tanggal_kedatangan: ['tanggal kedatangan', 'tanggal_kedatangan', 'arrival date', 'tgl datang', 'received date'],
};

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

function mapRowToSchema(row, headerMap) {
  const get = (field) => {
    const col = headerMap[field];
    return col !== undefined ? row[col] : undefined;
  };
  const partNumber = get('part_number');
  const nama = get('nama_barang');
  if (!partNumber || !nama) return null;

  let stok = get('stok_qty');
  stok = typeof stok === 'number' ? stok : parseInt(String(stok || '0').replace(/[^\d-]/g, ''), 10) || 0;

  let tanggal = get('tanggal_kedatangan');
  if (tanggal instanceof Date) {
    tanggal = tanggal.toISOString().slice(0, 10);
  } else if (typeof tanggal === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(tanggal);
    if (d) tanggal = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  } else if (tanggal) {
    tanggal = String(tanggal);
  }

  return {
    sku: String(partNumber).trim(),
    part_number: String(partNumber).trim(),
    nama_barang: String(nama).trim(),
    kategori: get('kategori') ? String(get('kategori')).trim() : '',
    stok_qty: stok,
    tanggal_kedatangan: tanggal || '',
  };
}

function buildHeaderMap(headers) {
  const normalized = headers.map(normalizeHeader);
  const map = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx >= 0) map[field] = headers[idx];
  }
  return map;
}

async function initImportPage() {
  renderBottomNav('import');
  document.getElementById('dropIconSlot').innerHTML = Icons.upload;
  await renderLastImportMeta();

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  document.getElementById('cancelImportBtn').addEventListener('click', resetPreview);
  document.getElementById('confirmImportBtn').addEventListener('click', confirmImport);
}

async function renderLastImportMeta() {
  const lastImport = await GudangDB.getMeta('last_import_at');
  const el = document.getElementById('lastImportMeta');
  if (!lastImport) {
    el.innerHTML = `<span class="dot dot--stale"></span><span>Belum pernah import</span>`;
    return;
  }
  el.innerHTML = `<span class="dot"></span><span>Import terakhir: ${relativeTime(lastImport)} (${formatDate(lastImport)})</span>`;
}

async function handleFile(file) {
  try {
    if (typeof XLSX === 'undefined') {
      showToast('Library Excel (SheetJS) belum tersedia di js/vendor/', 'error');
      return;
    }
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      showToast('File kosong atau format tidak terbaca', 'error');
      return;
    }

    const headers = Object.keys(rows[0]);
    const headerMap = buildHeaderMap(headers);

    if (!headerMap.part_number || !headerMap.nama_barang) {
      showToast('Kolom Part Number / Nama Barang tidak ditemukan di file', 'error');
      return;
    }

    const mapped = rows.map((r) => mapRowToSchema(r, headerMap)).filter(Boolean);
    await buildPreview(mapped);
  } catch (err) {
    console.error(err);
    showToast('Gagal membaca file: ' + err.message, 'error');
  }
}

async function buildPreview(mappedRows) {
  const existingAll = await GudangDB.getAllBarang();
  const existingBySku = Object.fromEntries(existingAll.map((b) => [b.sku, b]));

  pendingRows = mappedRows.map((row) => GudangDB.mergeFromImport(existingBySku[row.sku], row));

  const newCount = pendingRows.filter((r) => r.is_new).length;
  const updatedCount = pendingRows.length - newCount;

  document.getElementById('statNew').textContent = newCount;
  document.getElementById('statUpdated').textContent = updatedCount;
  document.getElementById('statTotal').textContent = pendingRows.length;
  document.getElementById('previewArea').style.display = 'block';
  document.getElementById('previewArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function confirmImport() {
  if (pendingRows.length === 0) return;
  const btn = document.getElementById('confirmImportBtn');
  btn.disabled = true;
  btn.textContent = 'Menyimpan…';

  const cleaned = pendingRows.map(({ is_new, ...rest }) => rest);
  await GudangDB.putManyBarang(cleaned);
  await GudangDB.setMeta('last_import_at', new Date().toISOString());

  showToast(`${cleaned.length} barang berhasil disinkronkan`, 'success');
  resetPreview();
  await renderLastImportMeta();
  document.getElementById('fileInput').value = '';
  btn.disabled = false;
  btn.textContent = 'Konfirmasi Import';
}

function resetPreview() {
  pendingRows = [];
  document.getElementById('previewArea').style.display = 'none';
}

initImportPage();
