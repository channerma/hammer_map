// Service worker: the app shell (stale-while-revalidate) and every map tile (cache-first with network fallback).
// Tile bytes are recorded in IndexedDB (hammermap-cache.tiles) so the page can keep the cache under its budget.
// Feature queries (ArcGIS, PBDB) are not cached here: the page keeps those in its own IndexedDB feature cache.
const VERSION = 'v3';
const SHELL = `hm-shell-${VERSION}`;
const TILES = 'hm-tiles-v1';
const MAPLIBRE = ['https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.js', 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.css'];
const SHELL_FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'rules.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/config.js', 'js/basemaps.js', 'js/keys.js', 'js/util.js', 'js/db.js', 'js/cachebudget.js', 'js/terrain.js', 'js/style.js', 'js/features.js', 'js/map.js',
  'js/collect.js', 'js/pins.js', 'js/draw.js', 'js/io.js', 'js/offline.js', 'js/ui.js', 'js/panels.js', 'workers/parse.js', ...MAPLIBRE];
const TILE_HOSTS = ['basemap.nationalmap.gov', 's3.amazonaws.com', 'tiles.openfreemap.org', 'tiles.arcgis.com', 'gis.blm.gov', 'mapservices.weather.noaa.gov'];

function isTile(url) {
  if (!TILE_HOSTS.includes(url.hostname)) return false;
  if (url.hostname === 's3.amazonaws.com') return url.pathname.startsWith('/elevation-tiles-prod/');
  if (url.hostname === 'tiles.arcgis.com') return url.pathname.includes('/VectorTileServer/tile/');
  if (url.hostname === 'gis.blm.gov' || url.hostname === 'mapservices.weather.noaa.gov') return url.pathname.endsWith('/export');
  if (url.hostname === 'tiles.openfreemap.org') return url.pathname.startsWith('/planet/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/sprites/');
  return true; // USGS basemap tiles
}
// OpenFreeMap style and TileJSON change weekly: network first, cache as the offline fallback.
const isOfmMeta = (url) => url.hostname === 'tiles.openfreemap.org' && (url.pathname.startsWith('/styles/') || url.pathname === '/planet');

// ---- tile accounting in IndexedDB --------------------------------------
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open('hammermap-cache', 1);
    req.onupgradeneeded = () => { const s = req.result.createObjectStore('tiles', { keyPath: 'url' }); s.createIndex('t', 't'); s.createIndex('areas', 'areas', { multiEntry: true }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function upsert(url, bytes) {
  try {
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction('tiles', 'readwrite'), s = tx.objectStore('tiles');
      const g = s.get(url);
      g.onsuccess = () => { const rec = g.result || { url, bytes, t: Date.now(), areas: [] }; rec.bytes = bytes; rec.t = Date.now(); s.put(rec); };
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } catch { /* accounting is best effort */ }
}
const touched = new Map();
async function touch(url) {
  const now = Date.now();
  if (now - (touched.get(url) || 0) < 600e3) return;
  touched.set(url, now);
  if (touched.size > 5000) touched.clear();
  try {
    const d = await db();
    await new Promise((resolve) => {
      const tx = d.transaction('tiles', 'readwrite'), s = tx.objectStore('tiles');
      const g = s.get(url);
      g.onsuccess = () => { if (g.result) { g.result.t = now; s.put(g.result); } };
      tx.oncomplete = resolve; tx.onerror = resolve;
    });
  } catch { /* ignore */ }
}

// ---- handlers --------------------------------------------------------------
async function tileHandler(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req.url);
  if (hit) { touch(req.url); return hit; }
  try {
    const res = await fetch(req);
    if (res.ok) {
      const buf = await res.clone().arrayBuffer();
      await cache.put(req.url, new Response(buf, { status: 200, headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream', 'content-length': String(buf.byteLength) } }));
      upsert(req.url, buf.byteLength);
    }
    return res;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'offline, tile not cached' });
  }
}
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try { const res = await fetch(req); if (res.ok) cache.put(req.url, res.clone()); return res; }
  catch { return (await cache.match(req.url)) || new Response('', { status: 504 }); }
}
async function shellHandler(req) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(req, { ignoreSearch: true });
  const refresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  if (cached) { refresh.catch(() => {}); return cached; }
  const res = await refresh;
  return res || new Response('offline', { status: 504 });
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map(async (f) => { try { await cache.add(new Request(f, { mode: f.startsWith('http') ? 'cors' : 'same-origin' })); } catch { /* keep going */ } }));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== TILES) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isOfmMeta(url)) { e.respondWith(networkFirst(req)); return; }
  if (isTile(url)) { e.respondWith(tileHandler(req)); return; }
  if (url.origin === self.location.origin || MAPLIBRE.includes(req.url)) { e.respondWith(shellHandler(req)); return; }
  // Everything else (feature queries, PBDB, custom layers added by URL, the online-only basemaps of js/basemaps.js)
  // goes to the network.
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
