/* =========================================================
   GUDANG — Beranda / Search page logic
   ========================================================= */
let allBarang = [];
let currentFilter = 'all';
let currentQuery = '';
let scanMatches = null; // hasil scan barcode barang yang cocok >1 (perlu dipilih manual)

async function initBeranda() {
  renderBottomNav('beranda');
  document.getElementById('searchIconSlot').innerHTML = Icons.search;
  document.getElementById('emptyIconSlot').innerHTML = Icons.empty;

  document.getElementById('searchInput').addEventListener('focus', (e) => e.target.select());
  document.getElementById('searchInput').addEventListener('input', (e) => {
    currentQuery = e.target.value;
    scanMatches = null;
    renderList();
  });

  document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleScanSubmit(e.target.value);
    }
  });

  document.querySelectorAll('.filter-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      scanMatches = null;
      renderList();
    });
  });

  document.getElementById('sheetBackdrop').addEventListener('click', closeDetail);

  initGlobalScanCapture(handleScanSubmit);

  await loadData();
}

/**
 * Dipanggil saat Enter ditekan di field pencarian — ini yang membedakan
 * "hasil scan" (scanner Zebra otomatis kirim Enter) dari ngetik manual.
 * 1. Kalau teksnya cocok kode zona (papan area) -> set filter ke zona itu.
 * 2. Kalau bukan, coba cocokkan sebagai barcode barang (part number ada
 *    di DALAM teks scan, bukan sebaliknya, karena barcode fisik biasanya
 *    "kotor" — ada teks lain selain part number).
 * 3. Kalau tidak ketemu cocok sama sekali, fallback ke pencarian teks biasa.
 */
function handleScanSubmit(rawValue) {
  const raw = rawValue.trim();
  if (!raw) return;

  const zoneCode = GudangDB.matchZoneCode(raw);
  if (zoneCode) {
    currentFilter = zoneCode;
    currentQuery = '';
    scanMatches = null;
    document.querySelectorAll('.filter-pill').forEach((b) => {
      b.classList.toggle('active', b.dataset.filter === zoneCode);
    });
    document.getElementById('searchInput').value = '';
    showToast(`Filter aktif: ${GudangDB.STORAGE_LOCATIONS[zoneCode].label}`, 'success');
    renderList();
    return;
  }

  // Cek dulu apakah teks ini persis salah satu kode rak yang sudah pernah diassign
  const rakUpper = raw.toUpperCase();
  const raksInUse = new Set(allBarang.filter((b) => b.lokasi_rak).map((b) => b.lokasi_rak.toUpperCase()));
  if (raksInUse.has(rakUpper)) {
    scanMatches = allBarang.filter((b) => b.lokasi_rak && b.lokasi_rak.toUpperCase() === rakUpper);
    currentQuery = '';
    document.querySelectorAll('.filter-pill').forEach((b) => b.classList.remove('active'));
    document.getElementById('searchInput').value = '';
    showToast(`Menampilkan barang di rak ${raw.toUpperCase()}`, 'success');
    renderList();
    return;
  }

  const matches = allBarang.filter((b) => b.part_number && raw.includes(b.part_number));
  if (matches.length === 1) {
    document.getElementById('searchInput').value = '';
    currentQuery = '';
    scanMatches = null;
    renderList();
    openDetail(matches[0].sku);
    return;
  }
  if (matches.length > 1) {
    scanMatches = matches;
    document.getElementById('searchInput').value = '';
    currentQuery = '';
    showToast(`${matches.length} kemungkinan cocok, pilih salah satu`, 'default');
    renderList();
    return;
  }

  // Tidak ketemu sebagai zona atau barcode barang — perlakukan sebagai teks cari biasa
  scanMatches = null;
  currentQuery = raw;
  renderList();
}

async function loadData() {
  allBarang = await GudangDB.getAllBarang();
  await renderSyncMeta();
  renderList();
}

async function renderSyncMeta() {
  const lastImport = await GudangDB.getMeta('last_import_at');
  const el = document.getElementById('syncMeta');
  if (!lastImport) {
    el.innerHTML = `<span class="dot dot--stale"></span><span>Belum pernah import data</span>`;
    return;
  }
  const diffDays = (Date.now() - new Date(lastImport).getTime()) / 86400000;
  const isStale = diffDays > 3;
  el.innerHTML = `<span class="dot ${isStale ? 'dot--stale' : ''}"></span><span>Sync terakhir: ${relativeTime(lastImport)}</span>`;
}

function getFilteredSorted() {
  if (scanMatches) return scanMatches;

  let list = allBarang;

  if (currentFilter === 'tanpa_lokasi') {
    list = list.filter((b) => !b.lokasi_rak);
  } else if (['1101', '1102', '1401', '2101'].includes(currentFilter)) {
    list = list.filter((b) => (b.stok?.[currentFilter] || 0) > 0);
  }

  if (currentQuery.trim()) {
    list = list
      .map((b) => {
        const scoreName = searchScore(currentQuery, b.nama_barang);
        const scorePart = searchScore(currentQuery, b.part_number);
        return { item: b, score: Math.max(scoreName, scorePart) };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  } else {
    list = [...list].sort((a, b) => (a.nama_barang || '').localeCompare(b.nama_barang || ''));
  }
  return list;
}

function renderStokChips(stok) {
  return GudangDB.STORAGE_LOCATION_ORDER.filter((code) => (stok?.[code] || 0) > 0)
    .map((code) => {
      const loc = GudangDB.STORAGE_LOCATIONS[code];
      return `<span class="stok-chip loc-${code}">${loc.short} <b>${stok[code].toLocaleString('id-ID')}</b></span>`;
    })
    .join('');
}

function renderList() {
  const list = getFilteredSorted();
  const container = document.getElementById('itemList');
  const empty = document.getElementById('emptyState');

  if (list.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    if (allBarang.length === 0) {
      document.getElementById('emptyTitle').textContent = 'Belum ada data barang';
      document.getElementById('emptyDesc').textContent = 'Import data dari Excel SAP dulu untuk mulai mencari barang di gudang ini.';
    } else {
      document.getElementById('emptyTitle').textContent = 'Tidak ditemukan';
      document.getElementById('emptyDesc').textContent = 'Coba kata kunci lain atau ganti filter.';
    }
    return;
  }
  empty.style.display = 'none';
  container.innerHTML = list.map(renderCard).join('');

  container.querySelectorAll('.item-card').forEach((el) => {
    el.addEventListener('click', () => openDetail(el.dataset.sku));
  });
}

function renderCard(b) {
  const hasLokasi = !!b.lokasi_rak;
  const total = GudangDB.totalStok(b.stok);
  return `
    <div class="item-card" data-sku="${escapeHtml(b.sku)}">
      <div class="item-card__top">
        <div>
          <div class="item-card__part mono">${escapeHtml(b.part_number || b.sku)}</div>
          <div class="item-card__name">${escapeHtml(b.nama_barang)}</div>
          <div class="item-card__cat">${b.satuan ? escapeHtml(b.satuan) : '—'}</div>
        </div>
        <span class="item-card__qty">Total <b>${total.toLocaleString('id-ID')}</b></span>
      </div>
      <div class="stok-chips">${renderStokChips(b.stok)}</div>
      <div class="item-card__bottom" style="margin-top:10px;">
        <span class="item-card__loc ${hasLokasi ? '' : 'is-empty'}">
          ${hasLokasi ? Icons.pin : Icons.alert}
          ${hasLokasi ? escapeHtml(b.lokasi_rak) : 'Belum ada lokasi rak'}
        </span>
      </div>
    </div>`;
}

async function openDetail(sku) {
  const b = await GudangDB.getBarang(sku);
  if (!b) return;
  const hasLokasi = !!b.lokasi_rak;
  const total = GudangDB.totalStok(b.stok);

  const breakdownRows = GudangDB.STORAGE_LOCATION_ORDER.map((code) => {
    const loc = GudangDB.STORAGE_LOCATIONS[code];
    const qty = b.stok?.[code] || 0;
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border);">
        <span class="badge badge--${loc.badge}">${loc.label}</span>
        <b class="mono">${qty.toLocaleString('id-ID')}</b>
      </div>`;
  }).join('');

  document.getElementById('detailContent').innerHTML = `
    <div>
      <div class="item-card__part mono">${escapeHtml(b.part_number || b.sku)}</div>
      <h2 style="font-size:19px; margin-top:4px;">${escapeHtml(b.nama_barang)}</h2>
      <p class="text-muted" style="font-size:12.5px; margin-top:2px;">Satuan: ${escapeHtml(b.satuan || '—')}</p>
    </div>

    <div class="summary-grid" style="grid-template-columns: 1fr;">
      <div class="summary-stat">
        <b>${total.toLocaleString('id-ID')}</b>
        <span>Total Qty (semua lokasi)</span>
      </div>
    </div>

    <div class="field" style="margin-top:18px;">
      <label>Breakdown per storage location</label>
      <div class="card" style="padding:4px 16px;">${breakdownRows}</div>
    </div>

    <div class="field">
      <label>Lokasi rak (fisik, manual)</label>
      <div class="rak-target" style="padding:18px;">
        <div class="rak-target__code" style="font-size:20px;">${hasLokasi ? escapeHtml(b.lokasi_rak) : '— belum diassign —'}</div>
      </div>
    </div>

    ${b.tanggal_kedatangan ? `
    <div class="field">
      <label>Tanggal kedatangan (CKD/Import)</label>
      <input class="mono" value="${formatDate(b.tanggal_kedatangan)}" disabled>
    </div>` : ''}

    <div class="field">
      <label>Terakhir sync dari SAP</label>
      <input value="${relativeTime(b.last_synced)}" disabled>
    </div>

    <a href="rak.html?assign=${encodeURIComponent(b.sku)}" class="btn btn--primary btn--block btn--lg">
      ${Icons.scan} ${hasLokasi ? 'Ubah lokasi rak' : 'Assign lokasi rak'}
    </a>
    <button class="btn btn--ghost btn--block" id="closeDetailBtn" style="margin-top:8px;">Tutup</button>
  `;

  document.getElementById('closeDetailBtn').addEventListener('click', closeDetail);
  document.getElementById('sheetBackdrop').classList.add('open');
  document.getElementById('detailSheet').classList.add('open');
}

function closeDetail() {
  document.getElementById('sheetBackdrop').classList.remove('open');
  document.getElementById('detailSheet').classList.remove('open');
}

initBeranda();
