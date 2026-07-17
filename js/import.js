/* =========================================================
   GUDANG — Import page logic
   Parsing via SheetJS (js/vendor/xlsx.full.min.js — self-hosted).
   Format asli SAP: part number, name part, satuan, storage location, qty
   -> satu part number bisa muncul di beberapa baris (beda storage location),
      jadi baris-baris itu di-GROUP dulu per part number sebelum di-merge.
   ========================================================= */
let pendingGroups = []; // hasil grouping+merge, siap disimpan

const COLUMN_ALIASES = {
  part_number: ['part number', 'part_number', 'sku', 'kode', 'material', 'no material'],
  nama_barang: ['name part', 'nama barang', 'nama_barang', 'material description', 'deskripsi', 'nama'],
  satuan: ['satuan', 'unit', 'uom'],
  storage_location: ['storage loacation', 'storage location', 'storage_location', 'lokasi', 'plant', 'gudang'],
  qty: ['qty', 'quantity', 'stok', 'stock', 'jumlah', 'stok qty'],
};

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
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

function mapRowToLocationRow(row, headerMap) {
  const get = (field) => {
    const col = headerMap[field];
    return col !== undefined ? row[col] : undefined;
  };
  const partNumber = get('part_number');
  const nama = get('nama_barang');
  if (!partNumber || !nama) return null;

  let qty = get('qty');
  qty = typeof qty === 'number' ? qty : parseInt(String(qty || '0').replace(/[^\d-]/g, ''), 10) || 0;

  const storageLocRaw = get('storage_location');
  const storageLoc = storageLocRaw !== undefined ? String(storageLocRaw).trim() : '';

  return {
    sku: String(partNumber).trim(),
    part_number: String(partNumber).trim(),
    nama_barang: String(nama).trim(),
    satuan: get('satuan') ? String(get('satuan')).trim() : '',
    storage_location: storageLoc,
    qty,
  };
}

/** Kumpulkan semua baris (per storage location) jadi satu grup per part number */
function groupRowsBySku(locationRows) {
  const groups = {};
  for (const row of locationRows) {
    if (!groups[row.sku]) {
      groups[row.sku] = {
        sku: row.sku,
        part_number: row.part_number,
        nama_barang: row.nama_barang,
        satuan: row.satuan,
        stok: {},
        tanggal_kedatangan: '',
      };
    }
    const g = groups[row.sku];
    // Kalau ada baris duplikat utk sku+lokasi yang sama, dijumlahkan (jaga-jaga)
    if (GudangDB.STORAGE_LOCATION_ORDER.includes(row.storage_location)) {
      g.stok[row.storage_location] = (g.stok[row.storage_location] || 0) + row.qty;
    }
    if (!g.nama_barang) g.nama_barang = row.nama_barang;
    if (!g.satuan) g.satuan = row.satuan;
  }
  return Object.values(groups);
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
      showToast('Kolom Part Number / Name Part tidak ditemukan di file', 'error');
      return;
    }

    const locationRows = rows.map((r) => mapRowToLocationRow(r, headerMap)).filter(Boolean);
    const grouped = groupRowsBySku(locationRows);
    await buildPreview(grouped);
  } catch (err) {
    console.error(err);
    showToast('Gagal membaca file: ' + err.message, 'error');
  }
}

async function buildPreview(groupedRows) {
  const existingAll = await GudangDB.getAllBarang();
  const existingBySku = Object.fromEntries(existingAll.map((b) => [b.sku, b]));

  pendingGroups = groupedRows.map((g) => GudangDB.mergeFromImport(existingBySku[g.sku], g));

  const newCount = pendingGroups.filter((r) => r.is_new).length;
  const updatedCount = pendingGroups.length - newCount;

  document.getElementById('statNew').textContent = newCount;
  document.getElementById('statUpdated').textContent = updatedCount;
  document.getElementById('statTotal').textContent = pendingGroups.length;
  document.getElementById('previewArea').style.display = 'block';
  document.getElementById('previewArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function confirmImport() {
  if (pendingGroups.length === 0) return;
  const btn = document.getElementById('confirmImportBtn');
  btn.disabled = true;
  btn.textContent = 'Menyimpan…';

  const cleaned = pendingGroups.map(({ is_new, ...rest }) => rest);
  await GudangDB.putManyBarang(cleaned);
  await GudangDB.setMeta('last_import_at', new Date().toISOString());

  showToast(`${cleaned.length} part number berhasil disinkronkan`, 'success');
  resetPreview();
  await renderLastImportMeta();
  document.getElementById('fileInput').value = '';
  btn.disabled = false;
  btn.textContent = 'Konfirmasi Import';
}

function resetPreview() {
  pendingGroups = [];
  document.getElementById('previewArea').style.display = 'none';
}

initImportPage();
