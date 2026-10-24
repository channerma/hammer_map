// Every URL here answered a real request from the build machine on 2026-10-24 (see README, "Data sources").
// None needs a key. Nothing of the user's is ever sent to them beyond the map area being looked at.

export const APP_NAME = 'Hammer Map';
export const APP_VERSION = '0.1.0';
export const SW_VERSION = 'v1';

export const MAPLIBRE = {
  js: 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.js',
  css: 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.css',
};

export const URLS = {
  // Basemaps
  ofmStyle: 'https://tiles.openfreemap.org/styles/liberty',
  ofmTileJson: 'https://tiles.openfreemap.org/planet',
  ofmGlyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  usgsTopo: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
  usgsImagery: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
  usgsImageryTopo: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
  // Terrain (terrarium PNG: height = R*256 + G + B/256 - 32768)
  terrain: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  // Land ownership
  padusTiles: 'https://tiles.arcgis.com/tiles/v01gqwM5QqNysAAi/arcgis/rest/services/PADUS_Management_Areas_Manager_Type/VectorTileServer/tile/{z}/{y}/{x}.pbf',
  padusQuery: 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Manager_Name_PADUS/FeatureServer/0/query',
  smaWestTiles: 'https://tiles.arcgis.com/tiles/T4QMspbfLg3qTGWY/arcgis/rest/services/West_US_SMA/VectorTileServer/tile/{z}/{y}/{x}.pbf',
  smaRasterTiles: 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_with_PriUnk/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&layers=show:19,20,21,22,23,24,25,26,27,28,29,30&transparent=true&format=png32&f=image',
  smaQuery: 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/1/query',
  // Mining claims (BLM MLRS)
  claimsOpen: 'https://nlsdbpubgis.blm.gov/arcgishub/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/FeatureServer/0/query',
  claimsClosed: 'https://nlsdbpubgis.blm.gov/arcgishub/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Closed/FeatureServer/0/query',
  mlrsLookup: 'https://mlrs.blm.gov/s/',
  // Records
  mrds: 'https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/Mineral_Resources_Data_System_MRDS_Compact_Version/FeatureServer/0/query',
  pbdb: 'https://paleobiodb.org/data1.2/occs/list.json',
  // Live conditions
  nifc: 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query',
  snowTiles: 'https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&layers=show:3&transparent=true&format=png32&f=image&t={bucket}',
  rainTiles: 'https://mapservices.weather.noaa.gov/raster/rest/services/obs/rfc_qpe/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&layers=show:25&transparent=true&format=png32&f=image&t={bucket}',
};

export const ATTRIBUTION = {
  ofm: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
  usgs: 'USGS The National Map',
  terrain: 'Terrain: AWS Terrain Tiles (Mapzen terrarium; USGS 3DEP, SRTM, GMTED and others)',
  padus: 'USGS PAD-US 4.1',
  sma: 'BLM Surface Management Agency',
  nifc: 'NIFC WFIGS',
  noaa: 'NOAA NWS / NOHRSC',
};

// Live layers expire after these times; they are fetched only when switched on.
export const LIVE_TTL = { fire: 30 * 60e3, snow: 6 * 3600e3, rain: 60 * 60e3 };

// Zoom at which each feature layer fetches its "data tiles", and the map zoom it needs to draw.
export const DATA = {
  claims: { z: 12, minzoom: 11 },
  records: { z: 10, minzoom: 9 },
  fire: { z: 6, minzoom: 5 },
  padusUnits: { z: 11, minzoom: 99 }, // offline identify only; never drawn
};

export const DEFAULTS = {
  theme: 'auto',
  basemap: 'vector', // vector | topo | imagery | imagerytopo
  cacheCapMB: 150,
  center: [-84.27, 36.01], // Oak Ridge, Tennessee
  zoom: 11,
  layers: { padus: true, smaWest: true, smaRaster: false, claimsOpen: true, claimsClosed: true, mrds: false, pbdb: false, fire: false, snow: false, rain: false },
};

// Photo storage limits (persistent data stays small).
export const PHOTO = { maxPx: 1280, quality: 0.7 };

// OpenFreeMap's published offline policy: at most 3,000 tiles or 50 MB per download, 4 parallel requests.
export const OFM_DOWNLOAD = { maxTiles: 3000, maxBytes: 50 * 1024 * 1024, parallel: 4 };

// Measured on 2026-10-24 from the build machine; replaced by running averages once tiles are cached.
export const DEFAULT_TILE_BYTES = {
  ofm: 45000, usgs: 30000, terrain: 130000, padus: 4000, smaWest: 3500, smaRaster: 6000, live: 5000, data: 60000,
};
