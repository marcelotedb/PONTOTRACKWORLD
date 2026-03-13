// ============================================================
// PontoTrack - IndexedDB Database Module (db.js)
// Persistência offline robusta usando IndexedDB
// ============================================================

const DB_NAME = 'PontoTrackDB';
const DB_VERSION = 4;

class PontoTrackDB {
  constructor() {
    this.db = null;
    this._ready = this._init();
  }

  async _init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store de funcionários
        if (db.objectStoreNames.contains('employees')) {
          // Recriar para corrigir índice unique do email
          db.deleteObjectStore('employees');
        }
        const empStore = db.createObjectStore('employees', { keyPath: 'id' });
        empStore.createIndex('name', 'name', { unique: false });
        empStore.createIndex('status', 'status', { unique: false });
        empStore.createIndex('email', 'email', { unique: false });

        // Store de registros de ponto
        if (!db.objectStoreNames.contains('records')) {
          const recStore = db.createObjectStore('records', { keyPath: 'id' });
          recStore.createIndex('employeeId', 'employeeId', { unique: false });
          recStore.createIndex('date', 'date', { unique: false });
          recStore.createIndex('timestamp', 'timestamp', { unique: false });
          recStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          recStore.createIndex('type', 'type', { unique: false });
          recStore.createIndex('obraId', 'obraId', { unique: false });
          recStore.createIndex('emp_date', ['employeeId', 'date'], { unique: false });
        }

        // Store de serviços em campo
        if (!db.objectStoreNames.contains('servicos_campo')) {
          const svcStore = db.createObjectStore('servicos_campo', { keyPath: 'id' });
          svcStore.createIndex('employeeId', 'employeeId', { unique: false });
          svcStore.createIndex('date', 'date', { unique: false });
          svcStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Store de obras/fazendas
        if (!db.objectStoreNames.contains('obras')) {
          const obraStore = db.createObjectStore('obras', { keyPath: 'id' });
          obraStore.createIndex('name', 'name', { unique: false });
          obraStore.createIndex('active', 'active', { unique: false });
        }

        // Store de justificativas
        if (!db.objectStoreNames.contains('justificativas')) {
          const justStore = db.createObjectStore('justificativas', { keyPath: 'id' });
          justStore.createIndex('userId', 'userId', { unique: false });
          justStore.createIndex('status', 'status', { unique: false });
        }

        // Store de configurações
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // Fila de sincronização
        if (!db.objectStoreNames.contains('syncQueue')) {
          const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
          syncStore.createIndex('collection', 'collection', { unique: false });
          syncStore.createIndex('timestamp', 'timestamp', { unique: false });
          syncStore.createIndex('action', 'action', { unique: false });
        }

        // Log de conflitos
        if (!db.objectStoreNames.contains('conflictLog')) {
          const conflictStore = db.createObjectStore('conflictLog', { keyPath: 'id', autoIncrement: true });
          conflictStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        console.log('[DB] Schema criado/atualizado com sucesso');
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('[DB] Banco de dados aberto com sucesso');
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('[DB] Erro ao abrir banco de dados:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async ready() {
    await this._ready;
    return this;
  }

  // ---- CRUD genérico ----

  async getAll(storeName) {
    await this._ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async get(storeName, id) {
    await this._ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName, data) {
    await this._ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async add(storeName, data) {
    await this._ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.add(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName, id) {
    await this._ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(storeName) {
    await this._ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async count(storeName) {
    await this._ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ---- Consultas por índice ----

  async getByIndex(storeName, indexName, value) {
    await this._ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getByRange(storeName, indexName, lower, upper) {
    await this._ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const range = IDBKeyRange.bound(lower, upper);
      const request = index.getAll(range);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ---- Funções específicas ----

  async getRecordsByEmployee(employeeId) {
    return this.getByIndex('records', 'employeeId', employeeId);
  }

  async getRecordsByDate(date) {
    return this.getByIndex('records', 'date', date);
  }

  async getRecordsByEmployeeAndDate(employeeId, date) {
    return this.getByIndex('records', 'emp_date', [employeeId, date]);
  }

  async getPendingRecords() {
    return this.getByIndex('records', 'syncStatus', 'pending');
  }

  async getActiveEmployees() {
    return this.getByIndex('employees', 'status', 'active');
  }

  async getActiveObras() {
    return this.getByIndex('obras', 'active', true);
  }

  // ---- Fila de sincronização ----

  async addToSyncQueue(collection, docId, action, data) {
    return this.add('syncQueue', {
      collection,
      docId,
      action, // 'create', 'update', 'delete'
      data,
      timestamp: new Date().toISOString(),
      retries: 0
    });
  }

  async getSyncQueue() {
    return this.getAll('syncQueue');
  }

  async removeSyncItem(id) {
    return this.delete('syncQueue', id);
  }

  async clearSyncQueue() {
    return this.clear('syncQueue');
  }

  // ---- Log de conflitos ----

  async logConflict(localData, remoteData, resolution) {
    return this.add('conflictLog', {
      localData,
      remoteData,
      resolution,
      timestamp: new Date().toISOString()
    });
  }

  // ---- Configurações ----

  async getSetting(key) {
    const result = await this.get('settings', key);
    return result ? result.value : null;
  }

  async setSetting(key, value) {
    return this.put('settings', { key, value });
  }

  // ---- Bulk operations ----

  async bulkPut(storeName, items) {
    await this._ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      
      items.forEach(item => store.put(item));
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---- Stats / Métricas ----

  async getRecordsInPeriod(employeeId, startDate, endDate) {
    const all = await this.getRecordsByEmployee(employeeId);
    return all.filter(r => {
      const ts = new Date(r.timestamp);
      return ts >= new Date(startDate) && ts <= new Date(endDate);
    });
  }

  // Exportar todos os dados (backup)
  async exportAll() {
    const data = {};
    const storeNames = ['employees', 'records', 'obras', 'justificativas', 'settings'];
    for (const storeName of storeNames) {
      data[storeName] = await this.getAll(storeName);
    }
    return data;
  }

  // Importar dados (restore)
  async importAll(data) {
    for (const [storeName, items] of Object.entries(data)) {
      if (Array.isArray(items)) {
        await this.bulkPut(storeName, items);
      }
    }
  }
}

// Singleton
window.ptDB = new PontoTrackDB();
