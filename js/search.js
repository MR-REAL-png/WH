/* =========================================================
   GUDANG — Beranda / Search page logic
   ========================================================= */
let allBarang = [];
let currentFilter = 'all';
let currentQuery = '';

async function initBeranda() {
  renderBottomNav('beranda');
  document.getElementById('searchIconSlot').innerHTML = Icons.search;
  document.getElementById('emptyIconSlot').innerHTML = Icons.empty;

  document.getElementById('searchInput').addEventListener('input', (e) => {
    currentQuery = e.target.value;
    renderList();
  });

  document.querySelectorAll('.filter-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderList();
    });
  });

  document.getElementById('sheetBackdrop').addEventListener('click', closeDetail);

  await loadData();
}

async function loadData() {
  allBarang = await GudangDB.getAllBarang();
  await renderSyncMeta();
  renderList();
}

async function renderSyncMeta() {
  const lastImport = await GudangDB.getMeta('last_import_at');
  const el = document.getElementById('syncMeta');
  const dot = el.querySelector('.dot');
  if (!lastImport) {
    el.innerHTML = `<span class="dot dot--stale"></span><span>Belum pernah import data</span>`;
    return;
  }
  const diffDays = (Date.now() - new Date(lastImport).getTime()) / 86400000;
  const isStale = diffDays > 3;
  el.innerHTML = `<span class="dot ${isStale ? 'dot--stale' : ''}"></span><span>Sync terakhir: ${relativeTime(lastImport)}</span>`;
}

function getFilteredSorted() {
  let list = allBarang;

  if (currentFilter === 'unpack') list = list.filter((b) => b.status === 'unpack');
  else if (currentFilter === 'highrack') list = list.filter((b) => b.status === 'highrack');
  else if (currentFilter === 'tanpa_lokasi') list = list.filter((b) => !b.lokasi_rak);

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
      document.getElementById('emptyDesc').textContent = 'Coba kata kunci lain atau ganti filter status.';
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
  const badgeClass = b.status === 'highrack' ? 'badge--highrack' : 'badge--unpack';
  const badgeLabel = b.status === 'highrack' ? 'Highrack' : 'Unpack';
  return `
    <div class="item-card" data-sku="${escapeHtml(b.sku)}">
      <div class="item-card__top">
        <div>
          <div class="item-card__part mono">${escapeHtml(b.part_number || b.sku)}</div>
          <div class="item-card__name">${escapeHtml(b.nama_barang)}</div>
          <div class="item-card__cat">${escapeHtml(b.kategori || '—')}</div>
        </div>
        <span class="badge ${badgeClass}">${badgeLabel}</span>
      </div>
      <div class="item-card__bottom">
        <span class="item-card__loc ${hasLokasi ? '' : 'is-empty'}">
          ${hasLokasi ? Icons.pin : Icons.alert}
          ${hasLokasi ? escapeHtml(b.lokasi_rak) : 'Belum ada lokasi'}
        </span>
        <span class="item-card__qty">Stok <b>${b.stok_qty ?? 0}</b></span>
      </div>
    </div>`;
}

async function openDetail(sku) {
  const b = await GudangDB.getBarang(sku);
  if (!b) return;
  const hasLokasi = !!b.lokasi_rak;
  const badgeClass = b.status === 'highrack' ? 'badge--highrack' : 'badge--unpack';
  const badgeLabel = b.status === 'highrack' ? 'Highrack' : 'Unpack';

  document.getElementById('detailContent').innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
      <div>
        <div class="item-card__part mono">${escapeHtml(b.part_number || b.sku)}</div>
        <h2 style="font-size:19px; margin-top:4px;">${escapeHtml(b.nama_barang)}</h2>
      </div>
      <span class="badge ${badgeClass}">${badgeLabel}</span>
    </div>

    <div class="summary-grid" style="grid-template-columns: 1fr 1fr;">
      <div class="summary-stat">
        <b>${b.stok_qty ?? 0}</b>
        <span>Stok Qty</span>
      </div>
      <div class="summary-stat">
        <b style="font-size:15px;">${escapeHtml(b.kategori || '—')}</b>
        <span>Kategori</span>
      </div>
    </div>

    <div class="field" style="margin-top:18px;">
      <label>Lokasi rak</label>
      <div class="rak-target" style="padding:18px;">
        <div class="rak-target__code" style="font-size:20px;">${hasLokasi ? escapeHtml(b.lokasi_rak) : '— belum diassign —'}</div>
      </div>
    </div>

    <div class="field">
      <label>Tanggal kedatangan</label>
      <input class="mono" value="${formatDate(b.tanggal_kedatangan)}" disabled>
    </div>

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
