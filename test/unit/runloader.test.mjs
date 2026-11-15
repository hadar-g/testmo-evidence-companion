import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTestIds, describeFields, loadCases } from '../../lib/runloader.js';

test('resolveTestIds uses results first, then the web session', async () => {
  const api = { getLatestRunResults: async () => [{ case_id: 10, test_id: 100, status_id: 2 }] };
  const looked = [];
  const session = { loggedIn: true, findTestId: async (runId, caseId) => (looked.push(caseId), caseId === 11 ? 101 : null) };
  const r = await resolveTestIds({ api, session, runId: 1, caseIds: [10, 11, 12] });
  assert.equal(r.byCase.get(10).testId, 100);
  assert.equal(r.byCase.get(11).testId, 101);
  assert.deepEqual(r.unresolved, [12]);
  assert.deepEqual(looked.sort(), [11, 12]);
});

test('resolveTestIds leaves everything unresolved when not signed in', async () => {
  const api = { getLatestRunResults: async () => [] };
  const session = { loggedIn: null, probe: async () => false };
  const r = await resolveTestIds({ api, session, runId: 1, caseIds: [1, 2] });
  assert.deepEqual(r.unresolved, [1, 2]);
  assert.equal(r.sessionLoggedIn, false);
});

test('describeFields orders by template and drops empty fields', () => {
  const fields = [
    { name: 'Priority', system_name: 'priority', column_name: 'custom_priority', type: 'dropdown' },
    { name: 'Steps', system_name: 'steps', column_name: 'custom_steps', type: 'steps' },
    { name: 'Description', system_name: 'bdddescription', column_name: 'custom_bdddescription', type: 'text' },
  ];
  const templates = [{ id: 4, fields: [{ name: 'Priority' }, { name: 'Description' }] }];
  const c = { template_id: 4, custom_priority: { id: 2, name: 'Normal' }, custom_bdddescription: '<p>x</p>', custom_steps: [] };
  const out = describeFields(c, templates, fields);
  assert.deepEqual(out.map((f) => f.name), ['Priority', 'Description']);
});

test('loadCases stops paging once ids are below the smallest wanted id', async () => {
  const calls = [];
  const api = {
    request: async (m, path, { query }) => {
      calls.push(query.page);
      const start = 1000 - (query.page - 1) * 100;
      return { result: Array.from({ length: 100 }, (_, i) => ({ id: start - i, folder_id: 5 })), next_page: query.page + 1 };
    },
    getAllPages: async (path, query) => {
      folderCalls.push(query.folder_id);
      return [{ id: 950, folder_id: 5 }, { id: 951, folder_id: 5 }];
    },
  };
  const folderCalls = [];
  const found = await loadCases({ api, projectId: 42, caseIds: [950, 951] });
  assert.equal(found.size, 2);
  assert.deepEqual(calls, [1]);
  assert.deepEqual(folderCalls, [5], 'each discovered folder is fetched exactly once, with a numeric id');
});
