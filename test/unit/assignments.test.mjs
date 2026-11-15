import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssignmentTable } from '../../lib/session.js';
import { runsAssignedToMe, defaultMilestoneId } from '../../lib/runloader.js';

const TABLE = `<table><tr data-id="11"><td><a href="https://x.testmo.net/runs/view/11">Run A</a></td><td>3 tests assigned</td></tr>
<tr data-id="9"><td><a href="https://x.testmo.net/sessions/view/9">Session</a></td><td>Session assigned</td></tr>
<tr data-id="12"><td><a href="https://x.testmo.net/runs/view/12">Run B</a></td><td>1 test assigned</td></tr></table>`;

test('parseAssignmentTable keeps runs, drops sessions, reads counts', () => {
  const m = parseAssignmentTable(TABLE);
  assert.deepEqual([...m.entries()], [[11, 3], [12, 1]]);
});

test('runsAssignedToMe prefers the session and falls back to results', async () => {
  const session = { loggedIn: true, assignedRunIds: async () => new Map([[11, 3]]) };
  const api = { getResultsAssignedTo: async () => [] };
  let r = await runsAssignedToMe({ api, session, runs: [{ id: 11 }, { id: 1 }], userId: 21 });
  assert.equal(r.source, 'session');
  assert.deepEqual([...r.ids], [11]);
  const api2 = { getResultsAssignedTo: async (runId) => (runId === 1 ? [{ id: 1 }] : []) };
  r = await runsAssignedToMe({ api: api2, session: { loggedIn: false, probe: async () => false }, runs: [{ id: 11 }, { id: 1 }], userId: 21 });
  assert.equal(r.source, 'api');
  assert.deepEqual([...r.ids], [1]);
});

test('defaultMilestoneId picks the newest open milestone', () => {
  const ms = [
    { id: 1, name: 'Iteration 1', is_completed: true, start_date: '2026-06-01' },
    { id: 3, name: 'Iteration 3', is_completed: false, start_date: '2026-09-15' },
    { id: 2, name: 'Iteration 2', is_completed: false, start_date: '2026-09-01' },
  ];
  assert.equal(defaultMilestoneId(ms), 3);
  assert.equal(defaultMilestoneId([ms[0]]), 'all');
});
