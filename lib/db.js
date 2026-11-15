// IndexedDB store for per-case drafts (notes, chosen status, timer) and the
// screenshot queue. Everything is keyed by instance + run + case so switching
// runs or instances never mixes evidence.

const DB_NAME = 'testmo-companion';
const DB_VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('shots')) {
        const s = db.createObjectStore('shots', { keyPath: 'id', autoIncrement: true });
        s.createIndex('byCase', 'caseKey', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function caseKey(instanceUrl, runId, caseId) {
  return `${instanceUrl}|${runId}|${caseId}`;
}

export async function getDraft(key) {
  const db = await open();
  const r = await tx(db, 'drafts', 'readonly', (s) => s.get(key));
  db.close();
  return r || null;
}

export async function saveDraft(key, patch) {
  const db = await open();
  const existing = (await tx(db, 'drafts', 'readonly', (s) => s.get(key))) || { key };
  const next = { ...existing, ...patch, key, updatedAt: Date.now() };
  await tx(db, 'drafts', 'readwrite', (s) => s.put(next));
  db.close();
  return next;
}

export async function deleteDraft(key) {
  const db = await open();
  await tx(db, 'drafts', 'readwrite', (s) => s.delete(key));
  db.close();
}

export async function listDraftsForRun(instanceUrl, runId) {
  const db = await open();
  const all = await tx(db, 'drafts', 'readonly', (s) => s.getAll());
  db.close();
  const prefix = `${instanceUrl}|${runId}|`;
  return (all || []).filter((d) => d.key.startsWith(prefix));
}

export async function addShot(caseKeyValue, blob, meta = {}) {
  const db = await open();
  const id = await tx(db, 'shots', 'readwrite', (s) => s.add({ caseKey: caseKeyValue, blob, createdAt: Date.now(), ...meta }));
  db.close();
  return id;
}

export async function getShot(id) {
  const db = await open();
  const r = await tx(db, 'shots', 'readonly', (s) => s.get(Number(id)));
  db.close();
  return r || null;
}

export async function updateShot(id, patch) {
  const db = await open();
  const existing = await tx(db, 'shots', 'readonly', (s) => s.get(Number(id)));
  if (!existing) {
    db.close();
    throw new Error('Screenshot no longer exists.');
  }
  const next = { ...existing, ...patch, id: existing.id };
  await tx(db, 'shots', 'readwrite', (s) => s.put(next));
  db.close();
  return next;
}

export async function listShots(caseKeyValue) {
  const db = await open();
  const r = await new Promise((resolve, reject) => {
    const t = db.transaction('shots', 'readonly');
    const req = t.objectStore('shots').index('byCase').getAll(caseKeyValue);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return r.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteShot(id) {
  const db = await open();
  await tx(db, 'shots', 'readwrite', (s) => s.delete(Number(id)));
  db.close();
}

export async function deleteShotsForCase(caseKeyValue) {
  const shots = await listShots(caseKeyValue);
  for (const s of shots) await deleteShot(s.id);
}

export async function countShotsForRun(instanceUrl, runId) {
  const db = await open();
  const all = await tx(db, 'shots', 'readonly', (s) => s.getAll());
  db.close();
  const prefix = `${instanceUrl}|${runId}|`;
  const counts = new Map();
  for (const s of all || []) {
    if (!s.caseKey.startsWith(prefix)) continue;
    const caseId = Number(s.caseKey.slice(prefix.length));
    counts.set(caseId, (counts.get(caseId) || 0) + 1);
  }
  return counts;
}

export async function wipeAll() {
  const db = await open();
  await tx(db, 'drafts', 'readwrite', (s) => s.clear());
  await tx(db, 'shots', 'readwrite', (s) => s.clear());
  db.close();
}
