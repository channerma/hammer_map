// Boot and wiring: settings, map, layers, pins, lines, offline, panels, service worker.
import { DEFAULTS, URLS, LIVE_TTL, APP_NAME } from './config.js';
import { settings, areas } from './db.js';
import { BASEMAPS, createMap, setBasemap, setBasemapKeys, setTerrain, makeLocator } from './map.js';
import { PLACES_OVERLAY, extraBasemap, usable } from './basemaps.js';
import { makeLayers } from './features.js';
import { identify, loadRules, renderPanel, stateRuleHtml } from './collect.js';
import { Pins } from './pins.js';
import { Drawer, Lines } from './draw.js';
import { Offline } from './offline.js';
import { exportGpx, exportKml, exportBackup, pickFile } from './io.js';
import { initSheet, openSheet, closeSheet, toast, setStatus, sheetBody } from './ui.js';
import { openLegend, openLayers, openSettings, openRecord, openFire } from './panels.js';
import { enforceBudget } from './cachebudget.js';
import { debounce, timeBucket, $, uid, esc } from './util.js';

const state = { theme: DEFAULTS.theme, basemap: DEFAULTS.basemap, layers: { ...DEFAULTS.layers }, terrain: false, hasVector: false, liveFetched: {}, custom: [], keys: {} };

function applyTheme(theme) {
  state.theme = theme;
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = dark ? '#0f1a14' : '#1b3a2a';
}
const currentTheme = () => document.documentElement.dataset.theme;

async function main() {
  initSheet();
  applyTheme(await settings.get('theme', DEFAULTS.theme));
  state.basemap = await settings.get('basemap', DEFAULTS.basemap);
  state.keys = await settings.get('keys', {});
  const saved = extraBasemap(state.basemap);
  if (!(state.basemap in BASEMAPS) || (saved && !usable(saved, state.keys))) state.basemap = DEFAULTS.basemap;
  state.layers = { ...DEFAULTS.layers, ...(await settings.get('layers', {})) };
  state.custom = await settings.get('custom', []);
  const view = await settings.get('view', { center: DEFAULTS.center, zoom: DEFAULTS.zoom });
  setStatus(navigator.onLine ? 'online' : 'offline', navigator.onLine ? 'ok' : 'warn');

  const { map, hasVector, ofmError } = await createMap('map', { theme: currentTheme(), basemap: state.basemap, center: view.center, zoom: view.zoom, keys: state.keys });
  state.hasVector = hasVector;
  if (!hasVector) toast(`Vector basemap unavailable (${ofmError}); using USGS Topo`, 5000);
  window.hmMap = map; // for tests and the console

  const layers = makeLayers();
  const liveSources = { snow: URLS.snowTiles, rain: URLS.rainTiles };
  const pins = new Pins(map, { onCollect: (ll) => collectAt(ll) });
  const lines = new Lines(map, { theme: currentTheme });
  const drawer = new Drawer(map, { onDone: async (pts) => { const l = await lines.add(pts); lines.openEditor(l); } });
  const offline = new Offline({ map, layers, hasVector, getBasemap: () => state.basemap });
  const locator = makeLocator(map, (s) => setStatus(s, s.startsWith('GPS ±') ? 'ok' : 'warn'));
  const rules = await loadRules();
  await pins.load(); await lines.load();
  for (const c of state.custom) addCustomLayer(map, c);

  // ---- layer toggles ------------------------------------------------------
  function applyLayer(k, on) {
    state.layers[k] = on;
    const vis = on ? 'visible' : 'none';
    if (k === 'places') map.setLayoutProperty(`bm-${PLACES_OVERLAY.id}`, 'visibility', vis);
    if (k === 'padus') for (const id of ['padus-fill', 'padus-line']) map.setLayoutProperty(id, 'visibility', vis);
    if (k === 'smaWest') map.setLayoutProperty('sma-west-fill', 'visibility', vis);
    if (k === 'smaRaster') map.setLayoutProperty('sma-raster', 'visibility', vis);
    if (k === 'claimsOpen') { for (const id of ['claims-open-fill', 'claims-open-line']) map.setLayoutProperty(id, 'visibility', vis); layers.claimsOpen.setEnabled(map, on); }
    if (k === 'claimsClosed') { map.setLayoutProperty('claims-closed-line', 'visibility', vis); layers.claimsClosed.setEnabled(map, on); }
    if (k === 'mrds' || k === 'pbdb') { for (const s of ['clusters', 'count', 'points']) map.setLayoutProperty(`${k}-${s}`, 'visibility', vis); layers[k].setEnabled(map, on); if (on) state.liveFetched[k] = Date.now(); }
    if (k === 'fire') { for (const id of ['fire-fill', 'fire-line']) map.setLayoutProperty(id, 'visibility', vis); layers.fire.setEnabled(map, on); if (on) state.liveFetched.fire = Date.now(); }
    if (k === 'snow' || k === 'rain') {
      const id = `live-${k}`;
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
      if (on) {
        const bucket = timeBucket(LIVE_TTL[k]);
        map.addSource(id, { type: 'raster', tiles: [liveSources[k].replace('{bucket}', bucket)], tileSize: 256, minzoom: 3, maxzoom: 12, attribution: 'NOAA' });
        map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.6 } }, 'fire-fill');
        state.liveFetched[k] = Date.now();
      }
    }
    settings.set('layers', state.layers);
  }
  for (const [k, on] of Object.entries(state.layers)) applyLayer(k, on);

  // ---- custom layers by URL ------------------------------------------------
  function addCustomLayer(m, c) {
    const id = `custom-${c.id}`;
    if (m.getSource(id)) return;
    m.addSource(id, { type: 'raster', tiles: [c.tiles], tileSize: 256, minzoom: 6, maxzoom: 19, attribution: c.name });
    m.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.7 } }, 'fire-fill');
  }
  async function addCustom(url) {
    const u = url.replace(/\/+$/, '');
    let c;
    if (/\/(Map|Feature)Server(\/\d+)?$/i.test(u) || /arcgis\/rest\/services/i.test(u)) {
      const base = u.replace(/\/\d+$/, '').replace(/FeatureServer$/i, 'MapServer');
      const meta = await fetch(`${base}?f=pjson`).then((r) => r.json());
      if (meta.error) throw new Error(meta.error.message);
      const ids = (meta.layers || []).map((l) => l.id).join(',');
      c = { id: uid(), name: meta.mapName || meta.documentInfo?.Title || base.split('/services/')[1] || 'ArcGIS layer', kind: 'ArcGIS export', tiles: `${base}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&transparent=true&format=png32&f=image${ids ? `&layers=show:${ids}` : ''}` };
    } else {
      const cap = await fetch(`${u}${u.includes('?') ? '&' : '?'}service=WMS&request=GetCapabilities`).then((r) => r.text());
      const names = [...cap.matchAll(/<Layer[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g)].map((m) => m[1]).slice(0, 5);
      if (!names.length) throw new Error('No WMS layers found');
      c = { id: uid(), name: `WMS ${names[0]}`, kind: 'WMS', tiles: `${u}${u.includes('?') ? '&' : '?'}service=WMS&version=1.3.0&request=GetMap&layers=${encodeURIComponent(names.join(','))}&styles=&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png&transparent=true` };
    }
    state.custom.push(c); await settings.set('custom', state.custom); addCustomLayer(map, c); toast(`Added ${c.name}`);
  }
  async function removeCustom(id) {
    state.custom = state.custom.filter((c) => c.id !== id); await settings.set('custom', state.custom);
    if (map.getLayer(`custom-${id}`)) map.removeLayer(`custom-${id}`);
    if (map.getSource(`custom-${id}`)) map.removeSource(`custom-${id}`);
  }

  // ---- collect panel --------------------------------------------------------
  async function collectAt(lngLat) {
    const body = openSheet({ title: 'Can I collect here?', body: '<p class="muted">Asking PAD-US, BLM SMA and BLM MLRS…</p>', tall: true });
    const result = await identify(map, lngLat, layers);
    if (sheetBody() !== body || $('#sheet-title').textContent !== 'Can I collect here?') return;
    body.innerHTML = renderPanel(result, rules);
    $('#collect-pin', body)?.addEventListener('click', (e) => pins.add({ lng: lngLat.lng, lat: lngLat.lat, type: e.target.dataset.type }));
    $('#state-rule', body)?.addEventListener('change', (e) => { $('#state-rule-out', body).innerHTML = stateRuleHtml(e.target.value, rules); });
  }

  // ---- map interaction --------------------------------------------------------
  map.on('click', async (e) => {
    if (drawer.active) { drawer.add(e.lngLat); return; }
    if (offline.boxMode) { offline.boxClick(e.lngLat); return; }
    const box = [[e.point.x - 14, e.point.y - 14], [e.point.x + 14, e.point.y + 14]];
    const hit = (ids) => map.queryRenderedFeatures(box, { layers: ids.filter((id) => map.getLayer(id)) });
    const pin = hit(['pins'])[0];
    if (pin) { pins.openEditor(pins.get(pin.properties.id)); return; }
    const line = map.queryRenderedFeatures(box, { layers: ['lines-solid', 'lines-dashed', 'lines-dotted'] })[0];
    if (line) { lines.openEditor(lines.get(line.properties.id)); return; }
    const cluster = hit(['mrds-clusters', 'pbdb-clusters'])[0];
    if (cluster) { map.easeTo({ center: cluster.geometry.coordinates, zoom: map.getZoom() + 2 }); return; }
    const rec = hit(['mrds-points', 'pbdb-points'])[0];
    if (rec) {
      const kind = rec.layer.id.startsWith('mrds') ? 'mrds' : 'pbdb';
      const ll = { lng: rec.geometry.coordinates[0], lat: rec.geometry.coordinates[1] };
      openRecord(kind, rec.properties, { collect: () => collectAt(ll), pin: () => pins.add({ ...ll, type: kind === 'mrds' ? 'historic' : 'fossil', name: rec.properties.SITE_NAME || rec.properties.name }) });
      return;
    }
    const fire = hit(['fire-fill'])[0];
    if (fire) { openFire(fire.properties); return; }
    collectAt(e.lngLat);
  });
  const onMove = debounce(() => {
    for (const l of Object.values(layers)) if (l.enabled) l.update(map);
    const c = map.getCenter();
    settings.set('view', { center: [c.lng, c.lat], zoom: map.getZoom() });
    budgetLater();
  }, 400);
  map.on('moveend', onMove);
  const budgetLater = debounce(() => enforceBudget().then((r) => { if (r.evicted) console.info(`Cache trimmed: ${r.evicted} items`); }), 15000);
  window.addEventListener('online', () => setStatus('online', 'ok'));
  window.addEventListener('offline', () => setStatus('offline', 'warn'));

  // ---- toolbar ----------------------------------------------------------------
  const actions = {
    setBasemap: (b) => { state.basemap = b; settings.set('basemap', b); setBasemap(map, b, hasVector); },
    setTerrain: (on) => { state.terrain = on; setTerrain(map, on); $('#btn-terrain').classList.toggle('on', on); },
    setLayer: applyLayer, addCustom, removeCustom,
    setKey: async (name, value) => {
      state.keys = { ...state.keys, [name]: value.trim() };
      if (!state.keys[name]) delete state.keys[name];
      await settings.set('keys', state.keys);
      setBasemapKeys(map, state.keys);
      const cur = extraBasemap(state.basemap);
      if (cur && !usable(cur, state.keys)) actions.setBasemap(DEFAULTS.basemap);
    },
    setTheme: (t) => { settings.set('theme', t); applyTheme(t); },
    importFile: () => pickFile({ pinsCtl: pins, linesCtl: lines }),
    exportGpx: () => exportGpx(pins.items, lines.items), exportKml: () => exportKml(pins.items, lines.items),
    backup: (includePhotos) => exportBackup({ includePhotos }),
  };
  $('#btn-locate').addEventListener('click', () => { if (locator.active) { locator.recenter(); } else { locator.start(); $('#btn-locate').classList.add('on'); } });
  $('#btn-locate').addEventListener('dblclick', () => { locator.stop(); $('#btn-locate').classList.remove('on'); setStatus(navigator.onLine ? 'online' : 'offline'); });
  $('#btn-layers').addEventListener('click', () => openLayers(state, actions));
  $('#btn-legend').addEventListener('click', openLegend);
  $('#btn-terrain').addEventListener('click', () => actions.setTerrain(!state.terrain));
  $('#btn-draw').addEventListener('click', () => { closeSheet(); drawer.start(); });
  $('#btn-pin').addEventListener('click', () => { const c = locator.position || map.getCenter(); pins.add({ lng: c.lng, lat: c.lat, type: 'other' }); });
  $('#btn-offline').addEventListener('click', () => offline.openSheet());
  $('#btn-menu').addEventListener('click', () => openMenu());
  $('#draw-undo').addEventListener('click', () => drawer.undo());
  $('#draw-done').addEventListener('click', () => drawer.finish());
  $('#draw-cancel').addEventListener('click', () => drawer.cancel());
  function openMenu() {
    const body = document.createElement('div');
    body.className = 'menu';
    body.innerHTML = `<button class="btn" data-act="pins">Pins (${pins.items.length})</button><button class="btn" data-act="lines">Lines (${lines.items.length})</button><button class="btn" data-act="settings">Settings and data</button><button class="btn" data-act="legend">What the pins mean</button>`;
    body.addEventListener('click', (e) => { const a = e.target.dataset.act; if (a === 'pins') pins.openList(); if (a === 'lines') lines.openList(); if (a === 'settings') openSettings(state, actions); if (a === 'legend') openLegend(); });
    openSheet({ title: APP_NAME, body });
  }

  // ---- service worker ---------------------------------------------------------
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('service worker not registered', e); }
  }
  window.hmState = state; window.hmLayers = layers; window.hmPins = pins; window.hmLines = lines; window.hmOffline = offline; window.hmActions = actions;
  document.body.dataset.ready = '1';
  enforceBudget();
}

main().catch((e) => { console.error(e); toast(`Start failed: ${e.message}`, 8000); });
