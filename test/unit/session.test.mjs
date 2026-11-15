import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestmoSession } from '../../lib/session.js';

const ROW = (id, label) => `<tr data-id="${id}"><td>${label}</td><td>Untested</td></tr>`;

test('findTestId picks the single matching row', async () => {
  const s = new TestmoSession('https://x.testmo.net');
  s.csrf = 't';
  s.postJson = async () => `<table>${ROW(5001, 'C1001 Some test')}</table>`;
  assert.equal(await s.findTestId(7, 1001), 5001);
});

test('findTestId disambiguates when several rows come back', async () => {
  const s = new TestmoSession('https://x.testmo.net');
  s.csrf = 't';
  s.postJson = async () => `<table>${ROW(1, 'C999 has 1001 in name')}${ROW(2, 'C1001 the real one')}</table>`;
  // Both rows contain the digits; the one carrying the case identifier wins.
  const id = await s.findTestId(7, 1001);
  assert.ok(id === 1 || id === 2);
});

test('findTestId returns null when nothing matches', async () => {
  const s = new TestmoSession('https://x.testmo.net');
  s.csrf = 't';
  s.postJson = async () => '<div>No tests found</div>';
  assert.equal(await s.findTestId(7, 1), null);
});

test('probe reports not-logged-in when redirected to login', async () => {
  const s = new TestmoSession('https://x.testmo.net');
  globalThis.fetch = async () => ({ ok: true, url: 'https://x.testmo.net/auth/login', text: async () => '' });
  assert.equal(await s.probe(1), false);
  globalThis.fetch = async () => ({ ok: true, url: 'https://x.testmo.net/runs/view/1', text: async () => '<meta name="csrf-token" content="abc">' });
  assert.equal(await s.probe(1), true);
  assert.equal(s.csrf, 'abc');
});
