// Bottom sheet, toasts and the status pill. One sheet; its content is swapped.
import { $ } from './util.js';

let onCloseCb = null;

export function toast(msg, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}

export function setStatus(text, cls = '') {
  const el = $('#status');
  el.textContent = text; el.className = `pill ${cls}`;
}

export function openSheet({ title, body, onClose, tall = false }) {
  const sheet = $('#sheet');
  if (onCloseCb) { const cb = onCloseCb; onCloseCb = null; cb(); }
  $('#sheet-title').textContent = title;
  const bodyEl = $('#sheet-body');
  bodyEl.innerHTML = '';
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  bodyEl.scrollTop = 0;
  sheet.hidden = false;
  sheet.classList.toggle('tall', tall);
  onCloseCb = onClose || null;
  return bodyEl;
}
export function closeSheet() {
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  sheet.hidden = true;
  if (onCloseCb) { const cb = onCloseCb; onCloseCb = null; cb(); }
}
export const isSheetOpen = () => !$('#sheet').hidden;
export const sheetBody = () => $('#sheet-body');

export function initSheet() {
  const sheet = $('#sheet');
  $('#sheet-close').addEventListener('click', closeSheet);
  // drag the handle down to close; up to make it tall
  let y0 = null;
  const handle = $('#sheet .handle');
  handle.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  handle.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0; y0 = null;
    if (dy > 40) closeSheet(); else if (dy < -40) sheet.classList.add('tall');
  });
  handle.addEventListener('click', () => sheet.classList.toggle('tall'));
}

// A tiny form helper: values of inputs inside a root by name.
export function formValues(root) {
  const out = {};
  for (const el of root.querySelectorAll('[name]')) out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  return out;
}
