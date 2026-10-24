// More raster basemaps, from the list in the HCMGIS QGIS plugin (github.com/opengeoshub/HCMGIS, hcmgis_library.py,
// commit f11ee9a of 2026-08-31). Every one shown answered a tile request with a cross-origin header from the build
// machine on 2026-10-24. The README ("More basemaps") lists all 33 HCMGIS services and why some are not shown.
// They are online only: their terms were not checked for bulk download, so offline areas skip them and the
// service worker does not keep their tiles. Credits are each Esri service's own copyrightText.
const ESRI = 'https://server.arcgisonline.com/arcgis/rest/services/';
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors';
const ESRI_HERE = 'Esri, HERE, Garmin, (c) OpenStreetMap contributors, and the GIS user community';

const esri = (id, name, path, maxzoom, credit) => ({
  id, name, group: 'Esri', url: `${ESRI}${path}/MapServer/tile/{z}/{y}/{x}`, maxzoom,
  attribution: `Powered by <a href="https://www.esri.com" target="_blank">Esri</a> · ${credit}`,
});
// CARTO answers every tile without a key with an "API KEY REQUIRED" picture. The key is free for non-commercial use
// (carto.com/basemaps/apikey); each person pastes their own in Settings and it goes only to CARTO, as ?key=.
const carto = (id, name, path) => ({
  id, name, group: 'CARTO (needs a free key)', url: `https://a.basemaps.cartocdn.com/${path}/{z}/{x}/{y}.png`, maxzoom: 20, key: 'carto',
  attribution: `${OSM} &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>`,
});
// Switched off: these addresses answer, but the providers' terms allow their tiles only through their own APIs
// with a key. Delete the `off` field of an entry to show it in the picker anyway.
const GOOGLE_OFF = 'Google Maps Platform terms allow Google map tiles only through its APIs, with a key.';
const BING_OFF = 'Bing tiles need a Bing Maps key; Microsoft is retiring Bing Maps accounts in favour of Azure Maps.';
const google = (id, name, lyrs) => ({
  id, name, group: 'Google and Bing', url: `https://mt1.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}`, maxzoom: 20,
  attribution: 'Map data &copy; Google', off: GOOGLE_OFF,
});

export const EXTRA_BASEMAPS = [
  esri('esri-imagery', 'Esri Imagery', 'World_Imagery', 19, 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community'),
  esri('esri-topo', 'Esri Topographic', 'World_Topo_Map', 19, 'Sources: Esri, HERE, Garmin, Intermap, increment P Corp., GEBCO, USGS, FAO, NPS, NRCAN, GeoBase, IGN, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), (c) OpenStreetMap contributors, and the GIS User Community'),
  esri('esri-street', 'Esri Street', 'World_Street_Map', 19, 'Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, (c) OpenStreetMap contributors, and the GIS User Community'),
  esri('esri-natgeo', 'Esri National Geographic', 'NatGeo_World_Map', 16, 'National Geographic, Esri, Garmin, HERE, UNEP-WCMC, USGS, NASA, ESA, METI, NRCAN, GEBCO, NOAA, increment P Corp.'),
  esri('esri-terrain', 'Esri Terrain', 'World_Terrain_Base', 13, 'Sources: Esri, USGS, NOAA'),
  esri('esri-relief', 'Esri Shaded Relief', 'World_Shaded_Relief', 13, 'Copyright: (c) 2014 Esri'),
  esri('esri-physical', 'Esri Physical', 'World_Physical_Map', 8, 'Source: US National Park Service'),
  esri('esri-lightgray', 'Esri Light Gray', 'Canvas/World_Light_Gray_Base', 16, ESRI_HERE),
  esri('esri-darkgray', 'Esri Dark Gray', 'Canvas/World_Dark_Gray_Base', 16, ESRI_HERE),
  carto('carto-light', 'CARTO Light', 'light_all'),
  carto('carto-dark', 'CARTO Dark', 'dark_all'),
  carto('carto-voyager', 'CARTO Voyager', 'rastertiles/voyager'),
  { id: 'f4-2d', name: 'F4 Map 2D', group: 'Other', url: 'https://tile1.f4map.com/tiles/f4_2d/{z}/{x}/{y}.png', maxzoom: 19, attribution: `<a href="https://www.f4map.com" target="_blank">F4map</a> · ${OSM}` },
  { id: 'hcmc-onemap', name: 'HCMC OneMap (Ho Chi Minh City)', group: 'Other', url: 'https://bando.tphcm.gov.vn/service/gisp/tile/raster/{z}/{x}/{y}', maxzoom: 19, attribution: 'HCMC OneMap, bando.tphcm.gov.vn' },
  google('google-map', 'Google Maps', 'm'),
  google('google-sat', 'Google Satellite', 's'),
  google('google-hybrid', 'Google Satellite Hybrid', 'y'),
  google('google-terrain', 'Google Terrain Hybrid', 'p'),
  { id: 'bing-aerial', name: 'Bing Virtual Earth', group: 'Google and Bing', url: 'https://ecn.t3.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=1', maxzoom: 19, attribution: '&copy; Microsoft', off: BING_OFF },
];
export const SHOWN_BASEMAPS = EXTRA_BASEMAPS.filter((b) => !b.off);

// Esri Boundaries and Places is transparent (place names and borders only), so it is an overlay for any basemap.
export const PLACES_OVERLAY = esri('esri-places', 'Place names and boundaries (Esri)', 'Reference/World_Boundaries_and_Places', 16, ESRI_HERE);

export const extraBasemap = (id) => SHOWN_BASEMAPS.find((b) => b.id === id);
export const usable = (b, keys) => !b.key || !!keys?.[b.key];
export const basemapTiles = (b, keys) => (b.key && keys?.[b.key] ? `${b.url}?key=${encodeURIComponent(keys[b.key])}` : b.url);
