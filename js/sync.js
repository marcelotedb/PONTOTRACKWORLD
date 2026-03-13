// ============================================================
// PontoTrack - Sync Module (sync.js)
// Sincronização inteligente Firebase ↔ IndexedDB
// ============================================================

class SyncManager {
  constructor() {
    this.isOnline = navigator.onLine;
    this.isSyncing = false;
    this.firebaseReady = false;
    this.db = null;
    this.firestore = null;
    this.unsubscribers = [];
  }

  async init(firestore) {
    this.firestore = firestore;
    this.db = await window.ptDB.ready();
    this.firebaseReady = !!firestore;
    this._setupNetworkListeners();
    this._setupSWMessages();

    if (this.firebaseReady && this.isOnline) {
      await this.fullSync();
      this._setupRealtimeListeners();
    }
  }

  _setupNetworkListeners() {
    window.addEventListener('online', async () => {
      this.isOnline = true;
      document.getElementById('offlineBanner')?.classList.remove('active');
      document.body.classList.remove('is-offline');
      window.app?.showToast('Conexão restaurada! Sincronizando...', 'success');
      this._updateSyncUI('syncing');
      await this.syncPending();
      this._updateSyncUI('synced');
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      document.getElementById('offlineBanner')?.classList.add('active');
      document.body.classList.add('is-offline');
      window.app?.showToast('Modo offline ativado. Dados salvos localmente.', 'warning');
      this._updateSyncUI('offline');
    });

    if (!this.isOnline) {
      document.getElementById('offlineBanner')?.classList.add('active');
      document.body.classList.add('is-offline');
      this._updateSyncUI('offline');
    }
  }

  _setupSWMessages() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', async (event) => {
        if (event.data.type === 'SYNC_RECORDS') {
          await this.syncPending();
        }
      });
    }
  }

  _updateSyncUI(status) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    
    el.className = 'sync-status active ' + status;
    
    const icons = {
      syncing: '<i class="fas fa-sync"></i> Sincronizando...',
      synced: '<i class="fas fa-check-circle"></i> Sincronizado',
      offline: '<i class="fas fa-wifi-slash"></i> Offline'
    };
    
    el.innerHTML = icons[status] || icons.offline;
    
    if (status === 'synced') {
      setTimeout(() => el.classList.remove('active'), 3000);
    }
  }

  // Full sync: Firebase → IndexedDB
  async fullSync() {
    if (!this.firebaseReady || !this.isOnline) return;
    
    try {
      this._updateSyncUI('syncing');
      
      // Sync employees
      const empSnap = await this.firestore.collection('employees').get();
      const employees = empSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      await window.ptDB.bulkPut('employees', employees);
      
      // Sync records (most recent 200)
      const recSnap = await this.firestore.collection('records')
        .orderBy('timestamp', 'desc')
        .limit(200)
        .get();
      const records = recSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), syncStatus: 'synced' }));
      await window.ptDB.bulkPut('records', records);
      
      // Sync obras
      const obraSnap = await this.firestore.collection('obras').get();
      const obras = obraSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      await window.ptDB.bulkPut('obras', obras);

      // Sync servicos_campo
      const svcSnap = await this.firestore.collection('servicos_campo')
        .orderBy('timestamp', 'desc')
        .limit(100)
        .get();
      const svcs = svcSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      await window.ptDB.bulkPut('servicos_campo', svcs);
      
      // Sync settings
      const settingsDoc = await this.firestore.collection('settings').doc('config').get();
      if (settingsDoc.exists) {
        await window.ptDB.setSetting('config', settingsDoc.data());
      }
      
      // Sync pending local changes
      await this.syncPending();
      
      this._updateSyncUI('synced');
      console.log('[Sync] Sincronização completa realizada');
    } catch (error) {
      console.error('[Sync] Erro na sincronização completa:', error);
      this._updateSyncUI('offline');
    }
  }

  // Sync pending local changes → Firebase
  async syncPending() {
    if (!this.firebaseReady || !this.isOnline || this.isSyncing) return;
    
    this.isSyncing = true;
    try {
      const queue = await window.ptDB.getSyncQueue();
      let synced = 0;
      
      for (const item of queue) {
        try {
          if (item.action === 'create' || item.action === 'update') {
            await this.firestore.collection(item.collection)
              .doc(item.docId)
              .set(item.data, { merge: true });
          } else if (item.action === 'delete') {
            await this.firestore.collection(item.collection)
              .doc(item.docId)
              .delete();
          }
          
          await window.ptDB.removeSyncItem(item.id);
          synced++;
          
          // Update record sync status
          if (item.collection === 'records' && item.action !== 'delete') {
            const record = await window.ptDB.get('records', item.docId);
            if (record) {
              record.syncStatus = 'synced';
              await window.ptDB.put('records', record);
            }
          }
        } catch (error) {
          console.error(`[Sync] Erro ao sincronizar item ${item.id}:`, error);
          // Incrementar retries
          item.retries = (item.retries || 0) + 1;
          if (item.retries > 5) {
            await window.ptDB.removeSyncItem(item.id);
            await window.ptDB.logConflict(item, null, 'max_retries_exceeded');
          } else {
            await window.ptDB.put('syncQueue', item);
          }
        }
      }
      
      if (synced > 0) {
        window.app?.showToast(`${synced} registro(s) sincronizado(s)!`, 'success');
      }
      
      // Request background sync if available
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('sync-records').catch(() => {});
      }
    } catch (error) {
      console.error('[Sync] Erro na sincronização pendente:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  // Save with automatic sync queue
  async save(collection, id, data, action = 'update') {
    // Always save locally first
    await window.ptDB.put(collection, data);
    
    // Try to save to Firebase
    if (this.firebaseReady && this.isOnline) {
      try {
        const cleanData = { ...data };
        // Remove photo data from Firebase (too large)
        if (cleanData.photo && cleanData.photo.length > 1000) {
          cleanData.photoSaved = true;
          delete cleanData.photo;
        }
        await this.firestore.collection(collection).doc(id).set(cleanData, { merge: true });
        return true;
      } catch (error) {
        console.error(`[Sync] Falha ao salvar no Firebase, adicionando à fila:`, error);
        const queueData = { ...data };
        if (queueData.photo) delete queueData.photo; // Don't queue photos
        await window.ptDB.addToSyncQueue(collection, id, action, queueData);
        return false;
      }
    } else {
      // Add to sync queue
      const queueData = { ...data };
      if (queueData.photo) delete queueData.photo;
      await window.ptDB.addToSyncQueue(collection, id, action, queueData);
      return false;
    }
  }

  async remove(collection, id) {
    await window.ptDB.delete(collection, id);
    
    if (this.firebaseReady && this.isOnline) {
      try {
        await this.firestore.collection(collection).doc(id).delete();
      } catch {
        await window.ptDB.addToSyncQueue(collection, id, 'delete', null);
      }
    } else {
      await window.ptDB.addToSyncQueue(collection, id, 'delete', null);
    }
  }

  _setupRealtimeListeners() {
    if (!this.firebaseReady) return;

    // Listen for employee changes
    const unsub1 = this.firestore.collection('employees')
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
          const data = { id: change.doc.id, ...change.doc.data() };
          if (change.type === 'added' || change.type === 'modified') {
            await window.ptDB.put('employees', data);
          } else if (change.type === 'removed') {
            await window.ptDB.delete('employees', data.id).catch(() => {});
          }
        });
        window.app?.onDataChange?.('employees');
      }, err => console.error('[Sync] Listener employees error:', err));

    // Listen for record changes
    const unsub2 = this.firestore.collection('records')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
          const data = { id: change.doc.id, ...change.doc.data(), syncStatus: 'synced' };
          if (change.type === 'added' || change.type === 'modified') {
            await window.ptDB.put('records', data);
          } else if (change.type === 'removed') {
            await window.ptDB.delete('records', data.id).catch(() => {});
          }
        });
        window.app?.onDataChange?.('records');
      }, err => console.error('[Sync] Listener records error:', err));

    // Listen for service changes
    const unsub3 = this.firestore.collection('servicos_campo')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
          const data = { id: change.doc.id, ...change.doc.data() };
          if (change.type === 'added' || change.type === 'modified') {
            await window.ptDB.put('servicos_campo', data);
          } else if (change.type === 'removed') {
            await window.ptDB.delete('servicos_campo', data.id).catch(() => {});
          }
        });
        window.app?.onDataChange?.('servicos_campo');
      }, err => console.error('[Sync] Listener services error:', err));

    this.unsubscribers.push(unsub1, unsub2, unsub3);
  }

  destroy() {
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
  }
}

window.syncManager = new SyncManager();
