// Elevation from AWS Terrain Tiles (terrarium PNG). Decoded on a canvas, cached in memory (small LRU).
// height_m = R * 256 + G + B / 256 - 32768
import { URLS } from './config.js';
import { lon2tile, lat2tile, haversineM, M_TO_FT } from './util.js';

const PROFILE_ZOOM = 13; // about 15 m per pixel at mid latitudes
const MAX_TILES = 32;
const cache = new Map();

async function loadTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  const url = URLS.terrain.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`terrain tile ${key}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const tile = { data, size: c.width };
  cache.set(key, tile);
  if (cache.size > MAX_TILES) cache.delete(cache.keys().next().value);
  return tile;
}

export function decodeTerrarium(r, g, b) { return r * 256 + g + b / 256 - 32768; }

export async function elevationM(lon, lat, z = PROFILE_ZOOM) {
  const n = 2 ** z;
  const fx = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  const tile = await loadTile(z, x, y);
  const px = Math.min(tile.size - 1, Math.floor((fx - x) * tile.size));
  const py = Math.min(tile.size - 1, Math.floor((fy - y) * tile.size));
  const i = (py * tile.size + px) * 4;
  return decodeTerrarium(tile.data[i], tile.data[i + 1], tile.data[i + 2]);
}

// Sample a line every `stepM` metres (capped at maxSamples) and compute the profile in feet/miles.
export async function profile(coords, { stepM = 30, maxSamples = 400, onProgress } = {}) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) { const d = haversineM(coords[i - 1], coords[i]); segs.push(d); total += d; }
  const n = Math.max(2, Math.min(maxSamples, Math.ceil(total / stepM) + 1));
  const samples = [];
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    let acc = 0, i = 0;
    while (i < segs.length && acc + segs[i] < target) { acc += segs[i]; i++; }
    const a = coords[Math.min(i, coords.length - 1)], b = coords[Math.min(i + 1, coords.length - 1)];
    const f = segs[i] ? (target - acc) / segs[i] : 0;
    const pt = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    let elev = null;
    try { elev = await elevationM(pt[0], pt[1]); } catch { /* tile missing (offline) */ }
    samples.push({ dM: target, elevM: elev, pt });
    if (onProgress) onProgress(k + 1, n);
  }
  // Light smoothing (3-sample mean) before counting climb and descent, to soften pixel noise.
  const e = samples.map((s) => s.elevM);
  const sm = e.map((v, i) => {
    const win = [e[i - 1], v, e[i + 1]].filter((x) => x != null);
    return win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
  });
  let climb = 0, descent = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < sm.length; i++) {
    if (sm[i] == null) continue;
    min = Math.min(min, sm[i]); max = Math.max(max, sm[i]);
    if (i > 0 && sm[i - 1] != null) { const d = sm[i] - sm[i - 1]; if (d > 0) climb += d; else descent -= d; }
  }
  const have = sm.some((v) => v != null);
  return {
    samples: samples.map((s, i) => ({ dM: s.dM, elevM: sm[i] })),
    totalM: total, climbM: have ? climb : null, descentM: have ? descent : null,
    minM: have ? min : null, maxM: have ? max : null, complete: sm.every((v) => v != null),
  };
}

// Draw the profile on a canvas (distance in miles, elevation in feet).
export function drawProfile(canvas, prof, theme) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 320, H = canvas.clientHeight || 160;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const fg = theme === 'dark' ? '#e8efe9' : '#14261b', line = '#c2410c', fill = theme === 'dark' ? 'rgba(194,65,12,0.35)' : 'rgba(194,65,12,0.25)';
  ctx.clearRect(0, 0, W, H);
  const pad = { l: 46, r: 10, t: 10, b: 24 };
  const pts = prof.samples.filter((s) => s.elevM != null);
  ctx.fillStyle = fg; ctx.font = '12px system-ui, sans-serif';
  if (pts.length < 2) { ctx.fillText('No elevation data (terrain tiles not available offline)', pad.l, H / 2); return; }
  const minFt = Math.floor((prof.minM * M_TO_FT) / 100) * 100, maxFt = Math.ceil((prof.maxM * M_TO_FT) / 100) * 100 || minFt + 100;
  const totalMi = prof.totalM * 0.000621371;
  const x = (dM) => pad.l + ((dM * 0.000621371) / (totalMi || 1)) * (W - pad.l - pad.r);
  const y = (m) => pad.t + (1 - (m * M_TO_FT - minFt) / (maxFt - minFt || 1)) * (H - pad.t - pad.b);
  // grid + labels
  ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const ft = minFt + ((maxFt - minFt) * i) / 4, yy = y(ft / M_TO_FT);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
    ctx.fillText(`${Math.round(ft).toLocaleString()}`, 2, yy + 4);
  }
  for (let i = 0; i <= 4; i++) {
    const mi = (totalMi * i) / 4;
    ctx.fillText(`${mi.toFixed(totalMi < 2 ? 2 : 1)} mi`, x(mi / 0.000621371) - 14, H - 6);
  }
  // area + line
  ctx.beginPath();
  ctx.moveTo(x(pts[0].dM), y(pts[0].elevM));
  pts.forEach((p) => ctx.lineTo(x(p.dM), y(p.elevM)));
  ctx.lineTo(x(pts[pts.length - 1].dM), H - pad.b); ctx.lineTo(x(pts[0].dM), H - pad.b); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.beginPath(); ctx.strokeStyle = line; ctx.lineWidth = 2;
  pts.forEach((p, i) => (i ? ctx.lineTo(x(p.dM), y(p.elevM)) : ctx.moveTo(x(p.dM), y(p.elevM))));
  ctx.stroke();
}
