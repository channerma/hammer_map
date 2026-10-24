// Web Worker: parses GPX and KML (waypoints, tracks, routes, placemarks) and builds GPX/KML for export.
// Workers have no DOMParser, so this is a small tolerant XML reader sufficient for these formats.

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}
const local = (n) => n.includes(':') ? n.slice(n.indexOf(':') + 1) : n;
function tagEnd(text, i) {
  let q = null;
  for (let k = i + 1; k < text.length; k++) {
    const c = text[k];
    if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') return k;
  }
  return text.length;
}
export function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = text.length;
  const top = () => stack[stack.length - 1];
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { top().text += text.slice(i); break; }
    if (lt > i) top().text += text.slice(i, lt);
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt); top().text += text.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) { const e = text.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    const gt = tagEnd(text, lt);
    const raw = text.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (raw[0] === '/') {
      const name = local(raw.slice(1).trim());
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === name) { stack.length = k; break; }
      continue;
    }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const m = body.match(/^(\S+)([\s\S]*)$/);
    if (!m) continue;
    const el = { name: local(m[1]), attrs: {}, children: [], text: '' };
    const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = re.exec(m[2] || ''))) el.attrs[local(a[1])] = decode(a[2] ?? a[3] ?? '');
    top().children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root;
}
const child = (el, name) => el.children.find((c) => c.name === name);
const children = (el, name) => el.children.filter((c) => c.name === name);
const textOf = (el, name) => { const c = name ? child(el, name) : el; return c ? decode(c.text).trim() : ''; };
function findAll(el, name, out = []) { for (const c of el.children) { if (c.name === name) out.push(c); findAll(c, name, out); } return out; }
function ext(el, key) { const e = child(el, 'extensions'); return e ? textOf(e, key) : ''; }
const truthy = (v) => v === '1' || v === 'true' || v === 'yes';

export function parseGpx(root) {
  const pins = [], lines = [];
  for (const w of findAll(root, 'wpt')) {
    pins.push({ lng: +w.attrs.lon, lat: +w.attrs.lat, name: textOf(w, 'name'), notes: textOf(w, 'desc') || textOf(w, 'cmt'), type: textOf(w, 'type') || ext(w, 'type'), fav: truthy(ext(w, 'fav')), best: truthy(ext(w, 'best')), time: textOf(w, 'time') });
  }
  for (const t of findAll(root, 'trk')) {
    const coords = [];
    for (const seg of children(t, 'trkseg')) for (const p of children(seg, 'trkpt')) coords.push([+p.attrs.lon, +p.attrs.lat]);
    if (coords.length > 1) lines.push({ name: textOf(t, 'name'), notes: textOf(t, 'desc'), coords, color: ext(t, 'color'), dash: ext(t, 'dash') });
  }
  for (const r of findAll(root, 'rte')) {
    const coords = children(r, 'rtept').map((p) => [+p.attrs.lon, +p.attrs.lat]);
    if (coords.length > 1) lines.push({ name: textOf(r, 'name'), notes: textOf(r, 'desc'), coords, color: ext(r, 'color'), dash: ext(r, 'dash') });
  }
  return { pins, lines };
}
const parseCoords = (s) => s.trim().split(/\s+/).map((t) => t.split(',').map(Number)).filter((c) => c.length >= 2 && c.every((v, i) => i > 1 || Number.isFinite(v))).map((c) => [c[0], c[1]]);
export function parseKml(root) {
  const pins = [], lines = [];
  for (const pm of findAll(root, 'Placemark')) {
    const data = {};
    for (const d of findAll(pm, 'Data')) data[d.attrs.name] = textOf(d, 'value');
    const base = { name: textOf(pm, 'name'), notes: textOf(pm, 'description') || data.notes || '', type: data.type || '', fav: truthy(data.fav || ''), best: truthy(data.best || ''), color: data.color || '', dash: data.dash || '' };
    for (const pt of findAll(pm, 'Point')) { const c = parseCoords(textOf(pt, 'coordinates')); if (c.length) pins.push({ ...base, lng: c[0][0], lat: c[0][1] }); }
    for (const ls of [...findAll(pm, 'LineString'), ...findAll(pm, 'LinearRing')]) { const c = parseCoords(textOf(ls, 'coordinates')); if (c.length > 1) lines.push({ ...base, coords: c }); }
  }
  return { pins, lines };
}
export function parseAny(name, text) {
  const root = parseXml(text);
  if (findAll(root, 'gpx').length || /\.gpx$/i.test(name)) return parseGpx(root);
  if (findAll(root, 'kml').length || /\.kml$/i.test(name)) return parseKml(root);
  const both = parseGpx(root); const k = parseKml(root);
  return { pins: [...both.pins, ...k.pins], lines: [...both.lines, ...k.lines] };
}

const X = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
export function buildGpx(pins, lines) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<gpx version="1.1" creator="Hammer Map" xmlns="http://www.topografix.com/GPX/1/1" xmlns:hm="urn:hammermap:gpx:1">'];
  for (const p of pins) {
    out.push(`<wpt lat="${p.lat}" lon="${p.lng}"><time>${new Date(p.created || Date.now()).toISOString()}</time><name>${X(p.name)}</name><desc>${X(p.notes)}</desc><type>${X(p.type)}</type><extensions><hm:type>${X(p.type)}</hm:type><hm:fav>${p.fav ? 1 : 0}</hm:fav><hm:best>${p.best ? 1 : 0}</hm:best></extensions></wpt>`);
  }
  for (const l of lines) {
    out.push(`<trk><name>${X(l.name)}</name><desc>${X(l.notes)}</desc><extensions><hm:color>${X(l.color)}</hm:color><hm:dash>${X(l.dash)}</hm:dash></extensions><trkseg>${l.coords.map((c) => `<trkpt lat="${c[1]}" lon="${c[0]}"/>`).join('')}</trkseg></trk>`);
  }
  out.push('</gpx>');
  return out.join('\n');
}
export function buildKml(pins, lines) {
  const data = (o) => `<ExtendedData>${Object.entries(o).map(([k, v]) => `<Data name="${k}"><value>${X(v)}</value></Data>`).join('')}</ExtendedData>`;
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Hammer Map export</name>'];
  for (const p of pins) out.push(`<Placemark><name>${X(p.name)}</name><description>${X(p.notes)}</description>${data({ type: p.type, fav: p.fav ? 1 : 0, best: p.best ? 1 : 0 })}<Point><coordinates>${p.lng},${p.lat},0</coordinates></Point></Placemark>`);
  for (const l of lines) out.push(`<Placemark><name>${X(l.name)}</name><description>${X(l.notes)}</description>${data({ color: l.color, dash: l.dash })}<LineString><tessellate>1</tessellate><coordinates>${l.coords.map((c) => `${c[0]},${c[1]},0`).join(' ')}</coordinates></LineString></Placemark>`);
  out.push('</Document></kml>');
  return out.join('\n');
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = (e) => {
    const { id, type, name, text, format, pins, lines } = e.data;
    try {
      if (type === 'parse') self.postMessage({ id, result: parseAny(name || '', text) });
      else if (type === 'build') self.postMessage({ id, result: format === 'kml' ? buildKml(pins, lines) : buildGpx(pins, lines) });
      else throw new Error(`unknown message ${type}`);
    } catch (err) { self.postMessage({ id, error: err.message }); }
  };
}
