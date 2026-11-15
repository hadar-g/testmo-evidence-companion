// Settings live in chrome.storage.local (non-secret). The API key lives in
// chrome.storage.session (in-memory, cleared when Chrome closes) unless the
// user opts into "remember on this device", in which case it is stored in
// chrome.storage.local encrypted with a passphrase-derived AES-GCM key.

const SETTINGS_KEY = 'settings';
const SESSION_KEY = 'apiKey';
const VAULT_KEY = 'vault';

const DEFAULT_SETTINGS = {
  instanceUrl: '',
  projectId: null,
  autoAdvance: true,
  includeTabUrl: true,
  jpegQuality: 92,
  lastRunId: null,
};

export async function getSettings() {
  const { [SETTINGS_KEY]: s } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

// Normalise whatever the user typed into "https://host" with no trailing slash.
export function normalizeInstanceUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Enter your Testmo instance URL, e.g. https://acme.testmo.net');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error('That does not look like a valid URL.');
  }
  if (u.protocol !== 'https:') throw new Error('Testmo instances must use https.');
  return `${u.protocol}//${u.host}`;
}

// --- API key: session storage -------------------------------------------

export async function getSessionKey() {
  const { [SESSION_KEY]: k } = await chrome.storage.session.get(SESSION_KEY);
  return k || null;
}

export async function setSessionKey(key) {
  if (key) await chrome.storage.session.set({ [SESSION_KEY]: key });
  else await chrome.storage.session.remove(SESSION_KEY);
}

// --- API key: encrypted persistent vault --------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
function unb64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function hasVault() {
  const { [VAULT_KEY]: v } = await chrome.storage.local.get(VAULT_KEY);
  return Boolean(v && v.ct);
}

export function validatePassphrase(passphrase) {
  if (!passphrase || passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
  if (!/[a-z]/i.test(passphrase) || !/[^a-z]/i.test(passphrase)) throw new Error('Mix letters with digits or symbols in the passphrase.');
}

export async function saveVault(apiKey, passphrase) {
  validatePassphrase(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 600000;
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(apiKey));
  await chrome.storage.local.set({
    [VAULT_KEY]: { v: 1, salt: b64(salt), iv: b64(iv), iterations, ct: b64(ct) },
  });
}

export async function openVault(passphrase) {
  const { [VAULT_KEY]: v } = await chrome.storage.local.get(VAULT_KEY);
  if (!v || !v.ct) throw new Error('No saved key on this device.');
  // Never let a tampered record downgrade the work factor.
  const iterations = Math.max(100000, Number(v.iterations) || 0);
  const key = await deriveKey(passphrase, unb64(v.salt), iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, key, unb64(v.ct));
    return dec.decode(pt);
  } catch {
    throw new Error('Wrong passphrase.');
  }
}

export async function clearVault() {
  await chrome.storage.local.remove(VAULT_KEY);
}

export async function clearAllLocal() {
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
}
