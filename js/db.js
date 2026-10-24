// IndexedDB: two databases.
//   hammermap        - the user's own data (pins, lines, photos), downloaded areas, feature cache, settings.
//   hammermap-cache  - accounting for every tile in the Cache API (url, bytes, last use, areas that pin it).
// The service worker opens hammermap-cache too, with the same version, so both sides agree on the schema.

const USER_DB = { name: 'hammermap', version: 1 };
const CACHE_DB = { name: 'hammermap-cache', version: 1 };

function open({ name, version }, upgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('database blocked'));
  });
}

let userDb, cacheDb;
export async function userDB() {
  if (!userDb) {
    userDb = await open(USER_DB, (db) => {
      db.createObjectStore('pins', { keyPath: 'id' }).createIndex('updated', 'updated');
      db.createObjectStore('lines', { keyPath: 'id' }).createIndex('updated', 'updated');
      db.createObjectStore('photos', { keyPath: 'id' }).createIndex('pinId', 'pinId');
      db.createObjectStore('areas', { keyPath: 'id' });
      const f = db.createObjectStore('features', { keyPath: 'key' });
      f.createIndex('t', 't');
      f.createIndex('areas', 'areas', { multiEntry: true });
      db.createObjectStore('settings', { keyPath: 'key' });
    });
  }
  return userDb;
}
export async function cacheDB() {
  if (!cacheDb) {
    cacheDb = await open(CACHE_DB, (db) => {
      const s = db.createObjectStore('tiles', { keyPath: 'url' });
      s.createIndex('t', 't');
      s.createIndex('areas', 'areas', { multiEntry: true });
    });
  }
  return cacheDb;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const reqResult = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const store = {
  async get(db, name, key) { const d = await db; return reqResult(d.transaction(name).objectStore(name).get(key)); },
  async all(db, name) { const d = await db; return reqResult(d.transaction(name).objectStore(name).getAll()); },
  async allByIndex(db, name, index, value) {
    const d = await db;
    return reqResult(d.transaction(name).objectStore(name).index(index).getAll(value));
  },
  async put(db, name, value) { const d = await db; return tx(d, name, 'readwrite', (s) => s.put(value)); },
  async putMany(db, name, values) { const d = await db; return tx(d, name, 'readwrite', (s) => { values.forEach((v) => s.put(v)); }); },
  async del(db, name, key) { const d = await db; return tx(d, name, 'readwrite', (s) => s.delete(key)); },
  async delMany(db, name, keys) { const d = await db; return tx(d, name, 'readwrite', (s) => { keys.forEach((k) => s.delete(k)); }); },
  async clear(db, name) { const d = await db; return tx(d, name, 'readwrite', (s) => s.clear()); },
  async count(db, name) { const d = await db; return reqResult(d.transaction(name).objectStore(name).count()); },
};

// Convenience wrappers for the user database.
export const pins = {
  all: () => store.all(userDB(), 'pins'),
  get: (id) => store.get(userDB(), 'pins', id),
  put: (p) => store.put(userDB(), 'pins', p),
  del: (id) => store.del(userDB(), 'pins', id),
};
export const lines = {
  all: () => store.all(userDB(), 'lines'),
  get: (id) => store.get(userDB(), 'lines', id),
  put: (l) => store.put(userDB(), 'lines', l),
  del: (id) => store.del(userDB(), 'lines', id),
};
export const photos = {
  byPin: (pinId) => store.allByIndex(userDB(), 'photos', 'pinId', pinId),
  all: () => store.all(userDB(), 'photos'),
  put: (p) => store.put(userDB(), 'photos', p),
  del: (id) => store.del(userDB(), 'photos', id),
};
export const areas = {
  all: () => store.all(userDB(), 'areas'),
  get: (id) => store.get(userDB(), 'areas', id),
  put: (a) => store.put(userDB(), 'areas', a),
  del: (id) => store.del(userDB(), 'areas', id),
};
export const features = {
  get: (key) => store.get(userDB(), 'features', key),
  put: (f) => store.put(userDB(), 'features', f),
  all: () => store.all(userDB(), 'features'),
  del: (key) => store.del(userDB(), 'features', key),
  delMany: (keys) => store.delMany(userDB(), 'features', keys),
  byArea: (areaId) => store.allByIndex(userDB(), 'features', 'areas', areaId),
};
export const settings = {
  async get(key, fallback) { const r = await store.get(userDB(), 'settings', key); return r ? r.value : fallback; },
  set: (key, value) => store.put(userDB(), 'settings', { key, value }),
};
export const tiles = {
  get: (url) => store.get(cacheDB(), 'tiles', url),
  put: (rec) => store.put(cacheDB(), 'tiles', rec),
  all: () => store.all(cacheDB(), 'tiles'),
  del: (url) => store.del(cacheDB(), 'tiles', url),
  delMany: (urls) => store.delMany(cacheDB(), 'tiles', urls),
  byArea: (areaId) => store.allByIndex(cacheDB(), 'tiles', 'areas', areaId),
};
