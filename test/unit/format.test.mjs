import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitFailureMessage } from '../../lib/format.js';

test('names the status and keeps the REST error', () => {
  const api = new Error('Testmo rejected the request (422): The status field is not a valid status.');
  assert.equal(submitFailureMessage('Changes Requested', api, null), 'Could not save "Changes Requested". Testmo rejected the request (422): The status field is not a valid status.');
});

test('adds the web-session error when the REST fallback also fails', () => {
  const api = new Error('Testmo rejected the request (422): The status field is not a valid status.');
  const web = new Error('Testmo web request failed (500) for runs/create_result/1: oops');
  assert.equal(
    submitFailureMessage('Changes Requested', api, web),
    'Could not save "Changes Requested". Testmo rejected the request (422): The status field is not a valid status.\nSigned-in Testmo submit failed first: Testmo web request failed (500) for runs/create_result/1: oops',
  );
});

test('falls back to generic wording when parts are missing', () => {
  assert.equal(submitFailureMessage('', 'boom', undefined), 'Could not save "result". boom');
  assert.equal(submitFailureMessage('Passed', null, null), 'Could not save "Passed". Unknown error');
});
