// Pins: the user's own spots. Stored in IndexedDB; drawn as a symbol layer; photos resized to 1280 px JPEG.
import { pins as pinDB, photos as photoDB } from './db.js';
import { PIN_TYPES, pinIconDataUrl } from './style.js';
import { PHOTO } from './config.js';
import { uid, esc, fmtCoord, fmtDate, fmtBytes, $, h } from './util.js';
import { openSheet, closeSheet, toast, formValues } from './ui.js';

export class Pins {
  constructor(map, { onCollect, onChange }) {
    this.map = map; this.onCollect = onCollect; this.onChange = onChange || (() => {});
    this.items = [];
  }
  async load() { this.items = await pinDB.all(); this.render(); }
  toFeature(p) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, name: p.name || '', type: p.type || 'other', fav: !!p.fav, best: !!p.best } };
  }
  render() {
    this.map.getSource('pins')?.setData({ type: 'FeatureCollection', features: this.items.map((p) => this.toFeature(p)) });
    this.onChange(this.items);
  }
  get(id) { return this.items.find((p) => p.id === id); }
  async add({ lng, lat, type = 'other', name = '' }, open = true) {
    const pin = { id: uid(), lng, lat, type, name: name || `Spot ${this.items.length + 1}`, notes: '', fav: false, best: false, created: Date.now(), updated: Date.now() };
    await pinDB.put(pin);
    this.items.push(pin); this.render();
    if (open) this.openEditor(pin);
    return pin;
  }
  async save(pin) {
    pin.updated = Date.now();
    await pinDB.put(pin);
    const i = this.items.findIndex((p) => p.id === pin.id);
    if (i >= 0) this.items[i] = pin; else this.items.push(pin);
    this.render();
  }
  async remove(id) {
    for (const ph of await photoDB.byPin(id)) await photoDB.del(ph.id);
    await pinDB.del(id);
    this.items = this.items.filter((p) => p.id !== id);
    this.render();
  }
  async importMany(list) {
    let n = 0;
    for (const p of list) {
      const pin = { id: uid(), lng: +p.lng, lat: +p.lat, type: PIN_TYPES[p.type] ? p.type : 'other', name: p.name || 'Imported spot', notes: p.notes || '', fav: !!p.fav, best: !!p.best, created: p.created || Date.now(), updated: Date.now() };
      if (!Number.isFinite(pin.lng) || !Number.isFinite(pin.lat)) continue;
      await pinDB.put(pin); this.items.push(pin); n++;
    }
    this.render();
    return n;
  }

  // ---- photos -----------------------------------------------------------
  async addPhoto(pin, file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO.maxPx / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', PHOTO.quality));
    const photo = { id: uid(), pinId: pin.id, blob, bytes: blob.size, w: c.width, h: c.height, created: Date.now() };
    await photoDB.put(photo);
    return photo;
  }

  // ---- sheets -----------------------------------------------------------
  async openEditor(pin) {
    const opts = Object.entries(PIN_TYPES).map(([k, v]) => `<option value="${k}"${pin.type === k ? ' selected' : ''}>${esc(v.label)}</option>`).join('');
    const body = h(`<div class="pin-editor">
      <div class="row"><img class="pin-icon" alt="" src="${pinIconDataUrl(pin.type, pin)}"><input name="name" class="grow" value="${esc(pin.name)}" placeholder="Name" aria-label="Name"></div>
      <div class="row"><label>Type <select name="type">${opts}</select></label></div>
      <div class="row toggles"><label><input type="checkbox" name="fav"${pin.fav ? ' checked' : ''}> Favorite</label><label><input type="checkbox" name="best"${pin.best ? ' checked' : ''}> Best spot</label></div>
      <textarea name="notes" rows="3" placeholder="Notes: what you found, access, who you asked">${esc(pin.notes || '')}</textarea>
      <p class="muted">${fmtCoord(pin.lng, pin.lat)} · saved ${fmtDate(pin.updated)}</p>
      <div class="photos"></div>
      <div class="row wrap">
        <button class="btn" data-act="photo">Add photo</button>
        <button class="btn" data-act="collect">Can I collect here?</button>
        <button class="btn" data-act="goto">Center map</button>
        <button class="btn primary" data-act="save">Save</button>
        <button class="btn danger" data-act="delete">Delete</button>
      </div>
    </div>`);
    openSheet({ title: pin.name || 'Pin', body });
    const photosEl = $('.photos', body);
    const renderPhotos = async () => {
      photosEl.innerHTML = '';
      const list = await photoDB.byPin(pin.id);
      for (const ph of list) {
        const url = URL.createObjectURL(ph.blob);
        const el = h(`<figure><img src="${url}" alt=""><figcaption>${ph.w}×${ph.h} · ${fmtBytes(ph.bytes)} <button class="link" data-del="${ph.id}">remove</button></figcaption></figure>`);
        el.querySelector('[data-del]').addEventListener('click', async () => { await photoDB.del(ph.id); URL.revokeObjectURL(url); renderPhotos(); });
        photosEl.appendChild(el);
      }
      if (!list.length) photosEl.innerHTML = '<p class="muted">No photos. Photos stay on this phone, resized to 1280 px.</p>';
    };
    renderPhotos();
    const read = () => { const v = formValues(body); Object.assign(pin, { name: v.name.trim() || pin.name, type: v.type, fav: v.fav, best: v.best, notes: v.notes }); };
    body.addEventListener('change', (e) => { if (e.target.name === 'type' || e.target.name === 'fav' || e.target.name === 'best') { read(); $('.pin-icon', body).src = pinIconDataUrl(pin.type, pin); } });
    body.addEventListener('click', async (e) => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'save') { read(); await this.save(pin); toast('Pin saved'); closeSheet(); }
      if (act === 'delete') { if (confirm(`Delete "${pin.name}" and its photos?`)) { await this.remove(pin.id); closeSheet(); toast('Pin deleted'); } }
      if (act === 'goto') this.map.flyTo({ center: [pin.lng, pin.lat], zoom: Math.max(this.map.getZoom(), 14) });
      if (act === 'collect') { read(); await this.save(pin); this.onCollect({ lng: pin.lng, lat: pin.lat }); }
      if (act === 'photo') {
        const input = $('#file-photo');
        input.onchange = async () => {
          const f = input.files[0]; input.value = '';
          if (!f) return;
          try { const ph = await this.addPhoto(pin, f); toast(`Photo stored (${fmtBytes(ph.bytes)})`); renderPhotos(); }
          catch (err) { toast(`Photo failed: ${err.message}`); }
        };
        input.click();
      }
    });
  }
  openList() {
    const items = [...this.items].sort((a, b) => b.updated - a.updated);
    const body = h(`<div class="list">${items.length ? '' : '<p class="muted">No pins yet. Tap the map, then "Save a pin here"; or long-press the + button.</p>'}
      ${items.map((p) => `<button class="item" data-id="${p.id}"><img alt="" src="${pinIconDataUrl(p.type, p)}"><span><b>${esc(p.name)}</b><br><span class="muted">${esc(PIN_TYPES[p.type]?.label || p.type)} · ${fmtCoord(p.lng, p.lat)}</span></span></button>`).join('')}
    </div>`);
    body.addEventListener('click', (e) => {
      const id = e.target.closest('[data-id]')?.dataset.id; if (!id) return;
      const pin = this.get(id);
      this.map.flyTo({ center: [pin.lng, pin.lat], zoom: Math.max(this.map.getZoom(), 14) });
      this.openEditor(pin);
    });
    openSheet({ title: `Pins (${items.length})`, body });
  }
}
