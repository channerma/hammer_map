// One MapLibre style holds everything: the vector basemap (OpenFreeMap Liberty), the USGS raster basemaps
// (hidden until chosen), ownership, claims, records, live layers, lines and pins. Basemap switches toggle
// visibility, so nothing is rebuilt and nothing is refetched. Pins are symbol layers with icons drawn at runtime.
import { URLS, ATTRIBUTION } from './config.js';
import { SHOWN_BASEMAPS, PLACES_OVERLAY, basemapTiles } from './basemaps.js';

// PAD-US "Manager Type" vector tiles carry one attribute, _symbol, in the order of the service's own style.
export const PADUS_SYMBOLS = ['TRIB', 'FED', 'JNT', 'LOC', 'NGO', 'PVT', 'DIST', 'STAT', 'TERR', 'UNK'];
export const PADUS_LABELS = {
  FED: 'Federal', STAT: 'State', LOC: 'Local government', TRIB: 'Tribal (American Indian lands)',
  NGO: 'Private conservation (NGO)', PVT: 'Private (in PAD-US)', DIST: 'Regional agency or special district',
  JNT: 'Joint', TERR: 'Territorial', UNK: 'Unknown',
};
export const PADUS_COLORS = {
  FED: '#2e8b57', STAT: '#9eb517', LOC: '#2f5597', TRIB: '#c9a27e', NGO: '#e66914', PVT: '#843c0c',
  DIST: '#8f7377', JNT: '#e3b0af', TERR: '#beb49c', UNK: '#a6a6a6',
};
// West-US SMA vector tiles (NIFC-hosted copy of BLM's Surface Management Agency data): _symbol order from its style.
export const SMA_SYMBOLS = ['BIA', 'BLM', 'BOR', 'DOD', 'DOE', 'USFS', 'FWS', 'NPS', 'PK', 'PVT', 'ST'];
export const SMA_LABELS = {
  BLM: 'BLM', USFS: 'US Forest Service', NPS: 'National Park Service', FWS: 'US Fish & Wildlife Service',
  BOR: 'Bureau of Reclamation', DOD: 'Department of Defense', BIA: 'Bureau of Indian Affairs (tribal)',
  DOE: 'Department of Energy', PK: 'Code PK (unlabelled in the source)', ST: 'State', PVT: 'Private (not drawn)',
};
export const SMA_COLORS = {
  BIA: '#f0a35e', BLM: '#f2c94c', BOR: '#d9d05a', DOD: '#e86fa0', DOE: '#c2a386', USFS: '#5cb85c',
  FWS: '#38b48b', NPS: '#8e7cc3', PK: '#6cb6b6', PVT: '#ffffff', ST: '#4fc3f7',
};
export const PIN_TYPES = {
  public: { label: 'Public access', color: '#2e9e4f', blurb: 'Reported as open to visitors. Check land rules and claims first.' },
  private: { label: 'Private or unknown', color: '#d13b3b', blurb: 'Private, claimed, or unverified. Get permission first.' },
  historic: { label: 'Historic record', color: '#8a5a2b', blurb: 'An old mining record (USGS MRDS). May be built over or private now.' },
  fossil: { label: 'Fossil record', color: '#2f6fd6', blurb: 'A fossil site from research records (Paleobiology Database). Check land rules first.' },
  club: { label: 'Rock & mineral club', color: '#7b3fd6', blurb: 'A local club. Import your own club list; none are built in.' },
  other: { label: 'Other', color: '#5b6b7a', blurb: 'Anything else worth a pin.' },
};

const EMPTY = { type: 'FeatureCollection', features: [] };
const matchExpr = (symbols, colors) => ['match', ['coalesce', ['get', '_symbol'], -1], ...symbols.flatMap((s, i) => [i, colors[s]]), '#999999'];
const geo = (opts = {}) => ({ type: 'geojson', data: EMPTY, ...opts });

export function buildStyle({ ofm, ofmTemplate, theme, keys = {} }) {
  const sources = {}, layers = [], ofmLayerIds = [];
  if (ofm) {
    for (const [k, v] of Object.entries(ofm.sources)) {
      const s = { ...v };
      if (k === 'openmaptiles' && ofmTemplate) { delete s.url; s.tiles = [ofmTemplate]; s.minzoom = 0; s.maxzoom = 14; s.attribution = ATTRIBUTION.ofm; }
      sources[k] = s;
    }
    for (const l of ofm.layers) { const c = JSON.parse(JSON.stringify(l)); ofmLayerIds.push(c.id); layers.push(c); }
  } else {
    layers.push({ id: 'background', type: 'background', paint: { 'background-color': theme === 'dark' ? '#0f1a14' : '#e9efe6' } });
  }
  const raster = (id, url, maxzoom = 16, attribution = ATTRIBUTION.usgs) => { sources[id] = { type: 'raster', tiles: [url], tileSize: 256, maxzoom, attribution }; layers.push({ id, type: 'raster', source: id, layout: { visibility: 'none' } }); };
  raster('usgs-topo', URLS.usgsTopo); raster('usgs-imagery', URLS.usgsImagery); raster('usgs-imagerytopo', URLS.usgsImageryTopo);
  for (const b of SHOWN_BASEMAPS) raster(`bm-${b.id}`, basemapTiles(b, keys), b.maxzoom, b.attribution); // js/basemaps.js, hidden until chosen
  raster(`bm-${PLACES_OVERLAY.id}`, PLACES_OVERLAY.url, PLACES_OVERLAY.maxzoom, PLACES_OVERLAY.attribution); // overlay, Layers > Basemap

  // Ownership
  sources.padus = { type: 'vector', tiles: [URLS.padusTiles], minzoom: 0, maxzoom: 16, attribution: ATTRIBUTION.padus };
  layers.push({ id: 'padus-fill', type: 'fill', source: 'padus', 'source-layer': 'PADUS', paint: { 'fill-color': matchExpr(PADUS_SYMBOLS, PADUS_COLORS), 'fill-opacity': 0.32 } });
  layers.push({ id: 'padus-line', type: 'line', source: 'padus', 'source-layer': 'PADUS', minzoom: 9, paint: { 'line-color': matchExpr(PADUS_SYMBOLS, PADUS_COLORS), 'line-width': 1, 'line-opacity': 0.7 } });
  sources.smaWest = { type: 'vector', tiles: [URLS.smaWestTiles], minzoom: 0, maxzoom: 13, attribution: ATTRIBUTION.sma };
  layers.push({ id: 'sma-west-fill', type: 'fill', source: 'smaWest', 'source-layer': 'West_US_SurfaceManagementAgency', filter: ['!=', ['get', '_symbol'], 9], paint: { 'fill-color': matchExpr(SMA_SYMBOLS, SMA_COLORS), 'fill-opacity': 0.45 } });
  sources.smaRaster = { type: 'raster', tiles: [URLS.smaRasterTiles], tileSize: 256, minzoom: 5, maxzoom: 15, attribution: ATTRIBUTION.sma };
  layers.push({ id: 'sma-raster', type: 'raster', source: 'smaRaster', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.5 } });

  // Live: fire perimeters (snow and rain rasters are added when switched on, with a time bucket in the URL)
  sources.fire = geo();
  layers.push({ id: 'fire-fill', type: 'fill', source: 'fire', paint: { 'fill-color': '#ff6d00', 'fill-opacity': 0.3 } });
  layers.push({ id: 'fire-line', type: 'line', source: 'fire', paint: { 'line-color': '#d50000', 'line-width': 2 } });

  // Mining claims
  sources['claims-open'] = geo(); sources['claims-closed'] = geo();
  const claimWidth = ['interpolate', ['linear'], ['zoom'], 11, 0.6, 13, 1.2, 16, 2];
  layers.push({ id: 'claims-open-fill', type: 'fill', source: 'claims-open', minzoom: 11, paint: { 'fill-color': '#9b30ff', 'fill-opacity': 0.07 } });
  layers.push({ id: 'claims-open-line', type: 'line', source: 'claims-open', minzoom: 11, paint: { 'line-color': '#6a1fc9', 'line-width': claimWidth } });
  layers.push({ id: 'claims-closed-line', type: 'line', source: 'claims-closed', minzoom: 11, paint: { 'line-color': '#b000b0', 'line-width': claimWidth, 'line-dasharray': [2, 2] } });

  // Records (clustered)
  for (const [id, color, icon] of [['mrds', '#8a5a2b', 'rec-historic'], ['pbdb', '#2f6fd6', 'rec-fossil']]) {
    sources[id] = geo({ cluster: true, clusterRadius: 42, clusterMaxZoom: 13 });
    layers.push({ id: `${id}-clusters`, type: 'circle', source: id, filter: ['has', 'point_count'], paint: { 'circle-color': color, 'circle-opacity': 0.85, 'circle-radius': ['step', ['get', 'point_count'], 14, 20, 18, 100, 24], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    layers.push({ id: `${id}-count`, type: 'symbol', source: id, filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 }, paint: { 'text-color': '#fff' } });
    layers.push({ id: `${id}-points`, type: 'symbol', source: id, filter: ['!', ['has', 'point_count']], layout: { 'icon-image': icon, 'icon-size': 0.5, 'icon-allow-overlap': true } });
  }

  // Lines (three layers because dash style is per feature), the line being drawn, the offline area box
  sources.lines = geo();
  const lineBase = { type: 'line', source: 'lines', layout: { 'line-cap': 'round', 'line-join': 'round' } };
  layers.push({ id: 'lines-casing', ...lineBase, paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.55 } });
  layers.push({ id: 'lines-solid', ...lineBase, filter: ['==', ['get', 'dash'], 'solid'], paint: { 'line-color': ['get', 'color'], 'line-width': 3.5 } });
  layers.push({ id: 'lines-dashed', ...lineBase, filter: ['==', ['get', 'dash'], 'dashed'], paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-dasharray': [2, 1.5] } });
  layers.push({ id: 'lines-dotted', ...lineBase, filter: ['==', ['get', 'dash'], 'dotted'], paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-dasharray': [0.2, 1.6] } });
  sources.draw = geo();
  layers.push({ id: 'draw-line', type: 'line', source: 'draw', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ff7a00', 'line-width': 3, 'line-dasharray': [1.5, 1.2] } });
  layers.push({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#ff7a00', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  sources.areabox = geo();
  layers.push({ id: 'areabox-fill', type: 'fill', source: 'areabox', paint: { 'fill-color': '#1e88e5', 'fill-opacity': 0.08 } });
  layers.push({ id: 'areabox-line', type: 'line', source: 'areabox', paint: { 'line-color': '#1e88e5', 'line-width': 2, 'line-dasharray': [2, 1] } });

  // GPS
  sources.location = geo();
  layers.push({ id: 'loc-acc', type: 'fill', source: 'location', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#1e88e5', 'fill-opacity': 0.15 } });
  layers.push({ id: 'loc-heading', type: 'symbol', source: 'location', filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', 'heading']], layout: { 'icon-image': 'heading', 'icon-size': 0.5, 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
  layers.push({ id: 'loc-dot', type: 'circle', source: 'location', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 7, 'circle-color': '#1e88e5', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });

  // Pins: icon chosen by type and badges; label at zoom 12 and up
  sources.pins = geo();
  layers.push({
    id: 'pins', type: 'symbol', source: 'pins',
    layout: {
      'icon-image': ['concat', 'pin-', ['get', 'type'], ['case', ['to-boolean', ['get', 'best']], '-best', ''], ['case', ['to-boolean', ['get', 'fav']], '-fav', '']],
      'icon-size': 0.5, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'text-field': ['step', ['zoom'], '', 12, ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 12,
      'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-optional': true,
    },
    paint: { 'text-color': theme === 'dark' ? '#f4f7f4' : '#14261b', 'text-halo-color': theme === 'dark' ? '#0f1a14' : '#ffffff', 'text-halo-width': 1.6 },
  });

  return {
    version: 8, name: 'Hammer Map', glyphs: ofm?.glyphs || URLS.ofmGlyphs, ...(ofm?.sprite ? { sprite: ofm.sprite } : {}),
    sources, layers, metadata: { ofmLayerIds },
  };
}

// ---- runtime icons -------------------------------------------------------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function glyph(ctx, kind, cx, cy, s) {
  ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineWidth = s * 0.11;
  if (kind === 'fossil') { // ammonite spiral
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 5; a += 0.15) { const r = s * 0.04 * a; const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a); a ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); return;
  }
  if (kind === 'club') { // two people
    for (const dx of [-s * 0.16, s * 0.16]) { ctx.beginPath(); ctx.arc(cx + dx, cy - s * 0.12, s * 0.1, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(cx + dx, cy + s * 0.2, s * 0.17, Math.PI, 0); ctx.fill(); }
    return;
  }
  // rock pick: handle and curved head
  ctx.beginPath(); ctx.moveTo(cx - s * 0.22, cy + s * 0.24); ctx.lineTo(cx + s * 0.12, cy - s * 0.1); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx + s * 0.1, cy - s * 0.04, s * 0.22, Math.PI * 1.15, Math.PI * 1.95); ctx.stroke();
  // crystal cluster
  ctx.beginPath(); ctx.moveTo(cx - s * 0.3, cy + s * 0.28); ctx.lineTo(cx - s * 0.22, cy - s * 0.02); ctx.lineTo(cx - s * 0.12, cy + s * 0.28); ctx.closePath(); ctx.fill();
}
function star(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.45 : r; const a = (Math.PI / 5) * i - Math.PI / 2; ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); }
  ctx.closePath(); ctx.fillStyle = '#f5c518'; ctx.fill(); ctx.strokeStyle = '#8a6d00'; ctx.lineWidth = 2; ctx.stroke();
}
function drawPin(color, kind, { best = false, fav = false, size = 72 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const m = size * 0.14, w = size - 2 * m;
  if (best) { roundRect(ctx, m - 7, m - 7, w + 14, w + 14, 20); ctx.fillStyle = '#f5c518'; ctx.fill(); }
  roundRect(ctx, m, m, w, w, 14); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.stroke();
  glyph(ctx, kind, size / 2, size / 2, w);
  if (fav) star(ctx, m + 2, m + 2, 11);
  return ctx.getImageData(0, 0, size, size);
}
function drawHeading(size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.beginPath(); ctx.moveTo(size / 2, 2); ctx.lineTo(size * 0.8, size * 0.62); ctx.lineTo(size / 2, size * 0.5); ctx.lineTo(size * 0.2, size * 0.62); ctx.closePath();
  ctx.fillStyle = 'rgba(30,136,229,0.9)'; ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}
export function makeIcons(map) {
  const add = (name, img) => { if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 }); };
  for (const [type, def] of Object.entries(PIN_TYPES)) {
    for (const best of [false, true]) for (const fav of [false, true]) {
      add(`pin-${type}${best ? '-best' : ''}${fav ? '-fav' : ''}`, drawPin(def.color, type, { best, fav }));
    }
  }
  add('rec-historic', drawPin(PIN_TYPES.historic.color, 'historic', { size: 52 }));
  add('rec-fossil', drawPin(PIN_TYPES.fossil.color, 'fossil', { size: 52 }));
  add('heading', drawHeading());
}
export function pinIconDataUrl(type, { best = false, fav = false } = {}) {
  const img = drawPin(PIN_TYPES[type]?.color || PIN_TYPES.other.color, type, { best, fav, size: 48 });
  const c = document.createElement('canvas'); c.width = c.height = 48; c.getContext('2d').putImageData(img, 0, 0);
  return c.toDataURL();
}
