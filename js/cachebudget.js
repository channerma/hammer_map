// What stays on the phone, and how much.
//   Persistent: the user's pins, lines, notes, photos, and tiles/features that belong to a downloaded area.
//   Cache:      every other tile and feature tile, kept under a budget (Settings) with least-recently-used eviction.
// Accounting lives in IndexedDB (hammermap-cache.tiles for Cache API entries, hammermap.features for feature tiles).

import { tiles, features, areas, photos, pins, lines, settings } from './db.js';
import { DEFAULTS, DEFAULT_TILE_BYTES } from './config.js';

export const TILE_CACHE = 'hm-tiles-v1';

export function sourceKeyOf(url) {
  if (url.includes('openfreemap.org/planet/')) return 'ofm';
  if (url.includes('openfreemap.org')) return 'ofmMeta';
  if (url.includes('basemap.nationalmap.gov')) return 'usgs';
  if (url.includes('elevation-tiles-prod')) return 'terrain';
  if (url.includes('PADUS_Management_Areas')) return 'padus';
  if (url.includes('West_US_SMA')) return 'smaWest';
  if (url.includes('BLM_Natl_SMA_Cached')) return 'smaRaster';
  if (url.includes('weather.noaa.gov')) return 'live';
  return 'other';
}

export async function capBytes() {
  const mb = await settings.get('cacheCapMB', DEFAULTS.cacheCapMB);
  return mb * 1024 * 1024;
}

// Mark cached tiles as belonging to an area (so eviction leaves them alone).
export async function pinTiles(urls, areaId, bytesByUrl) {
  for (const url of urls) {
    const rec = (await tiles.get(url)) || { url, bytes: bytesByUrl?.get(url) || 0, t: Date.now(), areas: [] };
    if (!rec.areas.includes(areaId)) rec.areas.push(areaId);
    if (bytesByUrl?.has(url)) rec.bytes = bytesByUrl.get(url);
    await tiles.put(rec);
  }
}
export async function unpinArea(areaId) {
  const cache = await caches.open(TILE_CACHE);
  const recs = await tiles.byArea(areaId);
  for (const rec of recs) {
    rec.areas = rec.areas.filter((a) => a !== areaId);
    if (rec.areas.length) await tiles.put(rec);
    else { await cache.delete(rec.url); await tiles.del(rec.url); }
  }
  const feats = await features.byArea(areaId);
  for (const f of feats) {
    f.areas = (f.areas || []).filter((a) => a !== areaId);
    if (f.areas.length) await features.put(f);
    else await features.del(f.key);
  }
}

// Running averages per source: Cache API tiles by host, feature tiles by layer ("data:<layer>").
export async function averageTileBytes() {
  const sums = {}, counts = {};
  const add = (k, b) => { sums[k] = (sums[k] || 0) + b; counts[k] = (counts[k] || 0) + 1; };
  for (const r of await tiles.all()) add(sourceKeyOf(r.url), r.bytes);
  for (const f of await features.all()) if (f.layer) add(`data:${f.layer}`, f.bytes || 0);
  const out = { ...DEFAULT_TILE_BYTES };
  for (const k of Object.keys(sums)) if (counts[k] >= (k.startsWith('data:') ? 2 : 5)) out[k] = Math.round(sums[k] / counts[k]);
  return out;
}

// Full accounting for the "Data on this phone" meter.
export async function report() {
  const [allTiles, allFeatures, allAreas, allPhotos, allPins, allLines] = await Promise.all([
    tiles.all(), features.all(), areas.all(), photos.all(), pins.all(), lines.all(),
  ]);
  let areaTileBytes = 0, cacheTileBytes = 0, areaFeatBytes = 0, cacheFeatBytes = 0;
  for (const t of allTiles) (t.areas?.length ? (areaTileBytes += t.bytes) : (cacheTileBytes += t.bytes));
  for (const f of allFeatures) (f.areas?.length ? (areaFeatBytes += f.bytes || 0) : (cacheFeatBytes += f.bytes || 0));
  const photoBytes = allPhotos.reduce((s, p) => s + (p.bytes || 0), 0);
  const userBytes = photoBytes + JSON.stringify(allPins).length + JSON.stringify(allLines).length;
  let estimate = null;
  try { if (navigator.storage?.estimate) estimate = await navigator.storage.estimate(); } catch { /* unsupported */ }
  const cap = await capBytes();
  return {
    cap, userBytes, photoBytes, pins: allPins.length, lines: allLines.length, photos: allPhotos.length,
    areas: allAreas.length, areaBytes: areaTileBytes + areaFeatBytes, cacheBytes: cacheTileBytes + cacheFeatBytes,
    tilesCached: allTiles.length, featureTiles: allFeatures.length, estimate,
    total: userBytes + areaTileBytes + areaFeatBytes + cacheTileBytes + cacheFeatBytes,
  };
}

// Evict least-recently-used browsed tiles and feature tiles until the budget holds.
// Area tiles and the user's own data are never evicted here.
export async function enforceBudget() {
  const r = await report();
  let over = r.total - r.cap;
  if (over <= 0) return { evicted: 0, bytes: 0 };
  const cache = await caches.open(TILE_CACHE);
  const candidates = [
    ...(await tiles.all()).filter((t) => !t.areas?.length).map((t) => ({ kind: 'tile', key: t.url, bytes: t.bytes, t: t.t })),
    ...(await features.all()).filter((f) => !f.areas?.length).map((f) => ({ kind: 'feat', key: f.key, bytes: f.bytes || 0, t: f.t })),
  ].sort((a, b) => a.t - b.t);
  let evicted = 0, bytes = 0;
  for (const c of candidates) {
    if (over <= 0) break;
    if (c.kind === 'tile') { await cache.delete(c.key); await tiles.del(c.key); }
    else await features.del(c.key);
    over -= c.bytes; bytes += c.bytes; evicted++;
  }
  return { evicted, bytes };
}

export async function clearBrowsedCache() {
  const cache = await caches.open(TILE_CACHE);
  const t = (await tiles.all()).filter((x) => !x.areas?.length);
  for (const rec of t) { await cache.delete(rec.url); }
  await tiles.delMany(t.map((x) => x.url));
  const f = (await features.all()).filter((x) => !x.areas?.length);
  await features.delMany(f.map((x) => x.key));
  return t.length + f.length;
}
