// ============================================================
// PontoTrack - Service Worker v3.0
// Estratégia: Cache First + Network Fallback para assets
//             Network First + Cache Fallback para API/dados
// ============================================================

const CACHE_NAME = 'pontotrack-v3.2';
const STATIC_CACHE = 'pontotrack-static-v3.2';
const DYNAMIC_CACHE = 'pontotrack-dynamic-v3.2';

// Assets que devem ser cacheados na instalação
const STATIC_ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/geo.js',
  'js/reports.js',
  'js/sync.js',
  'js/i18n.js',
  'js/notifications.js',
  'js/admin-edit.js',
  'manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js'
];

// Instalar Service Worker
self.addEventListener('install', event => {
  console.log('[SW] Instalando Service Worker v3.1...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Cacheando assets estáticos...');
        return cache.addAll(STATIC_ASSETS).catch(err => {
          console.warn('[SW] Falha ao cachear alguns assets:', err);
          // Cache what we can
          return Promise.allSettled(
            STATIC_ASSETS.map(url => cache.add(url).catch(() => console.warn('[SW] Falha:', url)))
          );
        });
      })
      .then(() => self.skipWaiting())
  );
});

// Ativar Service Worker
self.addEventListener('activate', event => {
  console.log('[SW] Ativando Service Worker v3.1...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
          .map(name => {
            console.log('[SW] Removendo cache antigo:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptar requisições
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requisições não-GET e Firebase
  if (request.method !== 'GET') return;
  if (url.hostname.includes('firebasestorage') ||
    url.hostname.includes('googleapis.com/identitytoolkit') ||
    url.hostname.includes('firestore.googleapis.com')) {
    return;
  }

  // Estratégia: Cache First para assets estáticos
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Estratégia: Network First para conteúdo dinâmico
  event.respondWith(networkFirst(request));
});

// Cache First Strategy
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// Network First Strategy
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Fallback para página offline
    if (request.headers.get('accept')?.includes('text/html')) {
      const offlineCache = await caches.match('index.html') || await caches.match('./');
      if (offlineCache) return offlineCache;
    }

    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

function isStaticAsset(url) {
  const staticExts = ['.css', '.js', '.png', '.jpg', '.jpeg', '.svg', '.woff', '.woff2', '.ttf', '.eot'];
  return staticExts.some(ext => url.pathname.endsWith(ext)) ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'unpkg.com';
}

// Background Sync
self.addEventListener('sync', event => {
  if (event.tag === 'sync-records') {
    event.waitUntil(syncPendingRecords());
  }
});

async function syncPendingRecords() {
  // Comunicar com a página para sincronizar
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_RECORDS' });
  });
}

// Push Notifications
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};

  const options = {
    body: data.body || 'Você tem uma nova notificação',
    icon: 'icons/icon-192x192.png',
    badge: 'icons/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: data.url || './',
    actions: [
      { action: 'open', title: 'Abrir' },
      { action: 'close', title: 'Fechar' }
    ],
    tag: data.tag || 'pontotrack-notification'
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'PontoTrack', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'close') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url === event.notification.data && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(event.notification.data);
      }
    })
  );
});

// Periodic Background Sync (for reminders)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-reminders') {
    event.waitUntil(checkReminders());
  }
});

async function checkReminders() {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'CHECK_REMINDERS' });
  });
}
