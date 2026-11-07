/* ==========================================================================
   小櫻讀書計劃表 🌸 Service Worker (PWA 離線快取與加速服務)
   ========================================================================== */

const CACHE_NAME = 'sakura-study-v1.2.0';
const STATIC_ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
];

// 安裝時快取靜態資源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Cache addAll warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// 啟動時清除舊快取版本
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 擷取請求策略：
// 1. 即時推播請求 (ntfy.sh) -> 永遠走網路 (不快取)
// 2. 本地資源 -> 網路優先（若有更新立刻套用），網路失敗則回傳快取（保證離線可用）
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ntfy.sh 實時頻道直接走網路
  if (url.hostname.includes('ntfy.sh')) {
    return;
  }

  // 靜態檔案：Stale-While-Revalidate 策略
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
