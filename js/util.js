// Shared helpers: tile maths, geodesy, formatting (miles, feet), small DOM helpers.
// Units are the operator's: miles, feet. Metres appear only inside calculations.

export const EARTH_M = 6378137;
const MAX_LAT = 85.05112878;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---- Web Mercator tiles -------------------------------------------------
export function lon2tile(lon, z) { return Math.floor(((lon + 180) / 360) * 2 ** z); }
export function lat2tile(lat, z) {
  const r = (clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}
export function tile2lon(x, z) { return (x / 2 ** z) * 360 - 180; }
export function tile2lat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
// [west, south, east, north]
export function tileBounds(z, x, y) {
  return [tile2lon(x, z), tile2lat(y + 1, z), tile2lon(x + 1, z), tile2lat(y, z)];
}
export function tilesInBounds(bounds, z) {
  const [w, s, e, n] = bounds;
  const x0 = lon2tile(w, z), x1 = lon2tile(e, z), y0 = lat2tile(n, z), y1 = lat2tile(s, z);
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  return out;
}
export function countTiles(bounds, z0, z1) {
  let n = 0;
  for (let z = z0; z <= z1; z++) {
    const [w, s, e, no] = bounds;
    n += (lon2tile(e, z) - lon2tile(w, z) + 1) * (lat2tile(s, z) - lat2tile(no, z) + 1);
  }
  return n;
}
export function lonLatToMeters(lon, lat) {
  const x = (lon * 20037508.342789244) / 180;
  let y = Math.log(Math.tan(((90 + clamp(lat, -MAX_LAT, MAX_LAT)) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.342789244) / 180;
  return [x, y];
}
// Size of one pixel in degrees of longitude at a zoom (for maxAllowableOffset).
export function degPerPixel(z) { return 360 / (256 * 2 ** z); }

// ---- geodesy ------------------------------------------------------------
export function haversineM(a, b) {
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b[1] - a[1]), dLon = toR(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[1])) * Math.cos(toR(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(s));
}
export function lineLengthM(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversineM(coords[i - 1], coords[i]);
  return d;
}
// Point moved by a bearing (deg) and distance (m) - used for the GPS accuracy circle.
export function destination([lon, lat], bearingDeg, distM) {
  const toR = (d) => (d * Math.PI) / 180, toD = (r) => (r * 180) / Math.PI;
  const br = toR(bearingDeg), la1 = toR(lat), lo1 = toR(lon), ad = distM / EARTH_M;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(ad) + Math.cos(la1) * Math.sin(ad) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(ad) * Math.cos(la1), Math.cos(ad) - Math.sin(la1) * Math.sin(la2));
  return [toD(lo2), toD(la2)];
}
export function circlePolygon(center, radiusM, n = 48) {
  const ring = [];
  for (let i = 0; i <= n; i++) ring.push(destination(center, (360 * i) / n, radiusM));
  return { type: 'Polygon', coordinates: [ring] };
}
export function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const hit = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}
export function pointInPolygon(pt, rings) {
  if (!rings.length || !pointInRing(pt, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(pt, rings[i])) return false;
  return true;
}
export function pointInFeature(pt, feature) {
  const g = feature.geometry;
  if (!g) return false;
  if (g.type === 'Polygon') return pointInPolygon(pt, g.coordinates);
  if (g.type === 'MultiPolygon') return g.coordinates.some((p) => pointInPolygon(pt, p));
  return false;
}
export function bboxOfCoords(coords) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}

// ---- formatting (operator's units) --------------------------------------
export const M_TO_FT = 3.28084;
export const M_TO_MI = 0.000621371;
export function fmtFeet(m) { return `${Math.round(m * M_TO_FT).toLocaleString()} ft`; }
export function fmtMiles(m) {
  const mi = m * M_TO_MI;
  if (mi < 0.1) return `${Math.round(m * M_TO_FT).toLocaleString()} ft`;
  return `${mi.toFixed(mi < 10 ? 2 : 1)} mi`;
}
export function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
}
export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
export function fmtCoord(lng, lat) { return `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
export function timeBucket(ms) { return Math.floor(Date.now() / ms); }

// ---- DOM ----------------------------------------------------------------
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function withTimeout(promise, ms, label = 'request') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
export function downloadText(name, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
