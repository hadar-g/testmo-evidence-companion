import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortRunCases } from '../../lib/runorder.js';

const rc = (caseId, folderId, extra = {}) => ({ caseId, case: { id: caseId, folder_id: folderId, ...extra } });
const ids = (list) => list.map((x) => x.caseId);

// Shape from Testmo: parent 1233, child 1234, grandchildren 1235–1239, sibling 1240.
const FOLDERS = new Map([
  [100, { id: 100, parent_id: null, depth: 0, display_order: 1233 }],
  [101, { id: 101, parent_id: 100, depth: 1, display_order: 1234 }],
  [110, { id: 110, parent_id: 101, depth: 2, display_order: 1238 }],
  [111, { id: 111, parent_id: 101, depth: 2, display_order: 1235 }],
  [102, { id: 102, parent_id: 100, depth: 1, display_order: 1240 }],
]);

test('a new case (highest id) joins its folder instead of going last', () => {
  const list = [rc(1, 110), rc(2, 110), rc(3, 102), rc(4, 102), rc(99, 110)];
  assert.deepEqual(ids(sortRunCases(list, FOLDERS)), [1, 2, 99, 3, 4]);
});

test('folders follow Testmo tree order, not folder id', () => {
  const list = [rc(1, 102), rc(2, 110), rc(3, 111), rc(4, 101), rc(5, 100)];
  assert.deepEqual(ids(sortRunCases(list, FOLDERS)), [5, 4, 3, 2, 1]);
});

test('cases use display_order when present, else case id', () => {
  const list = [rc(5, 110, { display_order: 2 }), rc(3, 110, { display_order: 1 }), rc(4, 110)];
  assert.deepEqual(ids(sortRunCases(list, FOLDERS)), [3, 5, 4]);
});

test('unknown folders go last, ordered by folder id', () => {
  const list = [rc(1, 900), rc(2, 800), rc(3, 102), rc(4, 800)];
  const folders = new Map([...FOLDERS, [900, { id: 900, name: 'Folder 900' }]]);
  assert.deepEqual(ids(sortRunCases(list, folders)), [3, 2, 4, 1]);
});

test('does not mutate the input', () => {
  const list = [rc(2, 102), rc(1, 110)];
  sortRunCases(list, FOLDERS);
  assert.deepEqual(ids(list), [2, 1]);
});
