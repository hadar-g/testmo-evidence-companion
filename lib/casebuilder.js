// Builds the payload for creating a repository case from a template, and
// helpers for the Add-case form.
import { escapeHtml, textToHtml } from './sanitize.js';

export const GHERKIN_CLASS = 'editor-gherkin language-gherkin code-block';

export function gherkinToHtml(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  return `<pre><code class="${GHERKIN_CLASS}">${escapeHtml(t)}</code></pre>`;
}

// First "Scenario:" / "Feature:" title, used when the tester leaves the name empty.
export function deriveNameFromGherkin(text) {
  const m = String(text || '').match(/^\s*(?:Scenario(?: Outline| Template)?|Example|Feature|Rule):\s*(.+)$/m);
  return m ? m[1].trim().slice(0, 200) : '';
}

const TYPE_NAMES = { 2: 'text', 8: 'dropdown', 10: 'steps', 1: 'string', 3: 'integer', 4: 'checkbox', 5: 'date', 6: 'url', 7: 'multiselect' };

// Merge a template's field list with the project field definitions into
// something the form can render: [{ id, name, column, kind, options, gherkin }].
export function formFieldsForTemplate(template, fields) {
  if (!template) return [];
  const byId = new Map(fields.map((f) => [Number(f.id), f]));
  const isBddTemplate = /bdd|cucumber|gherkin/i.test(template.name || '');
  return (template.fields || [])
    .map((tf) => {
      const def = byId.get(Number(tf.id));
      if (!def) return null;
      const kind = def.type || TYPE_NAMES[tf.type] || 'text';
      const gherkin = kind === 'text' && (/bdd|gherkin|scenario/i.test(def.system_name || '') || (isBddTemplate && /description|feature|scenario/i.test(def.name || '')));
      return {
        id: Number(def.id),
        name: def.name,
        column: def.column_name,
        kind,
        gherkin,
        options: (tf.options || []).map((o) => ({ id: Number(o.id), value: o.value })),
      };
    })
    .filter(Boolean);
}

// values: { [column]: string | number | Array<{step, expected}> }
export function buildCasePayload({ name, folderId, templateId, formFields, values }) {
  const payload = { name: String(name || '').trim(), folder_id: Number(folderId), template_id: Number(templateId) };
  if (!payload.name) throw new Error('The test case needs a name.');
  if (!payload.folder_id) throw new Error('Choose a folder.');
  for (const f of formFields) {
    const v = values[f.column];
    if (v === undefined || v === null || v === '') continue;
    if (f.kind === 'dropdown') payload[f.column] = Number(v);
    else if (f.kind === 'steps') {
      const rows = (Array.isArray(v) ? v : []).filter((r) => (r.step || '').trim() || (r.expected || '').trim());
      if (rows.length) payload[f.column] = rows.map((r) => ({ text1: textToHtml(r.step), text3: textToHtml(r.expected) }));
    } else if (f.gherkin) payload[f.column] = gherkinToHtml(v);
    else if (f.kind === 'text') payload[f.column] = textToHtml(v);
    else payload[f.column] = v;
  }
  return payload;
}

export const GHERKIN_TEMPLATE = 'Scenario: \n\tGiven \n\tWhen \n\tThen ';

// Which folder to preselect: the open case's folder, else the most common one.
export function defaultFolderId(runCases, currentCase) {
  if (currentCase && currentCase.case && currentCase.case.folder_id) return Number(currentCase.case.folder_id);
  const counts = new Map();
  for (const rc of runCases) {
    const id = Number(rc.case && rc.case.folder_id);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  let best = null;
  for (const [id, n] of counts) if (!best || n > best.n) best = { id, n };
  return best ? best.id : null;
}
