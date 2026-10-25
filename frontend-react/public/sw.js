/* Service Worker آفاق (نسخهٔ React) — پورت وفادار از public/sw.js سامانهٔ فعلی
 * با تنظیم مسیرها برای SPA جدید (پیشوند /app).
 *
 * سیاستِ کش عمداً محافظه‌کارانه است چون این یک سامانهٔ ورودمحور است:
 *  - ناوبری (HTML): network-first؛ فقط اگر شبکه قطع بود صفحهٔ آفلاین نمایش داده می‌شود.
 *    هیچ HTMLِ محافظت‌شده‌ای کش نمی‌شود تا دادهٔ کهنه/نشستِ منقضی نشان داده نشود.
 *  - دارایی‌های ایستا (/app/assets، /fonts، /icons): cache-first (نسخه‌دار و امن).
 *  - درخواست‌های API هرگز کش نمی‌شوند.
 */
const CACHE = 'afagh-spa-static-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([OFFLINE])).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }

  if (
    url.pathname.startsWith('/app/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/icons/')
  ) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        });
      })
    );
  }
});
