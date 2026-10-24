// Layers panel (with live badges), the pin legend, settings with the storage meter, and the record sheets.
import { PIN_TYPES, PADUS_LABELS, PADUS_COLORS, SMA_LABELS, SMA_COLORS, pinIconDataUrl } from './style.js';
import { BUILTIN_BASEMAPS } from './map.js';
import { SHOWN_BASEMAPS, usable, hasBuiltinKey } from './basemaps.js';
import { APP_NAME, APP_VERSION, LIVE_TTL } from './config.js';
import { fmtBytes, fmtDate, esc, h, $ } from './util.js';
import { openSheet, toast } from './ui.js';
import { report, enforceBudget, clearBrowsedCache } from './cachebudget.js';
import { settings } from './db.js';

export function openLegend() {
  const pinRow = (k, v, opts = {}) => `<div class="lg"><img alt="" src="${pinIconDataUrl(k, opts)}"><div><b>${esc(v.label)}</b><br><span class="muted">${esc(v.blurb)}</span></div></div>`;
  const pins = ['public', 'private', 'historic', 'fossil'].map((k) => pinRow(k, PIN_TYPES[k])).join('');
  const extra = pinRow('public', { label: 'Best spot', blurb: 'A standout spot (gold ring). Open it to see why.' }, { best: true }) +
    pinRow('public', { label: 'Favorite', blurb: "Spots you've saved with a star." }, { fav: true }) + pinRow('club', PIN_TYPES.club);
  const own = Object.entries(PADUS_LABELS).map(([k, v]) => `<div class="lg sw"><span class="swatch" style="background:${PADUS_COLORS[k]}"></span>${esc(v)}</div>`).join('');
  const sma = Object.entries(SMA_LABELS).filter(([k]) => k !== 'PVT').map(([k, v]) => `<div class="lg sw"><span class="swatch" style="background:${SMA_COLORS[k]}"></span>${esc(v)}</div>`).join('');
  openSheet({ title: 'What the pins mean', tall: true, body: `<p class="muted">A pin's color and badges are a quick guide. Always confirm access before you collect.</p>
    <div class="legend">${pins}${extra}</div>
    <h3>Land ownership (PAD-US manager type)</h3><div class="legend cols">${own}</div>
    <h3>Federal agency fills (BLM SMA, West)</h3><div class="legend cols">${sma}</div>
    <h3>Mining claims</h3><div class="legend"><div class="lg sw"><span class="swatch" style="background:#9b30ff;border:2px solid #6a1fc9"></span>Active claim (BLM MLRS)</div><div class="lg sw"><span class="swatch dashed"></span>Closed within the past year</div></div>
    <h3>Live</h3><div class="legend"><div class="lg sw"><span class="swatch" style="background:#ff6d00;border:2px solid #d50000"></span>Wildfire perimeter (NIFC)</div><div class="lg sw"><span class="swatch" style="background:#9ecae1"></span>Snow depth (NOHRSC)</div><div class="lg sw"><span class="swatch" style="background:#41ab5d"></span>Rain, last 24 h (NWS)</div></div>` });
}

// Basemap chips in groups: the built-in four (saved with offline areas), then the online-only list of js/basemaps.js.
function basemapPicker(state) {
  const chip = (k, label, off) => `<label class="chip"><input type="radio" name="basemap" value="${k}"${state.basemap === k ? ' checked' : ''}${off ? ' disabled' : ''}> ${esc(label)}</label>`;
  const groups = new Map([['OpenFreeMap and USGS (these can be saved offline)', Object.entries(BUILTIN_BASEMAPS).map(([k, v]) => chip(k, v, k === 'vector' && !state.hasVector))]]);
  for (const b of SHOWN_BASEMAPS) groups.set(b.group, [...(groups.get(b.group) || []), chip(b.id, b.name, !usable(b, state.keys))]);
  const html = [...groups].map(([g, chips]) => `<p class="muted">${esc(g)}</p><div class="row wrap">${chips.join('')}</div>`).join('');
  return `${html}<p class="muted">The Esri, CARTO and other maps come from the list in the HCMGIS QGIS plugin. They work online only, and offline areas do not save them.${hasBuiltinKey('carto') ? '' : " CARTO's need a free key: Settings and data."}</p>`;
}

export function openLayers(state, actions) {
  const live = (k) => { const t = state.liveFetched[k]; return t ? `<span class="badge live">live · ${fmtDate(t)} · refresh after ${Math.round(LIVE_TTL[k] / 60000)} min</span>` : '<span class="badge">live</span>'; };
  const row = (k, label, note = '') => `<label class="lrow"><input type="checkbox" name="${k}"${state.layers[k] ? ' checked' : ''}> <span>${label}${note ? `<br><span class="muted">${note}</span>` : ''}</span></label>`;
  const body = h(`<div class="layers">
    <h3>Basemap</h3>
    ${basemapPicker(state)}
    ${row('places', 'Place names and boundaries on top', 'Esri World Boundaries and Places; online only')}
    <label class="lrow"><input type="checkbox" name="terrain"${state.terrain ? ' checked' : ''}> <span>3D terrain<br><span class="muted">Loads terrain tiles only while on; tilt with two fingers.</span></span></label>
    <h3>Land ownership</h3>
    ${row('padus', 'PAD-US manager type (vector tiles, national)', 'USGS PAD-US 4.1')}
    ${row('smaWest', 'Federal agency fills, West US (vector tiles)', 'BLM Surface Management Agency via NIFC')}
    ${row('smaRaster', 'Federal agency fills, national (raster)', 'BLM SMA export tiles; heavier, use when the West tiles stop short')}
    <h3>Mining claims (zoom 11+)</h3>
    ${row('claimsOpen', 'Open claims', 'BLM MLRS')}${row('claimsClosed', 'Closed in the past year (dashed)')}
    <h3>Records (zoom 9+)</h3>
    ${row('mrds', 'Historic mining records (brown)', 'USGS MRDS')}${row('pbdb', 'Fossil records (blue)', 'Paleobiology Database')}
    <p class="muted">Rock & mineral clubs: none are built in. Import a GPX/KML of clubs with type "club" to show them in purple.</p>
    <h3>Live conditions</h3>
    ${row('fire', `Wildfire perimeters ${live('fire')}`)}${row('snow', `Snow depth ${live('snow')}`)}${row('rain', `Rain, last 24 h ${live('rain')}`)}
    <h3>Add a layer by URL</h3>
    <p class="muted">An ArcGIS MapServer/FeatureServer URL or a WMS endpoint, for county parcels and other local layers.</p>
    <div class="row"><input name="url" class="grow" placeholder="https://.../MapServer or https://.../wms?"><button class="btn" data-act="addurl">Add</button></div>
    <div class="custom">${state.custom.map((c) => `<div class="area"><b>${esc(c.name)}</b> <span class="muted">${esc(c.kind)}</span> <button class="link danger" data-act="rmurl" data-id="${c.id}">remove</button></div>`).join('')}</div>
  </div>`);
  body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'basemap') actions.setBasemap(t.value);
    else if (t.name === 'terrain') actions.setTerrain(t.checked);
    else if (t.type === 'checkbox') actions.setLayer(t.name, t.checked);
  });
  body.addEventListener('click', async (e) => {
    const act = e.target.dataset.act; if (!act) return;
    if (act === 'addurl') { const url = $('[name=url]', body).value.trim(); if (url) { try { await actions.addCustom(url); openLayers(state, actions); } catch (err) { toast(`Could not add: ${err.message}`, 5000); } } }
    if (act === 'rmurl') { await actions.removeCustom(e.target.dataset.id); openLayers(state, actions); }
  });
  openSheet({ title: 'Layers', body, tall: true });
}

export async function openSettings(state, actions) {
  const r = await report();
  const pct = Math.min(100, Math.round((100 * r.total) / r.cap));
  const body = h(`<div class="settings">
    <h3>Data on this phone</h3>
    <div class="meter"><div class="fill" style="width:${pct}%"></div></div>
    <p>${fmtBytes(r.total)} of the ${fmtBytes(r.cap)} budget</p>
    <table class="kv">
      <tr><td>Your pins, lines, notes, photos</td><td>${fmtBytes(r.userBytes)} <span class="muted">(${r.pins} pins, ${r.lines} lines, ${r.photos} photos; kept until you delete them)</span></td></tr>
      <tr><td>Offline areas</td><td>${fmtBytes(r.areaBytes)} <span class="muted">(${r.areas} areas; kept until you delete them)</span></td></tr>
      <tr><td>Browsing cache</td><td>${fmtBytes(r.cacheBytes)} <span class="muted">(${r.tilesCached} tiles, ${r.featureTiles} feature tiles; least recently used go first)</span></td></tr>
      ${r.estimate ? `<tr><td>Browser's own estimate</td><td>${fmtBytes(r.estimate.usage)} used of ${fmtBytes(r.estimate.quota)} allowed</td></tr>` : ''}
    </table>
    <div class="row wrap"><label>Cache budget <select name="cap">${[50, 100, 150, 250, 500, 1000].map((mb) => `<option value="${mb}"${Math.round(r.cap / 1048576) === mb ? ' selected' : ''}>${mb} MB</option>`).join('')}</select></label>
      <button class="btn" data-act="evict">Trim to budget now</button><button class="btn" data-act="clear">Clear browsing cache</button></div>
    <h3>Basemap keys</h3>
    <p class="muted">${hasBuiltinKey('carto') ? 'Hammer Map has a CARTO key built in, free for non-commercial use up to 5 million tiles a month across everyone using it. To use your own instead,' : "CARTO's basemaps need a free key for non-commercial use (up to 5 million tiles a month). To use them,"} request one at <a href="https://carto.com/basemaps/apikey" target="_blank" rel="noopener">carto.com/basemaps/apikey</a> and paste it here. It stays on this phone and is sent only to CARTO.</p>
    <div class="row"><input name="cartoKey" class="grow" placeholder="${hasBuiltinKey('carto') ? 'Your own CARTO key (optional)' : 'CARTO key'}" autocomplete="off" value="${esc(state.keys?.carto || '')}"><button class="btn" data-act="savekey">Save</button></div>
    <h3>Appearance</h3>
    <div class="row wrap">${['auto', 'light', 'dark'].map((t) => `<label class="chip"><input type="radio" name="theme" value="${t}"${state.theme === t ? ' checked' : ''}> ${t}</label>`).join('')}</div>
    <p class="muted">Units: miles, feet, degrees Fahrenheit.</p>
    <h3>Your data</h3>
    <div class="row wrap"><button class="btn" data-act="import">Import GPX / KML / backup</button><button class="btn" data-act="gpx">Export GPX</button><button class="btn" data-act="kml">Export KML</button><button class="btn" data-act="backup">Backup (JSON)</button><label><input type="checkbox" name="photos" checked> include photos</label></div>
    <p class="muted">Nothing leaves this phone unless you export it. The map services only ever see the area you look at.</p>
    <h3>About</h3>
    <p class="muted">${APP_NAME} ${APP_VERSION}. Collecting rules are general guidance with their sources, not legal advice: confirm with the office before you collect. Basemap: OpenFreeMap / OpenMapTiles / OpenStreetMap contributors; USGS The National Map. More basemaps: Esri, CARTO, F4map, HCMC OneMap (list from the HCMGIS QGIS plugin). Ownership: USGS PAD-US, BLM SMA. Claims: BLM MLRS. Records: USGS MRDS, Paleobiology Database. Live: NIFC, NOAA.</p>
  </div>`);
  body.addEventListener('change', async (e) => {
    if (e.target.name === 'cap') { await settings.set('cacheCapMB', +e.target.value); toast(`Budget set to ${e.target.value} MB`); }
    if (e.target.name === 'theme') actions.setTheme(e.target.value);
  });
  body.addEventListener('click', async (e) => {
    const act = e.target.dataset.act; if (!act) return;
    if (act === 'evict') { const x = await enforceBudget(); toast(`Evicted ${x.evicted} items (${fmtBytes(x.bytes)})`); openSettings(state, actions); }
    if (act === 'clear') { const n = await clearBrowsedCache(); toast(`Cleared ${n} cached items`); openSettings(state, actions); }
    if (act === 'savekey') { await actions.setKey('carto', $('[name=cartoKey]', body).value); toast(state.keys.carto ? 'CARTO key saved on this phone' : hasBuiltinKey('carto') ? 'Your CARTO key removed; the built-in one is used' : 'CARTO key removed'); }
    if (act === 'import') actions.importFile();
    if (act === 'gpx') actions.exportGpx();
    if (act === 'kml') actions.exportKml();
    if (act === 'backup') actions.backup($('[name=photos]', body).checked);
  });
  openSheet({ title: 'Settings and data', body, tall: true });
}

export function openRecord(kind, props, actions) {
  const rows = kind === 'mrds'
    ? [['Site', props.SITE_NAME], ['Status', props.DEV_STAT], ['Commodities', props.CODE_LIST], ['Grade', props.Grade], ['Record', props.URL ? `<a href="${esc(props.URL)}" target="_blank" rel="noopener">USGS MRDS ${esc(props.DEP_ID)}</a>` : props.DEP_ID]]
    : [['Taxon', props.name], ['Interval', props.interval], ['Age', props.eag ? `${props.eag} to ${props.lag} million years` : ''], ['Formation', [props.formation, props.member].filter(Boolean).join(', ')], ['Record', `<a href="https://paleobiodb.org/classic/basicCollectionSearch?collection_no=${String(props.cid || '').replace('col:', '')}" target="_blank" rel="noopener">Paleobiology Database ${esc(props.cid)}</a>`]];
  const body = h(`<div><table class="kv">${rows.filter((r) => r[1]).map(([k, v]) => `<tr><td>${k}</td><td>${k === 'Record' ? v : esc(v)}</td></tr>`).join('')}</table>
    <p class="muted">${kind === 'mrds' ? 'An old mining record (USGS stopped updating MRDS in 2011). It may be built over, reclaimed, claimed or private now.' : 'A fossil site from research records. Check the land rules first; vertebrate fossils need a permit on federal land.'}</p>
    <div class="row wrap"><button class="btn" data-act="collect">Can I collect here?</button><button class="btn" data-act="pin">Save as pin</button></div></div>`);
  body.addEventListener('click', (e) => { const act = e.target.dataset.act; if (act === 'collect') actions.collect(); if (act === 'pin') actions.pin(); });
  openSheet({ title: kind === 'mrds' ? 'Historic mining record' : 'Fossil record', body });
}
export function openFire(props) {
  openSheet({ title: props.poly_IncidentName || 'Wildfire', body: `<table class="kv"><tr><td>Size</td><td>${props.attr_IncidentSize ? `${Math.round(props.attr_IncidentSize).toLocaleString()} acres` : 'unknown'}</td></tr><tr><td>Contained</td><td>${props.attr_PercentContained != null ? `${props.attr_PercentContained}%` : 'unknown'}</td></tr><tr><td>Discovered</td><td>${fmtDate(props.attr_FireDiscoveryDateTime)}</td></tr><tr><td>Perimeter updated</td><td>${fmtDate(props.poly_DateCurrent)}</td></tr><tr><td>Cause</td><td>${esc(props.attr_FireCause || 'unknown')}</td></tr></table><p class="muted">NIFC WFIGS current perimeters.</p>` });
}
