// Map creation, basemap switching, 3D terrain on demand, and the GPS locator.
import { URLS, ATTRIBUTION } from './config.js';
import { buildStyle, makeIcons } from './style.js';
import { settings, areas } from './db.js';
import { withTimeout, circlePolygon } from './util.js';

export const BASEMAPS = {
  vector: 'OpenFreeMap Liberty (vector)', topo: 'USGS Topo', imagery: 'USGS Imagery', imagerytopo: 'USGS Imagery + Topo',
};

// Network-first for the basemap style and tile template (the service worker answers from cache offline).
export async function loadOfm() {
  try {
    const [style, tj] = await Promise.all([
      withTimeout(fetch(URLS.ofmStyle).then((r) => r.json()), 9000, 'basemap style'),
      withTimeout(fetch(URLS.ofmTileJson).then((r) => r.json()), 9000, 'basemap tilejson'),
    ]);
    let template = tj.tiles?.[0];
    if (!navigator.onLine) { // prefer the template a downloaded area was made with
      const latest = (await areas.all()).sort((a, b) => b.created - a.created).find((a) => a.ofmTemplate);
      if (latest) template = latest.ofmTemplate;
    }
    if (template) await settings.set('ofmTemplate', template);
    return { style, template };
  } catch (e) {
    return { style: null, template: await settings.get('ofmTemplate'), error: e.message };
  }
}

export async function createMap(container, { theme, basemap, center, zoom }) {
  const ofm = await loadOfm();
  const style = buildStyle({ ofm: ofm.style, ofmTemplate: ofm.template, theme });
  const map = new maplibregl.Map({
    container, style, center, zoom, attributionControl: false, maxPitch: 70, fadeDuration: 0, pitchWithRotate: true,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 120 }), 'bottom-left');
  map.touchZoomRotate.enableRotation();
  await new Promise((resolve) => map.once('load', resolve));
  makeIcons(map);
  const hasVector = !!ofm.style;
  setBasemap(map, basemap, hasVector);
  return { map, hasVector, ofmError: ofm.error };
}

export function setBasemap(map, name, hasVector) {
  const ids = map.getStyle().metadata?.ofmLayerIds || [];
  const vector = name === 'vector' && hasVector;
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vector ? 'visible' : 'none');
  const want = vector ? null : (name === 'vector' ? 'topo' : name);
  for (const r of ['topo', 'imagery', 'imagerytopo']) map.setLayoutProperty(`usgs-${r}`, 'visibility', want === r ? 'visible' : 'none');
}

export function setTerrain(map, on) {
  if (on) {
    if (!map.getSource('terrain-dem')) {
      map.addSource('terrain-dem', { type: 'raster-dem', tiles: [URLS.terrain], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: ATTRIBUTION.terrain });
    }
    if (!map.getLayer('hillshade')) map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'terrain-dem', paint: { 'hillshade-exaggeration': 0.35 } }, 'padus-fill');
    map.setTerrain({ source: 'terrain-dem', exaggeration: 1.2 });
    if (map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 600 });
  } else {
    map.setTerrain(null);
    map.easeTo({ pitch: 0, duration: 400 });
    if (map.getLayer('hillshade')) map.removeLayer('hillshade');
    setTimeout(() => { try { if (map.getSource('terrain-dem')) map.removeSource('terrain-dem'); } catch { /* still in use */ } }, 800);
  }
}

// GPS: watchPosition with an accuracy circle and a heading arrow (device orientation when the browser offers it).
export function makeLocator(map, onStatus) {
  let watchId = null, follow = true, heading = null, last = null;
  const render = () => {
    if (!last) return;
    const { lng, lat, acc } = last;
    const feats = [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: heading == null ? {} : { heading } }];
    if (acc) feats.unshift({ type: 'Feature', geometry: circlePolygon([lng, lat], acc), properties: {} });
    map.getSource('location')?.setData({ type: 'FeatureCollection', features: feats });
  };
  const onOrient = (ev) => {
    const h = ev.webkitCompassHeading != null ? ev.webkitCompassHeading : (ev.absolute && ev.alpha != null ? 360 - ev.alpha : null);
    if (h != null) { heading = Math.round(h); render(); }
  };
  async function start() {
    if (!navigator.geolocation) { onStatus('This browser has no geolocation. GPS needs https or localhost.'); return; }
    try { if (typeof DeviceOrientationEvent?.requestPermission === 'function') await DeviceOrientationEvent.requestPermission(); } catch { /* denied */ }
    window.addEventListener('deviceorientationabsolute', onOrient);
    window.addEventListener('deviceorientation', onOrient);
    watchId = navigator.geolocation.watchPosition((p) => {
      last = { lng: p.coords.longitude, lat: p.coords.latitude, acc: p.coords.accuracy };
      if (p.coords.heading != null && !Number.isNaN(p.coords.heading) && p.coords.speed > 0.5) heading = Math.round(p.coords.heading);
      render();
      onStatus(`GPS ±${Math.round(p.coords.accuracy * 3.28084)} ft`);
      if (follow) { map.easeTo({ center: [last.lng, last.lat], zoom: Math.max(map.getZoom(), 14), duration: 500 }); follow = false; }
    }, (err) => onStatus(`GPS: ${err.message}`), { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function stop() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null; last = null; heading = null;
    window.removeEventListener('deviceorientationabsolute', onOrient);
    window.removeEventListener('deviceorientation', onOrient);
    map.getSource('location')?.setData({ type: 'FeatureCollection', features: [] });
  }
  return { start, stop, get active() { return watchId != null; }, get position() { return last; }, recenter() { follow = true; render(); if (last) map.easeTo({ center: [last.lng, last.lat] }); } };
}
