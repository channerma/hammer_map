// Import GPX/KML (parsed in a Web Worker), export GPX/KML, JSON backup and restore.
import { pins as pinDB, lines as lineDB, photos as photoDB } from './db.js';
import { downloadText, $ } from './util.js';
import { toast } from './ui.js';

let worker = null, seq = 0;
const pending = new Map();
function getWorker() {
  if (!worker) {
    worker = new Worker('workers/parse.js', { type: 'module' });
    worker.onmessage = (e) => { const { id, result, error } = e.data; const p = pending.get(id); pending.delete(id); if (!p) return; error ? p.reject(new Error(error)) : p.resolve(result); };
  }
  return worker;
}
export function askWorker(msg) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); getWorker().postMessage({ id, ...msg }); });
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
export async function exportGpx(pins, lines) { downloadText(`hammer-map-${stamp()}.gpx`, await askWorker({ type: 'build', format: 'gpx', pins, lines }), 'application/gpx+xml'); }
export async function exportKml(pins, lines) { downloadText(`hammer-map-${stamp()}.kml`, await askWorker({ type: 'build', format: 'kml', pins, lines }), 'application/vnd.google-earth.kml+xml'); }

const blobToDataUrl = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
export async function exportBackup({ includePhotos }) {
  const [p, l, ph] = await Promise.all([pinDB.all(), lineDB.all(), includePhotos ? photoDB.all() : []]);
  const photos = [];
  for (const x of ph) photos.push({ ...x, blob: await blobToDataUrl(x.blob) });
  downloadText(`hammer-map-backup-${stamp()}.json`, JSON.stringify({ app: 'Hammer Map', version: 1, exported: new Date().toISOString(), pins: p, lines: l, photos }), 'application/json');
}
export async function restoreBackup(json, { pinsCtl, linesCtl }) {
  const data = JSON.parse(json);
  if (!data || data.app !== 'Hammer Map') throw new Error('Not a Hammer Map backup');
  let n = 0;
  for (const p of data.pins || []) { await pinDB.put(p); n++; }
  for (const l of data.lines || []) { await lineDB.put(l); n++; }
  for (const ph of data.photos || []) {
    const blob = await (await fetch(ph.blob)).blob();
    await photoDB.put({ ...ph, blob, bytes: blob.size });
  }
  await pinsCtl.load(); await linesCtl.load();
  return n;
}

export function pickFile({ pinsCtl, linesCtl }) {
  const input = $('#file-import');
  input.onchange = async () => {
    const f = input.files[0]; input.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      if (/\.json$/i.test(f.name) || text.trim().startsWith('{')) { const n = await restoreBackup(text, { pinsCtl, linesCtl }); toast(`Restored ${n} items`); return; }
      const { pins, lines } = await askWorker({ type: 'parse', name: f.name, text });
      const np = await pinsCtl.importMany(pins), nl = await linesCtl.importMany(lines);
      toast(`Imported ${np} pins and ${nl} lines`);
    } catch (e) { toast(`Import failed: ${e.message}`, 5000); }
  };
  input.click();
}
