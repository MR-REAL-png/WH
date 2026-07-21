/* =========================================================
   GUDANG — Halaman Pengaturan
   Isinya ringkasan data + tombol "Hapus Semua Data" (perlu ketik ulang
   kata konfirmasi "HAPUS" dulu sebelum tombolnya aktif, supaya gak
   kepencet gak sengaja).
   ========================================================= */
async function initSettingsPage() {
  renderBottomNav('settings');
  await renderStats();

  const confirmInput = document.getElementById('confirmText');
  const deleteBtn = document.getElementById('deleteAllBtn');

  confirmInput.addEventListener('input', (e) => {
    deleteBtn.disabled = e.target.value.trim().toUpperCase() !== 'HAPUS';
  });

  deleteBtn.addEventListener('click', handleDeleteAll);
}

async function renderStats() {
  const stats = await GudangDB.countAll();
  document.getElementById('statTotalBarang').textContent = stats.total.toLocaleString('id-ID');
  document.getElementById('statTanpaLokasi').textContent = stats.tanpaLokasi.toLocaleString('id-ID');

  const lastImport = await GudangDB.getMeta('last_import_at');
  document.getElementById('statLastImport').textContent = lastImport
    ? `${relativeTime(lastImport)} (${formatDate(lastImport)})`
    : 'Belum pernah import';
}

async function handleDeleteAll() {
  const btn = document.getElementById('deleteAllBtn');
  const confirmInput = document.getElementById('confirmText');
  btn.disabled = true;
  btn.textContent = 'Menghapus…';

  try {
    await GudangDB.hapusSemuaData();
    showToast('Semua data barang & lokasi rak berhasil dihapus', 'success');
    confirmInput.value = '';
    await renderStats();
  } catch (err) {
    console.error(err);
    showToast('Gagal menghapus data: ' + err.message, 'error');
  } finally {
    btn.textContent = 'Hapus Semua Data';
    // btn.disabled tetap true sampai user ketik ulang "HAPUS" lagi
  }
}

initSettingsPage();
