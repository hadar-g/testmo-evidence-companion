import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestmoApi, TestmoApiError } from '../../lib/api.js';

function mockFetch(handler) {
  globalThis.fetch = async (url, init) => {
    const { status = 200, body = {} } = await handler(new URL(String(url)), init);
    return { ok: status < 400, status, statusText: 'x', text: async () => JSON.stringify(body) };
  };
}

test('sends bearer auth and json body', async () => {
  let seen;
  mockFetch(async (url, init) => {
    seen = { url, init };
    return { status: 201, body: { result: { id: 1 } } };
  });
  const api = new TestmoApi('https://x.testmo.net', 'KEY');
  const r = await api.createResult(5, 7, { statusId: 2, comment: '<p>hi</p>', elapsed: 12 });
  assert.equal(r.id, 1);
  assert.equal(seen.url.pathname, '/api/v1/runs/5/tests/7/results');
  assert.equal(seen.init.headers.Authorization, 'Bearer KEY');
  assert.deepEqual(JSON.parse(seen.init.body), { status_id: 2, comment: '<p>hi</p>', elapsed: 12 });
});

test('paginates until next_page is null', async () => {
  const pages = { 1: { result: [{ id: 1 }], next_page: 2, last_page: 2 }, 2: { result: [{ id: 2 }], next_page: null, last_page: 2 } };
  mockFetch(async (url) => ({ body: pages[url.searchParams.get('page')] }));
  const api = new TestmoApi('https://x.testmo.net', 'KEY');
  const all = await api.getAllPages('/projects/42/runs');
  assert.deepEqual(all.map((r) => r.id), [1, 2]);
});

test('unwraps the array the attachment upload returns', async () => {
  mockFetch(async () => ({ status: 201, body: { result: [{ id: 42, name: 'x.png', path: 'https://x.testmo.net/attachments/view/42' }] } }));
  const api = new TestmoApi('https://x.testmo.net', 'KEY');
  const att = await api.uploadCaseAttachment(1, new Blob(['x']), 'x.png');
  assert.equal(att.id, 42);
  assert.match(att.path, /view\/42$/);
});

test('maps 401 to a friendly error', async () => {
  mockFetch(async () => ({ status: 401, body: { message: 'Unauthenticated.' } }));
  const api = new TestmoApi('https://x.testmo.net', 'KEY');
  await assert.rejects(api.getCurrentUser(), (e) => e instanceof TestmoApiError && e.status === 401 && /API key/.test(e.message));
});
