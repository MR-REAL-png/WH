/* =========================================================
   GUDANG — IndexedDB layer
   Stores:
     barang  (keyPath: sku)  -> part_number, nama, kategori, stok_qty,
                                 status ('unpack'|'highrack'),
                                 tanggal_kedatangan, lokasi_rak,
                                 last_synced
     meta    (keyPath: key)  -> last_import_at, dsb
   ========================================================= */
const DB_NAME = 'gudang_db';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('barang')) {
        const store = db.createObjectStore('barang', { keyPath: 'sku' });
        store.createIndex('nama_barang', 'nama_barang', { unique: false });
        store.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

const GudangDB = {
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
   * Merge satu baris hasil import Excel ke record existing.
   * Field dari SAP (nama, kategori, stok, part_number, tanggal_kedatangan jika ada)
   * DIUPDATE. Field lokasi_rak & status TIDAK PERNAH ditimpa oleh import.
   */
  mergeFromImport(existing, incoming) {
    const now = new Date().toISOString();
    if (!existing) {
      return {
        sku: incoming.sku,
        part_number: incoming.part_number || incoming.sku,
        nama_barang: incoming.nama_barang,
        kategori: incoming.kategori || '',
        stok_qty: incoming.stok_qty || 0,
        status: 'unpack',
        lokasi_rak: '',
        tanggal_kedatangan: incoming.tanggal_kedatangan || now.slice(0, 10),
        last_synced: now,
        is_new: true,
      };
    }
    return {
      ...existing,
      part_number: incoming.part_number || existing.part_number,
      nama_barang: incoming.nama_barang || existing.nama_barang,
      kategori: incoming.kategori || existing.kategori,
      stok_qty: incoming.stok_qty ?? existing.stok_qty,
      // tanggal_kedatangan: hanya isi kalau sebelumnya kosong
      tanggal_kedatangan: existing.tanggal_kedatangan || incoming.tanggal_kedatangan || now.slice(0, 10),
      last_synced: now,
      is_new: false,
      // lokasi_rak & status sengaja tidak disentuh
    };
  },

  /**
   * Assign / ubah lokasi rak sebuah barang.
   * Otomatis set status -> 'highrack' kalau lokasi diisi, 'unpack' kalau dikosongkan.
   */
  async assignLokasi(sku, lokasiRak) {
    const item = await this.getBarang(sku);
    if (!item) throw new Error('Barang tidak ditemukan: ' + sku);
    item.lokasi_rak = lokasiRak || '';
    item.status = lokasiRak ? 'highrack' : 'unpack';
    if (lokasiRak && !item.tanggal_kedatangan) {
      item.tanggal_kedatangan = new Date().toISOString().slice(0, 10);
    }
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
      unpack: all.filter((b) => b.status === 'unpack').length,
      highrack: all.filter((b) => b.status === 'highrack').length,
      tanpaLokasi: all.filter((b) => !b.lokasi_rak).length,
    };
  },
};
