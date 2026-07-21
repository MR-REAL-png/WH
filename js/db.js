/* =========================================================
   GUDANG — IndexedDB layer
   Stores:
     barang (keyPath: sku) -> part_number, nama_barang, satuan,
       stok: { "1101": qty, "1102": qty, "1401": qty },
       tanggal_kedatangan (dari baris 1401),
       lokasi_rak: { "1101": kode_rak, "1102": kode_rak, "1401": kode_rak }
         — PER STORAGE LOCATION (lihat catatan migrasi di bawah), manual,
           TIDAK terkait/di-generate otomatis dari storage location SAP itu
           sendiri (cuma kebetulan pakai kode yang sama sebagai key).
       last_synced
     meta (keyPath: key) -> last_import_at, dsb

   CATATAN PERUBAHAN SKEMA lokasi_rak (Juli 2026):
   Sebelumnya lokasi_rak itu 1 STRING per barang (1 rak buat semua stok
   barang itu, di manapun storage location-nya). Ternyata di lapangan 1
   part number bisa fisiknya kesebar di >1 lokasi (misal sebagian masih
   di Highrack, sebagian sudah di-unpack) dengan RAK FISIK YANG BEDA — jadi
   sekarang lokasi_rak jadi OBJEK per kode storage location, sama pola-nya
   kayak field `stok`.
   MIGRASI: record lama yang lokasi_rak-nya masih string ditangani otomatis
   & transparan tiap kali dibaca (lihat normalizeLokasiRak) — nilai lama itu
   dipakaikan ke semua storage location yang qty-nya >0 (asumsi paling masuk
   akal: dulu memang cuma ada 1 rak krn belum dipisah per lokasi). Hasil
   migrasi otomatis disimpan balik ke IndexedDB supaya cuma jalan sekali per
   barang.
   ========================================================= */
const DB_NAME = 'gudang_db';
const DB_VERSION = 2;

// Kode storage location SAP -> label & arti fisiknya di gudang
// (2101 "Line Produksi" sengaja tidak dipakai — barang sudah keluar gudang, tidak relevan dicari)
const STORAGE_LOCATIONS = {
  '1101': { label: 'Supplier Lokal', short: 'Lokal', badge: 'loc-1101' },
  '1102': { label: 'Unpack', short: 'Unpack', badge: 'loc-1102' },
  '1401': { label: 'Highrack', short: 'Highrack', badge: 'loc-1401' },
};
const STORAGE_LOCATION_ORDER = ['1101', '1102', '1401'];

// Scan QR/barcode papan zona gudang — isinya cukup kode storage location
// polos (1101/1102/1401), sama persis dengan kode SAP.
function matchZoneCode(raw) {
  const norm = String(raw || '').trim();
  return STORAGE_LOCATION_ORDER.includes(norm) ? norm : null;
}

function emptyStok() {
  return { '1101': 0, '1102': 0, '1401': 0 };
}

function emptyLokasiRak() {
  return { '1101': '', '1102': '', '1401': '' };
}

/**
 * Migrasi in-place: kalau item.lokasi_rak masih format lama (string),
 * ubah jadi objek per storage location. Kalau sudah objek/kosong, cuma
 * dipastikan semua key ada. Nge-set item._migrated = true kalau ada
 * perubahan, supaya caller tahu perlu disimpan balik ke IndexedDB.
 */
function normalizeLokasiRak(item) {
  if (!item) return item;
  if (typeof item.lokasi_rak === 'string') {
    const oldValue = item.lokasi_rak;
    const migrated = emptyLokasiRak();
    if (oldValue) {
      for (const code of STORAGE_LOCATION_ORDER) {
        if ((item.stok?.[code] || 0) > 0) migrated[code] = oldValue;
      }
    }
    item.lokasi_rak = migrated;
    item._migrated = true;
  } else if (!item.lokasi_rak || typeof item.lokasi_rak !== 'object') {
    item.lokasi_rak = emptyLokasiRak();
    item._migrated = true;
  } else {
    // Pastikan semua key storage location ada (jaga-jaga data parsial)
    for (const code of STORAGE_LOCATION_ORDER) {
      if (item.lokasi_rak[code] === undefined) {
        item.lokasi_rak[code] = '';
        item._migrated = true;
      }
    }
  }
  return item;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('barang')) {
        const store = db.createObjectStore('barang', { keyPath: 'sku' });
        store.createIndex('nama_barang', 'nama_barang', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function totalStok(stok) {
  if (!stok) return 0;
  return STORAGE_LOCATION_ORDER.reduce((sum, code) => sum + (stok[code] || 0), 0);
}

const GudangDB = {
  STORAGE_LOCATIONS,
  STORAGE_LOCATION_ORDER,
  totalStok,
  matchZoneCode,

  async getAllBarang() {
    const db = await openDB();
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction('barang', 'readonly');
      const req = tx.objectStore('barang').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    all.forEach(normalizeLokasiRak);
    const toMigrate = all.filter((it) => it._migrated);
    if (toMigrate.length > 0) {
      toMigrate.forEach((it) => delete it._migrated);
      this.putManyBarang(toMigrate).catch((err) => console.error('Migrasi lokasi_rak gagal disimpan:', err));
    }
    all.forEach((it) => delete it._migrated);
    return all;
  },

  async getBarang(sku) {
    const db = await openDB();
    const item = await new Promise((resolve, reject) => {
      const tx = db.transaction('barang', 'readonly');
      const req = tx.objectStore('barang').get(sku);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (!item) return null;
    normalizeLokasiRak(item);
    if (item._migrated) {
      delete item._migrated;
      this.putBarang(item).catch((err) => console.error('Migrasi lokasi_rak gagal disimpan:', err));
    }
    return item;
  },

  async putBarang(item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('barang', 'readwrite');
      tx.objectStore('barang').put(item);
      tx.oncomplete = () => resolve(item);
      tx.onerror = () => reject(tx.error);
    });
  },

  async putManyBarang(items) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('barang', 'readwrite');
      const store = tx.objectStore('barang');
      items.forEach((it) => store.put(it));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * Merge satu GROUP baris import (semua baris dengan part_number yang sama,
   * dari berbagai storage location) ke record existing.
   * incomingGroup: { sku, part_number, nama_barang, satuan,
   *                  stok: {1101,1102,1401}, tanggal_kedatangan,
   *                  lokasi_rak: {1101?, 1102?, 1401?} }
   * lokasi_rak PER STORAGE LOCATION cuma ditimpa kalau kolom "lokasi rak" di
   * baris Excel untuk lokasi itu memang terisi — kalau tidak ada kolomnya
   * sama sekali di file SAP (kasus normal), lokasi_rak existing dibiarkan
   * apa adanya (tetap dikelola manual lewat halaman Rak).
   */
  mergeFromImport(existing, incomingGroup) {
    const now = new Date().toISOString();
    const incomingLokasi = incomingGroup.lokasi_rak || {};

    if (!existing) {
      const lokasi_rak = emptyLokasiRak();
      for (const code of STORAGE_LOCATION_ORDER) {
        if (incomingLokasi[code]) lokasi_rak[code] = incomingLokasi[code];
      }
      return {
        sku: incomingGroup.sku,
        part_number: incomingGroup.part_number || incomingGroup.sku,
        nama_barang: incomingGroup.nama_barang,
        satuan: incomingGroup.satuan || '',
        stok: { ...emptyStok(), ...incomingGroup.stok },
        tanggal_kedatangan: incomingGroup.tanggal_kedatangan || '',
        lokasi_rak,
        last_synced: now,
        is_new: true,
      };
    }

    normalizeLokasiRak(existing); // jaga-jaga kalau existing masih format lama (belum sempat termigrasi)
    delete existing._migrated;

    const mergedStok = { ...existing.stok };
    for (const code of STORAGE_LOCATION_ORDER) {
      if (incomingGroup.stok[code] !== undefined) mergedStok[code] = incomingGroup.stok[code];
    }

    const mergedLokasi = { ...existing.lokasi_rak };
    for (const code of STORAGE_LOCATION_ORDER) {
      if (incomingLokasi[code]) mergedLokasi[code] = incomingLokasi[code];
    }

    return {
      ...existing,
      part_number: incomingGroup.part_number || existing.part_number,
      nama_barang: incomingGroup.nama_barang || existing.nama_barang,
      satuan: incomingGroup.satuan || existing.satuan,
      stok: mergedStok,
      tanggal_kedatangan: incomingGroup.tanggal_kedatangan || existing.tanggal_kedatangan || '',
      lokasi_rak: mergedLokasi,
      last_synced: now,
      is_new: false,
    };
  },

  /** Assign / ubah lokasi rak fisik untuk SATU storage location tertentu */
  async assignLokasi(sku, code, lokasiRak) {
    if (!STORAGE_LOCATION_ORDER.includes(code)) {
      throw new Error('Storage location tidak valid: ' + code);
    }
    const item = await this.getBarang(sku);
    if (!item) throw new Error('Barang tidak ditemukan: ' + sku);
    item.lokasi_rak[code] = lokasiRak || '';
    return this.putBarang(item);
  },

  /**
   * Cari semua barang yang punya rak ini di storage location manapun.
   * Tiap hasil dikasih _matchedCodes: array kode storage location yang
   * rak-nya cocok (barang yang sama bisa beda rak di lokasi lain, jadi
   * cuma lokasi yang match yang relevan ditampilkan di halaman Rak).
   */
  async getBarangByRak(lokasiRak) {
    const target = String(lokasiRak || '').trim().toUpperCase();
    if (!target) return [];
    const all = await this.getAllBarang();
    const result = [];
    for (const b of all) {
      const matchedCodes = STORAGE_LOCATION_ORDER.filter(
        (code) => (b.lokasi_rak[code] || '').toUpperCase() === target
      );
      if (matchedCodes.length > 0) result.push({ ...b, _matchedCodes: matchedCodes });
    }
    return result;
  },

  /** Storage location yang qty-nya >0 utk barang ini (dipakai buat nentuin butuh nanya lokasi mana pas assign rak) */
  activeLocations(item) {
    return STORAGE_LOCATION_ORDER.filter((code) => (item.stok?.[code] || 0) > 0);
  },

  /** Ada minimal 1 storage location aktif (qty>0) yang sudah punya rak */
  hasAnyLokasi(item) {
    return this.activeLocations(item).some((code) => item.lokasi_rak?.[code]);
  },

  /** Semua storage location aktif (qty>0) BELUM ada rak sama sekali */
  isFullyUnassigned(item) {
    const activeCodes = this.activeLocations(item);
    if (activeCodes.length === 0) {
      return !STORAGE_LOCATION_ORDER.some((code) => item.lokasi_rak?.[code]);
    }
    return activeCodes.every((code) => !item.lokasi_rak?.[code]);
  },

  async setMeta(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getMeta(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readonly');
      const req = tx.objectStore('meta').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  },

  async countAll() {
    const all = await this.getAllBarang();
    return {
      total: all.length,
      tanpaLokasi: all.filter((b) => this.isFullyUnassigned(b)).length,
    };
  },

  /**
   * Hapus SEMUA data barang & meta dari IndexedDB perangkat ini. Permanen,
   * tidak ada undo. Dipakai dari halaman Pengaturan kalau import sebelumnya
   * kacau dan user mau mulai bersih dari nol.
   */
  async hapusSemuaData() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['barang', 'meta'], 'readwrite');
      tx.objectStore('barang').clear();
      tx.objectStore('meta').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};
