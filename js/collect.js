// "Can I collect here?": who runs the land at a point, any mining claim there, and the collecting rules
// for that manager from rules.json. Online it asks the services at the point (no geometry comes back);
// offline it reads the vector tiles under the tap and the feature tiles saved with a downloaded area.
import { URLS } from './config.js';
import { PADUS_SYMBOLS, SMA_SYMBOLS, PADUS_LABELS, SMA_LABELS } from './style.js';
import { esc, fmtCoord, fmtDate, withTimeout } from './util.js';

let RULES = null;
export async function loadRules() {
  if (!RULES) RULES = await fetch('rules.json').then((r) => r.json());
  return RULES;
}

const PUB_ACCESS = { OA: 'Open access', RA: 'Restricted access', XA: 'Closed to the public', UK: 'Access unknown' };
const GAP = { 1: 'GAP 1 (managed for biodiversity, natural processes)', 2: 'GAP 2 (managed for biodiversity)', 3: 'GAP 3 (multiple use; extraction may be allowed)', 4: 'GAP 4 (no known mandate for protection)' };
const CLAIM_TYPES = { 384101: 'Lode claim', 384201: 'Placer claim', 384301: 'Mill site', 384401: 'Tunnel site', 384102: 'Lode claim (amended)', 384202: 'Placer claim (amended)' };
const FED_BY_NAME = { BLM: 'BLM', USFS: 'USFS', FS: 'USFS', NPS: 'NPS', FWS: 'FWS', USBR: 'BOR', BOR: 'BOR', DOD: 'DOD', USACE: 'DOD', TVA: 'TVA', BIA: 'TRIBAL', DOE: 'OTHER_FED', NRCS: 'OTHER_FED', OTHF: 'OTHER_FED', USDA: 'OTHER_FED' };

async function pointQuery(url, lngLat, outFields, signal) {
  const qs = new URLSearchParams({ f: 'json', geometry: `${lngLat.lng},${lngLat.lat}`, geometryType: 'esriGeometryPoint', inSR: 4326, spatialRel: 'esriSpatialRelIntersects', outFields, returnGeometry: false });
  const res = await fetch(`${url}?${qs}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'query error');
  return (j.features || []).map((f) => f.attributes);
}

async function localIdentify(map, lngLat, layers) {
  const pt = map.project(lngLat);
  const padusTile = map.queryRenderedFeatures(pt, { layers: ['padus-fill'] }).slice(0, 1).map((f) => ({ Mang_Type: PADUS_SYMBOLS[f.properties._symbol], _tile: true }));
  const sma = map.queryRenderedFeatures(pt, { layers: ['sma-west-fill'] }).slice(0, 1).map((f) => ({ ADMIN_AGENCY_CODE: SMA_SYMBOLS[f.properties._symbol], _tile: true }));
  const p = [lngLat.lng, lngLat.lat];
  const [units, claims, closed] = await Promise.all([layers.padusUnits.featuresAt(p), layers.claimsOpen.featuresAt(p), layers.claimsClosed.featuresAt(p)]);
  return { padus: units.length ? units.map((f) => f.properties) : padusTile, sma, claims: claims.map((f) => f.properties), closed: closed.map((f) => f.properties) };
}

export async function identify(map, lngLat, layers) {
  const result = { lngLat, padus: [], sma: [], claims: [], closed: [], online: navigator.onLine, errors: [], fromCache: false };
  if (navigator.onLine) {
    const q = (name, p) => withTimeout(p, 9000, name).then((v) => ({ name, v }), (e) => ({ name, e: e.message }));
    const [pa, sm, cl, cc] = await Promise.all([
      q('PAD-US', pointQuery(URLS.padusQuery, lngLat, 'Mang_Type,Mang_Name,Unit_Nm,Loc_Mang,Pub_Access,GAP_Sts,Des_Tp,State_Nm')),
      q('BLM SMA', pointQuery(URLS.smaQuery, lngLat, 'ADMIN_AGENCY_CODE,ADMIN_UNIT_NAME,ADMIN_DEPT_CODE,ADMIN_ST')),
      q('BLM mining claims', pointQuery(URLS.claimsOpen, lngLat, 'CSE_NAME,CSE_NR,CSE_TYPE_NR,CSE_DISP,RCRD_ACRS,Modified')),
      q('BLM closed claims', pointQuery(URLS.claimsClosed, lngLat, 'CSE_NAME,CSE_NR,CSE_TYPE_NR,CSE_DISP,RCRD_ACRS,Modified')),
    ]);
    for (const r of [pa, sm, cl, cc]) if (r.e) result.errors.push(`${r.name}: ${r.e}`);
    result.padus = pa.v || []; result.sma = sm.v || []; result.claims = cl.v || []; result.closed = cc.v || [];
  }
  if (!navigator.onLine || result.errors.length) {
    const local = await localIdentify(map, lngLat, layers);
    for (const k of ['padus', 'sma', 'claims', 'closed']) if (!result[k].length && local[k].length) { result[k] = local[k]; result.fromCache = true; }
  }
  return result;
}

function stateKey(mang, st, rules) {
  if (st && ['SLB', 'SDOL'].includes(mang) && rules[`STATE_TRUST_${st}`]) return `STATE_TRUST_${st}`;
  if (mang === 'SPR') return rules[`STATE_PARK_${st}`] ? `STATE_PARK_${st}` : 'STATE_PARK';
  if (st && rules[`STATE_TRUST_${st}`] && !mang) return `STATE_TRUST_${st}`;
  return 'STATE';
}
export function rulesFor(result, rulesDoc) {
  const rules = rulesDoc.rules;
  const p = result.padus[0], s = result.sma[0];
  const mang = p?.Mang_Name, type = p?.Mang_Type, agency = s?.ADMIN_AGENCY_CODE, st = p?.State_Nm || s?.ADMIN_ST;
  let primary;
  if (mang && FED_BY_NAME[mang]) primary = FED_BY_NAME[mang];
  else if (agency && FED_BY_NAME[agency]) primary = FED_BY_NAME[agency];
  else if (type === 'TRIB' || agency === 'BIA') primary = 'TRIBAL';
  else if (type === 'STAT' || agency === 'ST') primary = stateKey(mang, st, rules);
  else if (['LOC', 'DIST'].includes(type) || agency === 'LG') primary = 'LOCAL';
  else if (type === 'NGO') primary = 'NGO';
  else if (type === 'PVT' || agency === 'PVT') primary = 'PRIVATE';
  else if (type === 'FED') primary = 'OTHER_FED';
  else primary = 'UNKNOWN';
  const keys = [primary];
  if (p?.Des_Tp && ['WA', 'WSA'].includes(p.Des_Tp)) keys.push('WILDERNESS');
  if (result.claims.length) keys.push('CLAIM_ACTIVE');
  if (result.closed.length) keys.push('CLAIM_CLOSED');
  if (['BLM', 'USFS', 'BOR'].includes(primary)) keys.push('FOSSILS_FEDERAL');
  return { primary, keys: keys.filter((k) => rules[k]), state: st };
}

function claimHtml(c, closed) {
  const t = CLAIM_TYPES[c.CSE_TYPE_NR] || `Case type ${esc(c.CSE_TYPE_NR)}`;
  return `<li><b>${esc(c.CSE_NAME || 'Unnamed claim')}</b> <span class="muted">${esc(c.CSE_NR)}</span><br>${t} · ${esc(c.CSE_DISP)}${c.RCRD_ACRS ? ` · ${(+c.RCRD_ACRS).toFixed(1)} acres` : ''}${c.Modified ? ` · updated ${fmtDate(c.Modified)}` : ''}${closed ? ' · <i>closed within the past year</i>' : ''}</li>`;
}
function ruleHtml(key, r) {
  const li = (items, cls) => (items || []).map((x) => `<li class="${cls}">${esc(x)}</li>`).join('');
  const src = (r.sources || []).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="muted">(read ${esc(s.read)}${s.how ? `, ${esc(s.how)}` : ''})</span>${s.verified === false ? ' <span class="badge warn">unverified</span>' : ''}`).join('<br>');
  return `<section class="rule${r.verified ? '' : ' unverified'}" data-rule="${esc(key)}">
    <h4>${esc(r.title)}${r.verified ? '' : ' <span class="badge warn">source not verified</span>'}</h4>
    ${r.who ? `<p class="who">${esc(r.who)}</p>` : ''}
    ${r.allowed?.length ? `<p class="lbl">Generally allowed</p><ul class="ok">${li(r.allowed, 'ok')}</ul>` : ''}
    ${r.not_allowed?.length ? `<p class="lbl">Not allowed</p><ul class="no">${li(r.not_allowed, 'no')}</ul>` : ''}
    ${r.ask ? `<p><b>Who to ask:</b> ${esc(r.ask)}</p>` : ''}
    ${r.note ? `<p class="muted">${esc(r.note)}</p>` : ''}
    ${src ? `<p class="sources">${src}</p>` : ''}
  </section>`;
}

export function renderPanel(result, rulesDoc) {
  const { primary, keys, state } = rulesFor(result, rulesDoc);
  const p = result.padus[0], s = result.sma[0];
  const parts = [];
  parts.push(`<p class="coords">${fmtCoord(result.lngLat.lng, result.lngLat.lat)}${result.fromCache ? ' <span class="badge">from saved tiles</span>' : ''}${!result.online ? ' <span class="badge warn">offline</span>' : ''}</p>`);
  parts.push('<h3>Who runs the land</h3>');
  if (!p && !s) parts.push('<p>No managed-area record at this point in PAD-US or BLM SMA. The land is most likely <b>private</b>: find the owner (county parcel map) and ask.</p>');
  if (p) {
    const type = PADUS_LABELS[p.Mang_Type] || p.Mang_Type || '';
    parts.push(`<p><b>${esc(p.Unit_Nm || type)}</b>${p.Loc_Mang ? `<br>${esc(p.Loc_Mang)}` : ''}${p.Mang_Name ? ` <span class="muted">(${esc(p.Mang_Name)}, ${esc(type)})</span>` : p._tile ? ` <span class="muted">(${esc(type)}, from the PAD-US tile)</span>` : ''}${p.Pub_Access ? `<br>${esc(PUB_ACCESS[p.Pub_Access] || p.Pub_Access)}` : ''}${p.GAP_Sts ? ` · ${esc(GAP[p.GAP_Sts] || p.GAP_Sts)}` : ''}${p.Des_Tp ? ` · designation ${esc(p.Des_Tp)}` : ''}<br><span class="muted">USGS PAD-US 4.1</span></p>`);
  }
  if (s) parts.push(`<p><b>${esc(SMA_LABELS[s.ADMIN_AGENCY_CODE] || s.ADMIN_AGENCY_CODE)}</b>${s.ADMIN_UNIT_NAME ? ` · ${esc(s.ADMIN_UNIT_NAME)}` : ''}<br><span class="muted">BLM Surface Management Agency${s._tile ? ' (from the vector tile)' : ''}</span></p>`);
  parts.push('<h3>Mining claims here</h3>');
  if (!result.claims.length && !result.closed.length) parts.push(`<p>${result.online && !result.errors.some((e) => e.includes('claims')) ? 'No claim on file at this point (BLM MLRS).' : 'No claim found in the saved tiles for this spot; the live record could not be checked.'}</p>`);
  else parts.push(`<ul class="claims">${result.claims.map((c) => claimHtml(c, false)).join('')}${result.closed.map((c) => claimHtml(c, true)).join('')}</ul><p class="muted">Claimant names: look the serial number up in BLM's <a href="${URLS.mlrsLookup}" target="_blank" rel="noopener">MLRS</a>.</p>`);
  if (result.errors.length) parts.push(`<p class="muted">Not answered: ${esc(result.errors.join('; '))}</p>`);
  parts.push(`<h3>Collecting rules</h3><p class="disclaimer">${esc(rulesDoc.meta.disclaimer)}</p>`);
  for (const k of keys) parts.push(ruleHtml(k, rulesDoc.rules[k]));
  if (primary === 'STATE' || primary.startsWith('STATE_')) {
    const opts = Object.keys(rulesDoc.rules).filter((k) => k.startsWith('STATE_TRUST_')).map((k) => `<option value="${k}"${k.endsWith(state || '--') ? ' selected' : ''}>${esc(rulesDoc.rules[k].title)}</option>`).join('');
    parts.push(`<p><label>State trust-land rules for another state: <select id="state-rule"><option value="">choose</option>${opts}</select></label></p><div id="state-rule-out"></div>`);
  }
  parts.push(`<p class="actions"><button class="btn" id="collect-pin" data-type="${['BLM', 'USFS'].includes(primary) ? 'public' : 'private'}">Save a pin here</button></p>`);
  return parts.join('');
}
export function stateRuleHtml(key, rulesDoc) { return rulesDoc.rules[key] ? ruleHtml(key, rulesDoc.rules[key]) : ''; }
