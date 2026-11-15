import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './helpers.mjs';
installFakeChrome();
const store = await import('../../lib/storage.js');

test('normalizeInstanceUrl accepts bare hosts and strips paths', () => {
  assert.equal(store.normalizeInstanceUrl('acme.testmo.net'), 'https://acme.testmo.net');
  assert.equal(store.normalizeInstanceUrl('https://acme.testmo.net/runs/8'), 'https://acme.testmo.net');
  assert.equal(store.normalizeInstanceUrl('  HTTPS://Acme.Testmo.net  '), 'https://acme.testmo.net');
});

test('normalizeInstanceUrl rejects http and garbage', () => {
  assert.throws(() => store.normalizeInstanceUrl('http://acme.testmo.net'), /https/);
  assert.throws(() => store.normalizeInstanceUrl(''), /Enter your Testmo/);
  assert.throws(() => store.normalizeInstanceUrl('not a url at all'), /valid URL/);
});

test('vault round-trips the key and rejects a wrong passphrase', async () => {
  assert.equal(await store.hasVault(), false);
  await store.saveVault('secret-api-key-123', 'correct horse battery');
  assert.equal(await store.hasVault(), true);
  assert.equal(await store.openVault('correct horse battery'), 'secret-api-key-123');
  await assert.rejects(store.openVault('wrong'), /Wrong passphrase/);
  const raw = JSON.stringify(await chrome.storage.local.get('vault'));
  assert.ok(!raw.includes('secret-api-key-123'), 'plaintext key must not be stored');
  await store.clearVault();
  assert.equal(await store.hasVault(), false);
});

test('vault requires a passphrase of at least 8 characters', async () => {
  await assert.rejects(store.saveVault('k', 'short'), /at least 8/);
});

test('session key is kept separately from settings', async () => {
  await store.setSessionKey('abc');
  assert.equal(await store.getSessionKey(), 'abc');
  await store.setSessionKey(null);
  assert.equal(await store.getSessionKey(), null);
  const s = await store.updateSettings({ instanceUrl: 'https://x.testmo.net' });
  assert.equal(s.instanceUrl, 'https://x.testmo.net');
  assert.equal(s.autoAdvance, true);
});
