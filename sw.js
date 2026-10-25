// Pi Lab service worker: offline app shell + Python runtime cache, and cross-origin isolation headers
// (COOP/COEP) on every response so Python's shared memory works on any static host, including sub-paths.
const VERSION = 'd2d1652d2400';
const SHELL = ["", "icon.svg", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "js/app.js", "js/audio.js", "js/boot.js", "js/bus.js", "js/catalog.js", "js/chips.js", "js/devices.js", "js/examples.js", "js/geom.js", "js/i2cchips.js", "js/pi.js", "js/py-worker.js", "js/pybridge.js", "js/pyshims.js", "js/render.js", "js/sim.js", "js/solver.js", "manifest.webmanifest", "styles.css"];
const PYODIDE = ["pyodide/pyodide-lock.json", "pyodide/pyodide.asm.js", "pyodide/pyodide.asm.wasm", "pyodide/pyodide.js", "pyodide/python_stdlib.zip"];
const CACHE = 'pilab-' + VERSION;
const scopeURL = new URL('./', self.location).href;
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL.map((p) => new Request(scopeURL + p, { cache: 'reload' })));
    // Python (~12 MB) is cached in the background so installing stays quick on slow connections.
    c.addAll(PYODIDE.map((p) => new Request(scopeURL + p, { cache: 'reload' }))).catch(() => {});
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('pilab-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(scopeURL)) return;
  if (req.mode === 'navigate') {
    // fresh page when online, cached app shell when offline
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res.ok && url.href.split(/[?#]/)[0] === scopeURL) c.put(scopeURL, res.clone());
        return isolate(res);
      } catch (err) {
        return isolate((await c.match(scopeURL)) || (await c.match(req)) || new Response('Offline and not cached yet', { status: 503 }));
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const key = url.href.split('#')[0];
    const hit = await c.match(key, { ignoreSearch: true });
    if (hit) return isolate(hit);
    try {
      const res = await fetch(req);
      if (res.ok && (url.pathname.includes('/pyodide/') || SHELL.some((p) => key === scopeURL + p))) c.put(key, res.clone());
      return isolate(res);
    } catch (err) {
      return new Response('Offline', { status: 503 });
    }
  })());
});
