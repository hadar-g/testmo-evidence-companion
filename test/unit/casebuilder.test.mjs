import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gherkinToHtml, deriveNameFromGherkin, formFieldsForTemplate, buildCasePayload, defaultFolderId } from '../../lib/casebuilder.js';

const FIELDS = [
  { id: 2, name: 'Priority', type: 'dropdown', system_name: 'priority', column_name: 'custom_priority' },
  { id: 6, name: 'Description', type: 'text', system_name: 'bdddescription', column_name: 'custom_bdddescription' },
  { id: 4, name: 'Feature', type: 'text', system_name: 'expected', column_name: 'custom_expected' },
  { id: 5, name: 'Steps', type: 'steps', system_name: 'steps', column_name: 'custom_steps' },
];
const BDD = { id: 4, name: 'Case (BDD)', fields: [{ id: 2, type: 8, options: [{ id: 1, value: 'High' }, { id: 2, value: 'Normal' }] }, { id: 6, type: 2 }] };
const STEPS = { id: 2, name: 'Case (steps)', fields: [{ id: 4, type: 2 }, { id: 5, type: 10 }] };

test('gherkin html wrapper escapes and uses the editor classes Testmo expects', () => {
  const html = gherkinToHtml('Scenario: x\n\tGiven <b>\n');
  assert.equal(html, '<pre><code class="editor-gherkin language-gherkin code-block">Scenario: x\n\tGiven &lt;b&gt;</code></pre>');
});

test('name is derived from the Scenario line', () => {
  assert.equal(deriveNameFromGherkin('@tag\nScenario: the user logs in\n\tGiven x'), 'the user logs in');
  assert.equal(deriveNameFromGherkin('Scenario Outline: many <x>'), 'many <x>');
  assert.equal(deriveNameFromGherkin('Given nothing'), '');
});

test('form fields merge template and definitions, flagging the gherkin field', () => {
  const ff = formFieldsForTemplate(BDD, FIELDS);
  assert.deepEqual(ff.map((f) => [f.column, f.kind, f.gherkin]), [['custom_priority', 'dropdown', false], ['custom_bdddescription', 'text', true]]);
  assert.deepEqual(ff[0].options, [{ id: 1, value: 'High' }, { id: 2, value: 'Normal' }]);
  const sf = formFieldsForTemplate(STEPS, FIELDS);
  assert.deepEqual(sf.map((f) => [f.column, f.kind, f.gherkin]), [['custom_expected', 'text', false], ['custom_steps', 'steps', false]]);
});

test('payload for a BDD case', () => {
  const ff = formFieldsForTemplate(BDD, FIELDS);
  const p = buildCasePayload({ name: 'n', folderId: 7, templateId: 4, formFields: ff, values: { custom_priority: '2', custom_bdddescription: 'Scenario: n\n\tGiven a' } });
  assert.deepEqual(p, { name: 'n', folder_id: 7, template_id: 4, custom_priority: 2, custom_bdddescription: '<pre><code class="editor-gherkin language-gherkin code-block">Scenario: n\n\tGiven a</code></pre>' });
});

test('payload for a steps case drops empty rows and converts to html', () => {
  const ff = formFieldsForTemplate(STEPS, FIELDS);
  const p = buildCasePayload({ name: 'n', folderId: 7, templateId: 2, formFields: ff, values: { custom_expected: 'Feature\ntext', custom_steps: [{ step: 'Do', expected: 'Done' }, { step: '', expected: '' }] } });
  assert.equal(p.custom_expected, '<p>Feature<br>text</p>');
  assert.deepEqual(p.custom_steps, [{ text1: '<p>Do</p>', text3: '<p>Done</p>' }]);
});

test('validation and default folder', () => {
  assert.throws(() => buildCasePayload({ name: ' ', folderId: 1, templateId: 1, formFields: [], values: {} }), /needs a name/);
  const runCases = [{ case: { folder_id: 1 } }, { case: { folder_id: 2 } }, { case: { folder_id: 2 } }];
  assert.equal(defaultFolderId(runCases, null), 2);
  assert.equal(defaultFolderId(runCases, { case: { folder_id: 1 } }), 1);
});
