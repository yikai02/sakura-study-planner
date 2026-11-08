/* ==========================================================================
   小櫻讀書計劃表 🌸 Service Worker (PWA 離線快取與加速服務)
   ========================================================================== */

const CACHE_NAME = 'sakura-study-v2.2.7';
const STATIC_ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

// 安裝時跳過等待立即啟用新版本
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Cache addAll warning:', err);
      });
    })
  );
});

// 啟動時立刻清除所有舊快取版本並立即接管所有頁面
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('🌸 Purging outdated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 擷取請求策略：
// 1. 即時推播請求 (ntfy.sh) -> 永遠走網路 (不快取)
// 2. 本地資源 -> 網路優先（Network-First）：連線正常時一律抓取最新雲端版本，離線斷網才退回快取
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ntfy.sh 實時頻道與動態雲端快照備份直接走網路，不寫入靜態快取
  if (url.hostname.includes('ntfy.sh') || url.pathname.includes('/data/') || url.pathname.includes('backup-latest.json')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
