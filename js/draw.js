// Lines drawn by tapping, with colour and dash style, and an elevation profile sampled from terrain tiles.
import { lines as lineDB } from './db.js';
import { uid, esc, fmtMiles, fmtFeet, fmtDate, lineLengthM, $, h } from './util.js';
import { openSheet, closeSheet, toast, formValues } from './ui.js';
import { profile, drawProfile } from './terrain.js';

export const LINE_COLORS = ['#c2410c', '#1d4ed8', '#15803d', '#7e22ce', '#be123c', '#0f172a'];
const EMPTY = { type: 'FeatureCollection', features: [] };

export class Drawer {
  constructor(map, { onDone }) { this.map = map; this.onDone = onDone; this.pts = []; this.active = false; }
  start() {
    this.pts = []; this.active = true;
    this.map.getCanvas().style.cursor = 'crosshair';
    $('#drawbar').hidden = false; this.hint();
  }
  hint() { $('#draw-hint').textContent = this.pts.length < 2 ? `Tap the map to add points (${this.pts.length})` : `${this.pts.length} points · ${fmtMiles(lineLengthM(this.pts))}`; }
  render() {
    const feats = this.pts.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} }));
    if (this.pts.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: this.pts }, properties: {} });
    this.map.getSource('draw')?.setData({ type: 'FeatureCollection', features: feats });
    this.hint();
  }
  add(lngLat) { this.pts.push([lngLat.lng, lngLat.lat]); this.render(); }
  undo() { this.pts.pop(); this.render(); }
  stop() {
    this.active = false; this.map.getCanvas().style.cursor = '';
    $('#drawbar').hidden = true; this.map.getSource('draw')?.setData(EMPTY);
  }
  finish() { const pts = this.pts; if (pts.length < 2) { toast('A line needs two points'); return; } this.stop(); this.onDone(pts); }
  cancel() { this.stop(); }
}

export class Lines {
  constructor(map, { theme, onChange }) { this.map = map; this.theme = theme; this.items = []; this.onChange = onChange || (() => {}); }
  async load() { this.items = await lineDB.all(); this.render(); }
  render() {
    this.map.getSource('lines')?.setData({ type: 'FeatureCollection', features: this.items.map((l) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: l.coords }, properties: { id: l.id, name: l.name, color: l.color, dash: l.dash } })) });
    this.onChange(this.items);
  }
  get(id) { return this.items.find((l) => l.id === id); }
  async add(coords, { name, color, dash, notes } = {}) {
    const line = { id: uid(), name: name || `Line ${this.items.length + 1}`, coords, color: color || LINE_COLORS[this.items.length % LINE_COLORS.length], dash: dash || 'solid', notes: notes || '', lengthM: lineLengthM(coords), profile: null, created: Date.now(), updated: Date.now() };
    await lineDB.put(line); this.items.push(line); this.render();
    return line;
  }
  async save(line) { line.updated = Date.now(); line.lengthM = lineLengthM(line.coords); await lineDB.put(line); this.render(); }
  async remove(id) { await lineDB.del(id); this.items = this.items.filter((l) => l.id !== id); this.render(); }
  async importMany(list) {
    let n = 0;
    for (const l of list) { if (!l.coords || l.coords.length < 2) continue; await this.add(l.coords, l); n++; }
    return n;
  }
  async computeProfile(line, status) {
    line.profile = await profile(line.coords, { onProgress: (k, n) => status && status(`Sampling terrain ${k}/${n}`) });
    await this.save(line);
    return line.profile;
  }
  openEditor(line) {
    const colorOpts = LINE_COLORS.map((c) => `<option value="${c}"${line.color === c ? ' selected' : ''} style="color:${c}">■ ${c}</option>`).join('');
    const body = h(`<div class="line-editor">
      <div class="row"><input name="name" class="grow" value="${esc(line.name)}" placeholder="Name" aria-label="Name"></div>
      <div class="row wrap"><label>Color <select name="color">${colorOpts}</select></label>
        <label>Style <select name="dash">${['solid', 'dashed', 'dotted'].map((d) => `<option value="${d}"${line.dash === d ? ' selected' : ''}>${d}</option>`).join('')}</select></label></div>
      <textarea name="notes" rows="2" placeholder="Notes">${esc(line.notes || '')}</textarea>
      <p class="stats"></p>
      <canvas class="profile" height="170" aria-label="Elevation profile"></canvas>
      <p class="muted status"></p>
      <div class="row wrap">
        <button class="btn" data-act="profile">Elevation profile</button>
        <button class="btn" data-act="goto">Zoom to line</button>
        <button class="btn primary" data-act="save">Save</button>
        <button class="btn danger" data-act="delete">Delete</button>
      </div>
    </div>`);
    openSheet({ title: line.name, body, tall: true });
    const stats = $('.stats', body), canvas = $('.profile', body), status = $('.status', body);
    const showStats = () => {
      const p = line.profile;
      stats.innerHTML = `<b>${fmtMiles(line.lengthM || lineLengthM(line.coords))}</b> · ${line.coords.length} points · ${fmtDate(line.updated)}` +
        (p && p.climbM != null ? `<br>Climb <b>${fmtFeet(p.climbM)}</b> · descent <b>${fmtFeet(p.descentM)}</b> · ${fmtFeet(p.minM)} to ${fmtFeet(p.maxM)}${p.complete ? '' : ' (partial: some terrain tiles missing)'}` : '<br><span class="muted">No elevation profile yet.</span>');
      if (p) drawProfile(canvas, p, this.theme()); else canvas.hidden = true;
    };
    showStats();
    const read = () => { const v = formValues(body); Object.assign(line, { name: v.name.trim() || line.name, color: v.color, dash: v.dash, notes: v.notes }); };
    body.addEventListener('click', async (e) => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'save') { read(); await this.save(line); toast('Line saved'); closeSheet(); }
      if (act === 'delete') { if (confirm(`Delete "${line.name}"?`)) { await this.remove(line.id); closeSheet(); } }
      if (act === 'goto') { const xs = line.coords.map((c) => c[0]), ys = line.coords.map((c) => c[1]); this.map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 15 }); }
      if (act === 'profile') {
        e.target.disabled = true; canvas.hidden = false;
        try { await this.computeProfile(line, (s) => { status.textContent = s; }); status.textContent = line.profile.complete ? 'Profile from AWS Terrain Tiles (terrarium), sampled every 100 ft.' : 'Some terrain tiles are not available (offline?). Partial profile.'; }
        catch (err) { status.textContent = `Profile failed: ${err.message}`; }
        e.target.disabled = false; showStats();
      }
    });
  }
  openList() {
    const items = [...this.items].sort((a, b) => b.updated - a.updated);
    const body = h(`<div class="list">${items.length ? '' : '<p class="muted">No lines yet. Use the line tool, tap points, then Done.</p>'}
      ${items.map((l) => `<button class="item" data-id="${l.id}"><span class="swatch" style="background:${l.color}"></span><span><b>${esc(l.name)}</b><br><span class="muted">${fmtMiles(l.lengthM || 0)} · ${l.dash}${l.profile && l.profile.climbM != null ? ` · climb ${fmtFeet(l.profile.climbM)}` : ''}</span></span></button>`).join('')}</div>`);
    body.addEventListener('click', (e) => { const id = e.target.closest('[data-id]')?.dataset.id; if (id) this.openEditor(this.get(id)); });
    openSheet({ title: `Lines (${items.length})`, body });
  }
}
