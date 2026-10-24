// Feature layers without vector tiles (mining claims, MRDS, PBDB, fire perimeters) are fetched per "data tile"
// at one fixed zoom, generalized for that zoom, only for the tiles in view and only above a minimum zoom.
// Each tile fetch has its own AbortController; tiles that leave the view are aborted. Results go to a GeoJSON
// source (clustered for records) and to the IndexedDB feature cache (LRU, see cachebudget.js).
import { DATA, URLS, LIVE_TTL } from './config.js';
import { tilesInBounds, tileBounds, degPerPixel, lon2tile, lat2tile, pointInFeature } from './util.js';
import { features as featDB } from './db.js';

const DAY = 864e5;

export class DataLayer {
  constructor({ id, z, minzoom, source, fetcher, ttl = 30 * DAY, keep = 64 }) {
    Object.assign(this, { id, z, minzoom, source, fetcher, ttl, keep });
    this.tiles = new Map(); this.inflight = new Map();
    this.enabled = false; this.count = 0; this.fetchedAt = null; this.lastError = null;
  }
  key(z, x, y) { return `${z}/${x}/${y}`; }
  dbKey(key) { return `${this.id}:${key}`; }
  visibleKeys(map) {
    if (map.getZoom() < this.minzoom) return [];
    const b = map.getBounds();
    return tilesInBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], this.z).map(([z, x, y]) => this.key(z, x, y));
  }
  setEnabled(map, on) { this.enabled = on; if (!on) { this.abortAll(); this.render(map, []); } else this.update(map); }
  abortAll() { for (const c of this.inflight.values()) c.abort(); this.inflight.clear(); }
  async update(map) {
    if (!this.enabled) return;
    const keys = this.visibleKeys(map);
    for (const [k, c] of this.inflight) if (!keys.includes(k)) { c.abort(); this.inflight.delete(k); }
    const need = keys.filter((k) => !this.tiles.has(k) && !this.inflight.has(k));
    if (need.length) await Promise.all(need.map((k) => this.load(k)));
    if (this.enabled) this.render(map, this.visibleKeys(map));
  }
  async load(key) {
    const ctrl = new AbortController();
    this.inflight.set(key, ctrl);
    let cached = null;
    try {
      cached = await featDB.get(this.dbKey(key));
      const fresh = cached && Date.now() - cached.t < this.ttl;
      if (cached && (fresh || !navigator.onLine)) {
        this.tiles.set(key, cached.features);
        if (Date.now() - (cached.used || 0) > 600e3) featDB.put({ ...cached, used: Date.now() }).catch(() => {});
        return;
      }
      const [z, x, y] = key.split('/').map(Number);
      const feats = await this.fetcher(tileBounds(z, x, y), z, ctrl.signal);
      if (ctrl.signal.aborted) return;
      this.tiles.set(key, feats);
      this.fetchedAt = Date.now(); this.lastError = null;
      const bytes = JSON.stringify(feats).length;
      await featDB.put({ key: this.dbKey(key), layer: this.id, features: feats, bytes, t: Date.now(), used: Date.now(), areas: cached?.areas || [] });
    } catch (e) {
      if (e.name !== 'AbortError') { this.lastError = e.message; if (cached) this.tiles.set(key, cached.features); }
    } finally {
      this.inflight.delete(key);
      while (this.tiles.size > this.keep) this.tiles.delete(this.tiles.keys().next().value);
    }
  }
  render(map, keys) {
    if (!this.source) return;
    const seen = new Set(), out = [];
    for (const k of keys) {
      const fs = this.tiles.get(k); if (!fs) continue;
      for (const f of fs) { const id = f.properties?._id ?? f.id; if (id != null) { if (seen.has(id)) continue; seen.add(id); } out.push(f); }
    }
    const src = map.getSource(this.source);
    if (src) src.setData({ type: 'FeatureCollection', features: out });
    this.count = out.length;
  }
  // Features containing a point, from memory or the IndexedDB cache (works offline for downloaded areas).
  async featuresAt([lng, lat]) {
    const key = this.key(this.z, lon2tile(lng, this.z), lat2tile(lat, this.z));
    const fs = this.tiles.get(key) || (await featDB.get(this.dbKey(key)))?.features || [];
    return fs.filter((f) => pointInFeature([lng, lat], f));
  }
  // Used by offline downloads: fetch one data tile and pin it to an area.
  async downloadTile([z, x, y], areaId, signal) {
    const key = this.key(z, x, y), dbKey = this.dbKey(key);
    const have = await featDB.get(dbKey);
    const feats = have && Date.now() - have.t < this.ttl ? have.features : await this.fetcher(tileBounds(z, x, y), z, signal);
    const areas = have?.areas || [];
    if (!areas.includes(areaId)) areas.push(areaId);
    const bytes = JSON.stringify(feats).length;
    await featDB.put({ key: dbKey, layer: this.id, features: feats, bytes, t: have?.t || Date.now(), used: Date.now(), areas });
    return bytes;
  }
}

// ---- fetchers ------------------------------------------------------------
export async function arcgisQuery(url, params, signal) {
  const qs = new URLSearchParams({ f: 'geojson', ...params });
  const res = await fetch(`${url}?${qs}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'ArcGIS error');
  return j;
}
// Envelope query, generalized for the zoom, paged while the server reports exceededTransferLimit.
export async function arcgisTileQuery(url, bounds, z, outFields, signal, { idField = 'OBJECTID', maxPages = 3, pageSize = 2000, offsetZoom = 2, extra = {} } = {}) {
  const [w, s, e, n] = bounds;
  const feats = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const j = await arcgisQuery(url, {
      where: '1=1', geometry: `${w},${s},${e},${n}`, geometryType: 'esriGeometryEnvelope', inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects', outFields, returnGeometry: true, outSR: 4326, geometryPrecision: 5,
      maxAllowableOffset: degPerPixel(z + offsetZoom), resultOffset: offset, resultRecordCount: pageSize, ...extra,
    }, signal);
    for (const f of j.features) { f.properties._id = f.id ?? f.properties[idField]; feats.push(f); }
    if (!j.properties?.exceededTransferLimit || !j.features.length) break;
    offset += j.features.length;
  }
  return feats;
}
const CLAIM_FIELDS = 'CSE_NAME,CSE_NR,CSE_TYPE_NR,CSE_DISP,RCRD_ACRS,Modified';
async function pbdbFetch(bounds, z, signal) {
  const [w, s, e, n] = bounds;
  const qs = new URLSearchParams({ lngmin: w, lngmax: e, latmin: s, latmax: n, show: 'coords,strat', limit: 2000 });
  const res = await fetch(`${URLS.pbdb}?${qs}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return (j.records || []).map((r) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [+r.lng, +r.lat] },
    properties: { _id: r.oid, name: r.idn || r.tna || 'Fossil occurrence', taxon: r.tna, interval: r.oei, eag: r.eag, lag: r.lag, formation: r.sfm, member: r.smb, cid: r.cid, oid: r.oid },
  }));
}

export function makeLayers() {
  return {
    claimsOpen: new DataLayer({ id: 'claimsOpen', ...DATA.claims, source: 'claims-open', fetcher: (b, z, s) => arcgisTileQuery(URLS.claimsOpen, b, z, CLAIM_FIELDS, s) }),
    claimsClosed: new DataLayer({ id: 'claimsClosed', ...DATA.claims, source: 'claims-closed', fetcher: (b, z, s) => arcgisTileQuery(URLS.claimsClosed, b, z, CLAIM_FIELDS, s) }),
    mrds: new DataLayer({ id: 'mrds', ...DATA.records, source: 'mrds', fetcher: (b, z, s) => arcgisTileQuery(URLS.mrds, b, z, 'DEP_ID,SITE_NAME,DEV_STAT,URL,CODE_LIST,Grade', s, { pageSize: 2000, maxPages: 2 }) }),
    pbdb: new DataLayer({ id: 'pbdb', ...DATA.records, source: 'pbdb', fetcher: pbdbFetch }),
    fire: new DataLayer({ id: 'fire', ...DATA.fire, source: 'fire', ttl: LIVE_TTL.fire, fetcher: (b, z, s) => arcgisTileQuery(URLS.nifc, b, z, 'poly_IncidentName,attr_IncidentSize,attr_PercentContained,attr_FireDiscoveryDateTime,poly_DateCurrent,attr_FireCause', s, { offsetZoom: 6, maxPages: 1 }) }),
    padusUnits: new DataLayer({ id: 'padusUnits', ...DATA.padusUnits, source: null, fetcher: (b, z, s) => arcgisTileQuery(URLS.padusQuery, b, z, 'Mang_Type,Mang_Name,Unit_Nm,Loc_Mang,Pub_Access,GAP_Sts,Des_Tp,State_Nm', s, { pageSize: 1000, maxPages: 4 }) }),
  };
}
