/* =========================================================
   GUDANG — IndexedDB layer
   Stores:
     barang (keyPath: sku) -> part_number, nama_barang, satuan,
       stok: { "1101": qty, "1102": qty, "1401": qty, "2101": qty },
       tanggal_kedatangan (dari baris 1401),
       lokasi_rak (manual, TIDAK terkait storage location SAP),
       last_synced
     meta (keyPath: key) -> last_import_at, dsb
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

// Isi QR/barcode yang ditempel di papan zona gudang — scan ini duluan
// buat filter list ke zona itu sebelum scan barang.
const ZONE_CODES = {
  'ZONA:LOKAL': '1101',
  'ZONA:UNPACK': '1102',
  'ZONA:HIGHRACK': '1401',
};

function matchZoneCode(raw) {
  const norm = String(raw || '').trim().toUpperCase();
  return ZONE_CODES[norm] || null;
}

function emptyStok() {
  return { '1101': 0, '1102': 0, '1401': 0 };
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
    return new Promise((resolve, reject) => {
      const tx = db.transaction('barang', 'readonly');
      const req = tx.objectStore('barang').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async getBarang(sku) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('barang', 'readonly');
      const req = tx.objectStore('barang').get(sku);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
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
   * incomingGroup: { sku, part_number, nama_barang, satuan, stok: {1101,1102,1401,2101}, tanggal_kedatangan }
   * lokasi_rak TIDAK PERNAH ditimpa oleh import — itu murni dikelola manual di app.
   */
  mergeFromImport(existing, incomingGroup) {
    const now = new Date().toISOString();
    if (!existing) {
      return {
        sku: incomingGroup.sku,
        part_number: incomingGroup.part_number || incomingGroup.sku,
        nama_barang: incomingGroup.nama_barang,
        satuan: incomingGroup.satuan || '',
        stok: { ...emptyStok(), ...incomingGroup.stok },
        tanggal_kedatangan: incomingGroup.tanggal_kedatangan || '',
        lokasi_rak: '',
        last_synced: now,
        is_new: true,
      };
    }
    // Hanya timpa qty lokasi yang memang ada di batch import ini
    const mergedStok = { ...existing.stok };
    for (const code of STORAGE_LOCATION_ORDER) {
      if (incomingGroup.stok[code] !== undefined) mergedStok[code] = incomingGroup.stok[code];
    }
    return {
      ...existing,
      part_number: incomingGroup.part_number || existing.part_number,
      nama_barang: incomingGroup.nama_barang || existing.nama_barang,
      satuan: incomingGroup.satuan || existing.satuan,
      stok: mergedStok,
      tanggal_kedatangan: incomingGroup.tanggal_kedatangan || existing.tanggal_kedatangan || '',
      last_synced: now,
      is_new: false,
      // lokasi_rak sengaja tidak disentuh
    };
  },

  /** Assign / ubah lokasi rak fisik (independen dari storage location SAP) */
  async assignLokasi(sku, lokasiRak) {
    const item = await this.getBarang(sku);
    if (!item) throw new Error('Barang tidak ditemukan: ' + sku);
    item.lokasi_rak = lokasiRak || '';
    return this.putBarang(item);
  },

  async getBarangByRak(lokasiRak) {
    const all = await this.getAllBarang();
    return all.filter((b) => b.lokasi_rak === lokasiRak);
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
      tanpaLokasi: all.filter((b) => !b.lokasi_rak).length,
    };
  },
};
