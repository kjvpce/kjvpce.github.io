// 離線支援：存下 app 本身（經文資料檔由 app 存在 IndexedDB）
const VERSION = 'k8';
const SHELL = 'shell-' + VERSION;
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'books.js', 'poj.js', 'picker.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin && /^\/audio-(ot|nt)\//.test(url.pathname)) {
    if (url.pathname.endsWith('.m4a')) {
      // Fable 朗讀：有下載過就用存檔（支援從中間開始播），沒有就走網路
      e.respondWith(caches.open('fable-v1').then(c => c.match(url.href)).then(async hit => {
        if (!hit) return fetch(e.request);
        const range = e.request.headers.get('range');
        if (!range) return hit;
        const buf = await hit.arrayBuffer();
        const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
        const total = buf.byteLength;
        const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], total - 1) : total - 1;
        return new Response(buf.slice(start, end + 1), { status: 206, headers: {
          'Content-Type': 'audio/mp4', 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
      }));
    }
    return;   // 時間表 json 由 app 自己存，直接走網路
  }
  if (url.origin === location.origin) {
    // app 本身：先用網路，並且不用瀏覽器暫存（一上傳新版就拿得到），沒網路才用存檔
    e.respondWith(fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(SHELL).then(c => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  // 真人錄音之後再加
});
