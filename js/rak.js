/* =========================================================
   GUDANG — Kelola Rak page logic
   Scanner fisik Zebra (DataWedge) mengirim hasil scan sebagai
   keystroke ke input yang sedang fokus — jadi cukup fokuskan
   #rakInput, tidak perlu kode khusus untuk itu.
   Tombol "Scan" di sini hanya fallback kamera (html5-qrcode),
   untuk kondisi DataWedge belum di-setup / testing di browser biasa.

   CATATAN SKEMA (Juli 2026): lokasi_rak sekarang PER STORAGE LOCATION
   (barang yang fisiknya kesebar di >1 lokasi gudang bisa punya rak beda-beda
   per lokasi). Jadi assign rak sekarang perlu tahu "ini buat storage
   location yang mana" — kalau part yang di-assign cuma aktif (qty>0) di 1
   lokasi, otomatis dipakai tanpa nanya; kalau aktif di >1 lokasi, user
   ditanya dulu lewat renderLocationChoice().
   ========================================================= */
let activeRak = '';
let assignTargetSku = null; // dipakai kalau datang dari index.html?assign=SKU
let assignTargetCode = null; // storage location spesifik, kalau datang dari index.html?assign=SKU&code=XXXX

async function initRakPage() {
  renderBottomNav('rak');
  document.getElementById('scanIconSlot').innerHTML = Icons.scan;
  document.getElementById('assignSearchIconSlot').innerHTML = Icons.search;

  const rakInput = document.getElementById('rakInput');
  rakInput.addEventListener('focus', () => rakInput.select());
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

  initGlobalScanCapture((scanned) => {
    rakInput.value = scanned.trim().toUpperCase();
    loadRak(scanned.trim());
  });

  // Kalau dibuka dari halaman detail dengan ?assign=SKU (&code=XXXX opsional)
  const params = new URLSearchParams(location.search);
  assignTargetSku = params.get('assign');
  assignTargetCode = params.get('code') || null;
  if (assignTargetSku) {
    const item = await GudangDB.getBarang(assignTargetSku);
    if (item) {
      const activeCodes = GudangDB.activeLocations(item);
      if (!assignTargetCode && activeCodes.length === 1) {
        assignTargetCode = activeCodes[0];
      }
      const existingRak = assignTargetCode ? item.lokasi_rak?.[assignTargetCode] : '';
      if (existingRak) {
        rakInput.value = existingRak;
        loadRak(existingRak);
      }
    }
    showToast('Pilih atau scan rak, lalu barang ini akan otomatis ditambahkan', 'default');
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
    if (assignTargetCode) {
      await GudangDB.assignLokasi(assignTargetSku, assignTargetCode, activeRak);
      showToast(`Barang berhasil di-assign ke ${activeRak} (${GudangDB.STORAGE_LOCATIONS[assignTargetCode].short})`, 'success');
      assignTargetSku = null;
      assignTargetCode = null;
      await renderRakItems();
    } else {
      // Part ini aktif di >1 storage location & belum jelas ini rak buat
      // yang mana — tanya lewat sheet pemilihan lokasi.
      const item = await GudangDB.getBarang(assignTargetSku);
      if (item) {
        const codes = GudangDB.activeLocations(item);
        openAssignSheet();
        renderLocationChoice(item, codes);
      }
      assignTargetSku = null;
    }
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
      // Cuma tampilkan chip & tombol keluarkan utk storage location yang
      // RAK-nya cocok dengan rak aktif ini (bisa jadi barang yg sama punya
      // rak lain di storage location lain — itu tidak relevan di sini).
      const matchedChips = b._matchedCodes
        .map((code) => {
          const loc = GudangDB.STORAGE_LOCATIONS[code];
          return `<span class="stok-chip loc-${code}">${loc.short} <b>${(b.stok[code] || 0).toLocaleString('id-ID')}</b></span>`;
        })
        .join('');
      const removeButtons = b._matchedCodes
        .map(
          (code) =>
            `<button class="btn btn--ghost" style="padding:6px 10px; font-size:12.5px;" onclick="removeFromRak('${escapeHtml(b.sku)}','${code}')">Keluarkan (${GudangDB.STORAGE_LOCATIONS[code].short})</button>`
        )
        .join('');
      return `
    <div class="item-card">
      <div class="item-card__top">
        <div>
          <div class="item-card__part mono">${escapeHtml(b.part_number || b.sku)}</div>
          <div class="item-card__name">${escapeHtml(b.nama_barang)}</div>
        </div>
        <span class="item-card__qty">Total <b>${total.toLocaleString('id-ID')}</b></span>
      </div>
      <div class="stok-chips">${matchedChips}</div>
      <div class="item-card__bottom" style="margin-top:10px; flex-wrap:wrap; gap:6px; justify-content:flex-start;">${removeButtons}</div>
    </div>`;
    })
    .join('');
}

async function removeFromRak(sku, code) {
  await GudangDB.assignLokasi(sku, code, '');
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
    .map((b) => {
      const existingBadges = GudangDB.STORAGE_LOCATION_ORDER.filter((code) => b.lokasi_rak?.[code])
        .map((code) => `<span class="badge badge--${GudangDB.STORAGE_LOCATIONS[code].badge}">${escapeHtml(b.lokasi_rak[code])}</span>`)
        .join(' ');
      return `
    <div class="item-card" data-sku="${escapeHtml(b.sku)}" style="padding:12px 14px;">
      <div class="item-card__top">
        <div>
          <div class="item-card__part mono">${escapeHtml(b.part_number || b.sku)}</div>
          <div class="item-card__name" style="font-size:14px;">${escapeHtml(b.nama_barang)}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end;">${existingBadges}</div>
      </div>
    </div>`;
    })
    .join('');

  container.querySelectorAll('.item-card').forEach((el) => {
    el.addEventListener('click', () => assignItemToActiveRak(el.dataset.sku));
  });
}

/**
 * Diklik dari hasil pencarian sheet "+ Tambah barang ke rak ini".
 * Kalau part ini cuma aktif (qty>0) di 1 storage location, langsung
 * di-assign. Kalau aktif di >1 lokasi, tanya dulu ini buat lokasi mana.
 */
async function assignItemToActiveRak(sku) {
  const item = await GudangDB.getBarang(sku);
  if (!item) return;
  const eligibleCodes = GudangDB.activeLocations(item);
  if (eligibleCodes.length <= 1) {
    const code = eligibleCodes[0] || GudangDB.STORAGE_LOCATION_ORDER[0];
    await finalizeAssign(sku, code);
    return;
  }
  renderLocationChoice(item, eligibleCodes);
}

/** Tampilkan pilihan storage location di dalam sheet yang sama, ganti isi assignResultList sementara */
function renderLocationChoice(item, codes) {
  const container = document.getElementById('assignResultList');
  container.innerHTML = `
    <p class="text-muted" style="font-size:13px; margin-bottom:10px; line-height:1.5;">
      <b>${escapeHtml(item.nama_barang)}</b> ada stok di lebih dari 1 lokasi gudang.
      Rak <span class="mono">${escapeHtml(activeRak)}</span> ini buat stok yang di lokasi mana?
    </p>
    ${codes
      .map((code) => {
        const loc = GudangDB.STORAGE_LOCATIONS[code];
        const qty = item.stok[code] || 0;
        const currentRak = item.lokasi_rak?.[code];
        return `
      <div class="item-card" data-code="${code}" style="padding:12px 14px;">
        <div class="item-card__top">
          <div>
            <span class="badge badge--${loc.badge}">${loc.label}</span>
            <div class="item-card__qty" style="margin-top:6px;">Qty: <b>${qty.toLocaleString('id-ID')}</b></div>
          </div>
          ${currentRak ? `<span class="text-muted mono" style="font-size:12px;">saat ini: ${escapeHtml(currentRak)}</span>` : ''}
        </div>
      </div>`;
      })
      .join('')}
    <button class="btn btn--ghost btn--block" id="backToSearchBtn" style="margin-top:10px;">&larr; Kembali cari barang lain</button>
  `;
  container.querySelectorAll('.item-card').forEach((el) => {
    el.addEventListener('click', () => finalizeAssign(item.sku, el.dataset.code));
  });
  document.getElementById('backToSearchBtn').addEventListener('click', () => {
    document.getElementById('assignSearchInput').value = '';
    renderAssignResults('');
  });
}

async function finalizeAssign(sku, code) {
  await GudangDB.assignLokasi(sku, code, activeRak);
  showToast(`Barang berhasil ditambahkan ke rak (${GudangDB.STORAGE_LOCATIONS[code].short})`, 'success');
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
