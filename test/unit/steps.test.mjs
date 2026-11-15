import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsToSteps, stepsToText, describeEvent } from '../../lib/steps.js';

test('describes common events in plain English', () => {
  assert.equal(describeEvent({ kind: 'click', role: 'button', label: 'Submit' }), 'Click the "Submit" button');
  assert.equal(describeEvent({ kind: 'type', label: 'Email', value: 'a@b.c' }), 'Type "a@b.c" into the "Email" field');
  assert.equal(describeEvent({ kind: 'type', label: 'Password', secret: true }), 'Enter a value into the "Password" field (hidden)');
  assert.equal(describeEvent({ kind: 'select', label: 'Country', value: 'Israel' }), 'Select "Israel" in "Country"');
  assert.equal(describeEvent({ kind: 'toggle', role: 'checkbox', label: 'Remember me', checked: true }), 'Check "Remember me"');
  assert.equal(describeEvent({ kind: 'scroll', pct: 100 }), 'Scroll to the bottom of the page');
  assert.equal(describeEvent({ kind: 'key', key: 'Enter', label: 'Search' }), 'Press Enter in "Search"');
  assert.equal(describeEvent({ kind: 'click', role: 'checkbox', label: 'x' }), null, 'checkbox clicks are described by the change event');
});

test('collapses scroll bursts, drops duplicates, keeps timestamps', () => {
  const t0 = 1_000_000;
  const events = [
    { kind: 'start', url: 'https://app.test/', at: t0 },
    { kind: 'scroll', pct: 30, at: t0 + 2000 },
    { kind: 'scroll', pct: 60, at: t0 + 3000 },
    { kind: 'scroll', pct: 100, at: t0 + 4000 },
    { kind: 'click', role: 'button', label: 'Save', at: t0 + 6000 },
    { kind: 'click', role: 'button', label: 'Save', at: t0 + 6100 },
  ];
  const steps = eventsToSteps(events, t0);
  assert.deepEqual(steps.map((s) => s.text), ['Open https://app.test/', 'Scroll to the bottom of the page', 'Click the "Save" button']);
  assert.deepEqual(steps.map((s) => s.at), [0, 4, 6]);
  assert.equal(stepsToText(steps).split('\n')[1], '2. Scroll to the bottom of the page (0:04)');
});
