// Offline areas: estimate (tile count x measured average tile size), refuse over the budget, download with
// limited parallelism into the Cache API (tiles) and IndexedDB (feature tiles), pin them to the area so eviction
// leaves them alone, list and delete.
import { URLS, OFM_DOWNLOAD, DATA } from './config.js';
import { tilesInBounds, lonLatToMeters, fmtBytes, fmtDate, uid, esc, h, $, timeBucket } from './util.js';
import { areas as areaDB, settings } from './db.js';
import { pinTiles, unpinArea, averageTileBytes, report, capBytes } from './cachebudget.js';
import { openSheet, toast, formValues } from './ui.js';
import { extraBasemap } from './basemaps.js';

const Z_MIN = 8;
const EMPTY = { type: 'FeatureCollection', features: [] };

function tileUrl(template, [z, x, y]) {
  if (template.includes('{bbox-epsg-3857}')) {
    const [w, s] = lonLatToMeters(...tileToLonLat(x, y + 1, z)), [e, n] = lonLatToMeters(...tileToLonLat(x + 1, y, z));
    return template.replace('{bbox-epsg-3857}', `${w},${s},${e},${n}`);
  }
  return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}
function tileToLonLat(x, y, z) {
  const lon = (x / 2 ** z) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return [lon, (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))];
}

export class Offline {
  constructor({ map, layers, hasVector, getBasemap }) {
    Object.assign(this, { map, layers, hasVector, getBasemap });
    this.boxMode = false; this.boxPts = []; this.abort = null;
  }
  viewBounds() { const b = this.map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }
  // Sources to fetch for a plan, each with its tile list.
  async plan(bounds, opts) {
    const maxZ = +opts.maxZoom;
    const basemap = this.getBasemap();
    const ofmTemplate = await settings.get('ofmTemplate');
    const plans = [];
    if (opts.basemap && !extraBasemap(basemap)) { // the online-only basemaps of js/basemaps.js are never saved
      if (basemap === 'vector' && this.hasVector && ofmTemplate) plans.push({ key: 'ofm', label: 'Vector basemap (OpenFreeMap)', template: ofmTemplate, tiles: tilesRange(bounds, Z_MIN, Math.min(maxZ, 14)), parallel: OFM_DOWNLOAD.parallel });
      else plans.push({ key: 'usgs', label: `USGS ${basemap === 'vector' ? 'topo' : basemap} basemap`, template: URLS[{ topo: 'usgsTopo', imagery: 'usgsImagery', imagerytopo: 'usgsImageryTopo', vector: 'usgsTopo' }[basemap]], tiles: tilesRange(bounds, Z_MIN, maxZ) });
    }
    if (opts.terrain) plans.push({ key: 'terrain', label: 'Terrain (3D and profiles)', template: URLS.terrain, tiles: tilesRange(bounds, Z_MIN, Math.min(maxZ, 12)) });
    if (opts.ownership) {
      plans.push({ key: 'padus', label: 'PAD-US ownership tiles', template: URLS.padusTiles, tiles: tilesRange(bounds, Z_MIN, Math.min(maxZ, 14)) });
      plans.push({ key: 'smaWest', label: 'BLM SMA agency tiles (West)', template: URLS.smaWestTiles, tiles: tilesRange(bounds, Z_MIN, Math.min(maxZ, 13)) });
      plans.push({ key: 'data:padusUnits', label: 'PAD-US unit polygons (offline "Can I collect here?")', layer: this.layers.padusUnits, tiles: tilesInBounds(bounds, DATA.padusUnits.z) });
    }
    if (opts.claims) for (const k of ['claimsOpen', 'claimsClosed']) plans.push({ key: `data:${k}`, label: k === 'claimsOpen' ? 'Mining claims (open)' : 'Mining claims (closed, past year)', layer: this.layers[k], tiles: tilesInBounds(bounds, DATA.claims.z) });
    if (opts.records) for (const k of ['mrds', 'pbdb']) plans.push({ key: `data:${k}`, label: k === 'mrds' ? 'USGS MRDS records' : 'Paleobiology Database records', layer: this.layers[k], tiles: tilesInBounds(bounds, DATA.records.z) });
    return plans;
  }
  async estimate(plans) {
    const avg = await averageTileBytes();
    let tiles = 0, bytes = 0;
    const rows = plans.map((p) => { const per = avg[p.key] || (p.layer ? avg.data : 30000); const b = p.tiles.length * per; tiles += p.tiles.length; bytes += b; return { label: p.label, tiles: p.tiles.length, bytes: b, key: p.key }; });
    return { tiles, bytes, rows };
  }
  async download(name, bounds, plans, onProgress) {
    const areaId = uid();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const total = plans.reduce((s, p) => s + p.tiles.length, 0);
    let done = 0, bytes = 0, failed = 0;
    const urls = [], bytesByUrl = new Map();
    for (const p of plans) {
      const parallel = p.parallel || 6;
      const queue = [...p.tiles];
      const worker = async () => {
        while (queue.length && !signal.aborted) {
          const t = queue.shift();
          try {
            if (p.layer) bytes += await p.layer.downloadTile(t, areaId, signal);
            else {
              const url = tileUrl(p.template, t);
              const res = await fetch(url, { signal });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const n = (await res.arrayBuffer()).byteLength;
              urls.push(url); bytesByUrl.set(url, n); bytes += n;
            }
          } catch (e) { if (e.name === 'AbortError') return; failed++; }
          done++; onProgress({ done, total, bytes, failed, label: p.label });
        }
      };
      await Promise.all(Array.from({ length: parallel }, worker));
      if (signal.aborted) break;
    }
    if (signal.aborted) { await unpinArea(areaId); return null; }
    await pinTiles(urls, areaId, bytesByUrl);
    const area = { id: areaId, name, bounds, created: Date.now(), bytes, tiles: total - failed, failed, sources: plans.map((p) => p.label), ofmTemplate: plans.find((p) => p.key === 'ofm')?.template || null, urls };
    await areaDB.put(area);
    try { await navigator.storage?.persist?.(); } catch { /* optional */ }
    this.abort = null;
    return area;
  }
  async deleteArea(id) { await unpinArea(id); await areaDB.del(id); }

  // ---- box selection on the map --------------------------------------------
  startBox(onDone) { this.boxMode = true; this.boxPts = []; this.onBox = onDone; this.map.getCanvas().style.cursor = 'crosshair'; toast('Tap two opposite corners of the area'); }
  boxClick(lngLat) {
    this.boxPts.push([lngLat.lng, lngLat.lat]);
    if (this.boxPts.length === 2) {
      const [[x1, y1], [x2, y2]] = this.boxPts;
      const bounds = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
      this.showBox(bounds); this.boxMode = false; this.map.getCanvas().style.cursor = '';
      this.onBox(bounds);
    }
  }
  showBox(bounds) {
    const [w, s, e, n] = bounds || []; // null clears the box (the sheet's close)
    this.map.getSource('areabox')?.setData(bounds ? { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, properties: {} } : EMPTY);
  }

  // ---- sheet ------------------------------------------------------------------
  basemapCheck() {
    const extra = extraBasemap(this.getBasemap());
    if (extra) return `<label class="muted"><input type="checkbox" name="basemap" disabled> Basemap: ${esc(extra.name)} is online only. Switch to OpenFreeMap or USGS to save a basemap.</label>`;
    return `<label><input type="checkbox" name="basemap" checked> Basemap (${this.getBasemap() === 'vector' && this.hasVector ? 'vector' : 'USGS raster'})</label>`;
  }
  async openSheet() {
    let bounds = this.viewBounds();
    const list = await areaDB.all();
    const rep = await report();
    const body = h(`<div class="offline">
      <p class="muted">Tiles and features for the area go into this phone's cache and are kept until you delete the area. Budget ${fmtBytes(rep.cap)}; on the phone now ${fmtBytes(rep.total)}.</p>
      <div class="row"><input name="name" class="grow" placeholder="Area name" value="Area ${list.length + 1}"></div>
      <div class="row wrap"><button class="btn" data-act="view">Use current view</button><button class="btn" data-act="box">Draw a box</button><span class="muted bounds"></span></div>
      <div class="row wrap"><label>Max zoom <select name="maxZoom">${[12, 13, 14, 15, 16].map((z) => `<option value="${z}"${z === 14 ? ' selected' : ''}>${z}${z === 14 ? ' (streets, 1:36k)' : z === 16 ? ' (finest)' : ''}</option>`).join('')}</select></label></div>
      <div class="row wrap checks">
        ${this.basemapCheck()}
        <label><input type="checkbox" name="ownership" checked> Ownership</label>
        <label><input type="checkbox" name="claims" checked> Mining claims</label>
        <label><input type="checkbox" name="records"> Records (MRDS, fossils)</label>
        <label><input type="checkbox" name="terrain"> Terrain to zoom 12 (large tiles)</label>
      </div>
      <div class="estimate"></div>
      <div class="progress" hidden><div class="bar"><div class="fill"></div></div><p class="muted ptext"></p><button class="btn" data-act="cancel">Cancel</button></div>
      <div class="row"><button class="btn primary" data-act="download">Download</button></div>
      <h3>Saved areas</h3>
      <div class="areas">${list.length ? '' : '<p class="muted">None yet.</p>'}${list.map((a) => `<div class="area" data-id="${a.id}"><b>${esc(a.name)}</b> <span class="muted">${fmtBytes(a.bytes)} · ${a.tiles} tiles · ${fmtDate(a.created)}${a.failed ? ` · ${a.failed} failed` : ''}</span><br><span class="muted">${esc(a.sources.join(', '))}</span><br><button class="link" data-act="zoom" data-id="${a.id}">show</button> <button class="link danger" data-act="delete" data-id="${a.id}">delete</button></div>`).join('')}</div>
    </div>`);
    openSheet({ title: 'Offline maps', body, tall: true, onClose: () => { this.showBox(null); this.boxMode = false; this.map.getCanvas().style.cursor = ''; } });
    const est = $('.estimate', body), boundsEl = $('.bounds', body);
    const showBounds = () => { boundsEl.textContent = `${bounds[1].toFixed(3)},${bounds[0].toFixed(3)} to ${bounds[3].toFixed(3)},${bounds[2].toFixed(3)}`; };
    showBounds(); this.showBox(bounds);
    let plans = [], estimate = null;
    const refresh = async () => {
      plans = await this.plan(bounds, formValues(body));
      estimate = await this.estimate(plans);
      const cap = await capBytes();
      const over = rep.total + estimate.bytes > cap;
      const ofm = estimate.rows.find((r) => r.key === 'ofm');
      const ofmOver = ofm && (ofm.tiles > OFM_DOWNLOAD.maxTiles || ofm.bytes > OFM_DOWNLOAD.maxBytes);
      est.innerHTML = `<table>${estimate.rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.tiles}</td><td>${fmtBytes(r.bytes)}</td></tr>`).join('')}<tr class="total"><td>Estimate</td><td>${estimate.tiles}</td><td>${fmtBytes(estimate.bytes)}</td></tr></table>
        <p class="${over || ofmOver ? 'warn' : 'muted'}">${over ? `Over the ${fmtBytes(cap)} budget by ${fmtBytes(rep.total + estimate.bytes - cap)}: raise the cap in Settings, delete an area, or shrink this one.` : ofmOver ? `OpenFreeMap allows at most ${OFM_DOWNLOAD.maxTiles} tiles or ${fmtBytes(OFM_DOWNLOAD.maxBytes)} per download: lower the max zoom or draw a smaller box.` : 'Estimate from measured average tile sizes; the real total is shown when done.'}</p>`;
      $('[data-act="download"]', body).disabled = over || ofmOver || !plans.length;
    };
    body.addEventListener('change', refresh);
    body.addEventListener('click', async (e) => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'view') { bounds = this.viewBounds(); showBounds(); this.showBox(bounds); refresh(); }
      if (act === 'box') this.startBox((b) => { bounds = b; showBounds(); refresh(); });
      if (act === 'cancel') this.abort?.abort();
      if (act === 'zoom') { const a = await areaDB.get(e.target.dataset.id); this.map.fitBounds([[a.bounds[0], a.bounds[1]], [a.bounds[2], a.bounds[3]]], { padding: 40 }); this.showBox(a.bounds); }
      if (act === 'delete') { if (confirm('Delete this area and its tiles?')) { await this.deleteArea(e.target.dataset.id); toast('Area deleted'); this.openSheet(); } }
      if (act === 'download') {
        const prog = $('.progress', body), fill = $('.fill', body), ptext = $('.ptext', body);
        prog.hidden = false; e.target.disabled = true;
        const t0 = performance.now();
        const area = await this.download(formValues(body).name || 'Area', bounds, plans, ({ done, total, bytes, failed, label }) => {
          fill.style.width = `${(100 * done) / total}%`;
          ptext.textContent = `${done}/${total} tiles · ${fmtBytes(bytes)}${failed ? ` · ${failed} failed` : ''} · ${label}`;
        });
        if (area) { toast(`Saved ${area.name}: ${fmtBytes(area.bytes)} in ${((performance.now() - t0) / 1000).toFixed(0)} s`); this.openSheet(); }
        else { toast('Download cancelled'); prog.hidden = true; e.target.disabled = false; }
      }
    });
    refresh();
  }
}
function tilesRange(bounds, z0, z1) { const out = []; for (let z = z0; z <= z1; z++) out.push(...tilesInBounds(bounds, z)); return out; }
export { timeBucket };
