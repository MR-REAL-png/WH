/* =========================================================
   GUDANG — Kelola Rak page logic
   Scanner fisik Zebra (DataWedge) mengirim hasil scan sebagai
   keystroke ke input yang sedang fokus — jadi cukup fokuskan
   #rakInput, tidak perlu kode khusus untuk itu.
   Tombol "Scan" di sini hanya fallback kamera (html5-qrcode),
   untuk kondisi DataWedge belum di-setup / testing di browser biasa.
   ========================================================= */
let activeRak = '';
let assignTargetSku = null; // dipakai kalau datang dari index.html?assign=SKU

async function initRakPage() {
  renderBottomNav('rak');
  document.getElementById('scanIconSlot').innerHTML = Icons.scan;
  document.getElementById('assignSearchIconSlot').innerHTML = Icons.search;

  const rakInput = document.getElementById('rakInput');
  rakInput.addEventListener('keyup', (e) => {
    // Scanner biasanya diakhiri Enter setelah suntik teks — trigger langsung
    if (e.key === 'Enter' || rakInput.value.trim().length >= 4) {
      loadRak(rakInput.value.trim());
    }
  });
  rakInput.addEventListener('blur', () => {
    if (rakInput.value.trim()) loadRak(rakInput.value.trim());
  });

  document.getElementById('scanBtn').addEventListener('click', scanWithCamera);
  document.getElementById('sheetBackdrop').addEventListener('click', closeAssignSheet);
  document.getElementById('addToRakBtn').addEventListener('click', openAssignSheet);
  document.getElementById('assignSearchInput').addEventListener('input', (e) => renderAssignResults(e.target.value));

  // Kalau dibuka dari index.html dengan ?assign=SKU, langsung buka sheet setelah user tentukan rak
  const params = new URLSearchParams(location.search);
  assignTargetSku = params.get('assign');
  if (assignTargetSku) {
    const item = await GudangDB.getBarang(assignTargetSku);
    if (item && item.lokasi_rak) {
      rakInput.value = item.lokasi_rak;
      loadRak(item.lokasi_rak);
    }
    showToast(`Pilih atau scan rak, lalu barang ini akan otomatis ditambahkan`, 'default');
  }
}

async function loadRak(kode) {
  if (!kode) return;
  activeRak = kode.toUpperCase();
  document.getElementById('rakInput').value = activeRak;
  await renderRakTarget();
  await renderRakItems();

  // Kalau datang dari flow "assign lokasi" halaman detail, langsung eksekusi assign
  if (assignTargetSku) {
    await GudangDB.assignLokasi(assignTargetSku, activeRak);
    showToast(`Barang berhasil di-assign ke ${activeRak}`, 'success');
    assignTargetSku = null;
    await renderRakItems();
  }
}

async function renderRakTarget() {
  const el = document.getElementById('rakTargetArea');
  el.innerHTML = `
    <div class="rak-target is-active" style="margin-top:14px;">
      <div class="rak-target__code">${escapeHtml(activeRak)}</div>
      <div class="rak-target__hint">Rak aktif — barang di bawah ini tersimpan di lokasi ini</div>
    </div>`;
  document.getElementById('assignArea').style.display = 'block';
}

async function renderRakItems() {
  const items = await GudangDB.getBarangByRak(activeRak);
  const list = document.getElementById('rakItemList');

  if (items.length === 0) {
    list.innerHTML = `<p class="text-muted" style="font-size:13px; padding:12px 4px;">Rak ini masih kosong.</p>`;
    return;
  }

  list.innerHTML = items
    .map((b) => {
      const total = GudangDB.totalStok(b.stok);
      return `
    <div class="item-card">
      <div class="item-card__top">
        <div>
          <div class="item-card__part mono">${escapeHtml(b.part_number || b.sku)}</div>
          <div class="item-card__name">${escapeHtml(b.nama_barang)}</div>
        </div>
        <span class="item-card__qty">Total <b>${total.toLocaleString('id-ID')}</b></span>
      </div>
      <div class="stok-chips">${GudangDB.STORAGE_LOCATION_ORDER.filter((c) => (b.stok?.[c] || 0) > 0)
        .map((c) => `<span class="stok-chip loc-${c}">${GudangDB.STORAGE_LOCATIONS[c].short} <b>${b.stok[c].toLocaleString('id-ID')}</b></span>`)
        .join('')}</div>
      <div class="item-card__bottom" style="margin-top:10px;">
        <button class="btn btn--ghost" style="padding:6px 10px; font-size:12.5px;" onclick="removeFromRak('${escapeHtml(b.sku)}')">Keluarkan dari rak</button>
      </div>
    </div>`;
    })
    .join('');
}

async function removeFromRak(sku) {
  await GudangDB.assignLokasi(sku, '');
  showToast('Barang dikeluarkan dari rak', 'default');
  await renderRakItems();
}

function openAssignSheet() {
  if (!activeRak) {
    showToast('Tentukan kode rak dulu', 'error');
    return;
  }
  document.getElementById('assignSearchInput').value = '';
  renderAssignResults('');
  document.getElementById('sheetBackdrop').classList.add('open');
  document.getElementById('assignSheet').classList.add('open');
}

function closeAssignSheet() {
  document.getElementById('sheetBackdrop').classList.remove('open');
  document.getElementById('assignSheet').classList.remove('open');
}

async function renderAssignResults(query) {
  const all = await GudangDB.getAllBarang();
  let list = all;
  if (query.trim()) {
    list = all
      .map((b) => ({ item: b, score: Math.max(searchScore(query, b.nama_barang), searchScore(query, b.part_number)) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }
  list = list.slice(0, 30);

  const container = document.getElementById('assignResultList');
  if (list.length === 0) {
    container.innerHTML = `<p class="text-muted" style="font-size:13px; padding:12px 4px;">Tidak ditemukan.</p>`;
    return;
  }
  container.innerHTML = list
    .map(
      (b) => `
    <div class="item-card" data-sku="${escapeHtml(b.sku)}" style="padding:12px 14px;">
      <div class="item-card__top">
        <div>
          <div class="item-card__part mono">${escapeHtml(b.part_number || b.sku)}</div>
          <div class="item-card__name" style="font-size:14px;">${escapeHtml(b.nama_barang)}</div>
        </div>
        ${b.lokasi_rak ? `<span class="badge badge--loc-1102">${escapeHtml(b.lokasi_rak)}</span>` : ''}
      </div>
    </div>`
    )
    .join('');

  container.querySelectorAll('.item-card').forEach((el) => {
    el.addEventListener('click', () => assignItemToActiveRak(el.dataset.sku));
  });
}

async function assignItemToActiveRak(sku) {
  await GudangDB.assignLokasi(sku, activeRak);
  showToast('Barang berhasil ditambahkan ke rak', 'success');
  closeAssignSheet();
  await renderRakItems();
}

/**
 * Fallback kamera pakai html5-qrcode (js/vendor/html5-qrcode.min.js — self-hosted).
 * Ini cadangan kalau DataWedge belum disetup / testing di luar PDA.
 * Scanner fisik Zebra TIDAK butuh fungsi ini sama sekali.
 */
function scanWithCamera() {
  if (typeof Html5Qrcode === 'undefined') {
    showToast('Kamera scan butuh js/vendor/html5-qrcode.min.js — pakai input manual untuk sekarang', 'default');
    document.getElementById('rakInput').focus();
    return;
  }
  // Implementasi kamera dipasang di sini setelah library ditambahkan
}

initRakPage();
