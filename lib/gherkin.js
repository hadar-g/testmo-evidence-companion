// Renders Gherkin text (Feature / Scenario / Given / When / Then …) as
// structured, highlighted HTML. Pure string in, HTML string out; the input is
// escaped, so it is safe to insert into the panel.

const escape = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const HEADERS = ['Feature', 'Rule', 'Background', 'Scenario Outline', 'Scenario Template', 'Scenario', 'Example', 'Examples', 'Scenarios'];
const STEPS = ['Given', 'When', 'Then', 'And', 'But', '*'];

export function looksLikeGherkin(text) {
  const t = String(text || '');
  return /^\s*(Feature|Scenario|Scenario Outline|Background|Given|When|Then)\b/m.test(t) && /^\s*(Given|When|Then|And|But)\b/m.test(t);
}

function inline(text) {
  // Highlight "quoted strings", <placeholders> and numbers inside a step.
  let out = '';
  const re = /("[^"]*"|'[^']*'|<[^<>\s]+>|\b\d+(?:\.\d+)?\b)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    out += escape(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('"') || tok.startsWith("'")) out += `<span class="gk-str">${escape(tok)}</span>`;
    else if (tok.startsWith('<')) out += `<span class="gk-param">${escape(tok)}</span>`;
    else out += `<span class="gk-num">${escape(tok)}</span>`;
    last = m.index + tok.length;
  }
  return out + escape(text.slice(last));
}

function table(rows) {
  const cells = rows.map((r) =>
    r
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim()),
  );
  const [head, ...body] = cells;
  return `<table class="gk-table"><thead><tr>${head.map((c) => `<th>${escape(c)}</th>`).join('')}</tr></thead><tbody>${body
    .map((r) => `<tr>${r.map((c) => `<td>${escape(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

export function renderGherkin(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let tableRows = [];
  let docString = null;
  let lastStepKeyword = null;
  const flushTable = () => {
    if (tableRows.length) out.push(table(tableRows));
    tableRows = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ');
    const trimmed = line.trim();
    if (docString !== null) {
      if (/^("""|```)/.test(trimmed)) {
        out.push(`<pre class="gk-doc">${escape(docString.join('\n'))}</pre>`);
        docString = null;
      } else docString.push(line);
      continue;
    }
    if (!trimmed) {
      flushTable();
      continue;
    }
    if (trimmed.startsWith('|')) {
      tableRows.push(trimmed);
      continue;
    }
    flushTable();
    if (/^("""|```)/.test(trimmed)) {
      docString = [];
      continue;
    }
    if (trimmed.startsWith('#')) {
      out.push(`<div class="gk-comment">${escape(trimmed)}</div>`);
      continue;
    }
    if (trimmed.startsWith('@')) {
      out.push(`<div class="gk-tags">${trimmed.split(/\s+/).map((t) => `<span class="gk-tag">${escape(t)}</span>`).join(' ')}</div>`);
      continue;
    }
    const header = HEADERS.find((h) => trimmed.startsWith(h + ':'));
    if (header) {
      const rest = trimmed.slice(header.length + 1).trim();
      const cls = header === 'Feature' ? 'gk-feature' : /Scenario|Example/.test(header) ? 'gk-scenario' : 'gk-section';
      out.push(`<div class="gk-header ${cls}"><span class="gk-kw">${escape(header)}</span> <span class="gk-title">${inline(rest)}</span></div>`);
      lastStepKeyword = null;
      continue;
    }
    const step = STEPS.find((k) => trimmed === k || trimmed.startsWith(k + ' '));
    if (step) {
      const rest = trimmed.slice(step.length).trim();
      const isConj = step === 'And' || step === 'But' || step === '*';
      const semantic = isConj ? lastStepKeyword || 'given' : step.toLowerCase();
      if (!isConj) lastStepKeyword = semantic;
      out.push(`<div class="gk-step gk-${semantic}"><span class="gk-step-kw">${escape(step)}</span><span class="gk-step-text">${inline(rest)}</span></div>`);
      continue;
    }
    out.push(`<div class="gk-text">${inline(trimmed)}</div>`);
  }
  flushTable();
  if (docString) out.push(`<pre class="gk-doc">${escape(docString.join('\n'))}</pre>`);
  return `<div class="gherkin">${out.join('')}</div>`;
}

// Decode the text content of a <pre><code class="language-gherkin"> block and
// return the rendered HTML, or null when the element is not a gherkin block.
export function upgradeGherkinBlocks(container) {
  const blocks = container.querySelectorAll('pre > code.language-gherkin, pre > code.editor-gherkin, code.language-gherkin');
  for (const code of blocks) {
    const text = code.textContent || '';
    if (!looksLikeGherkin(text) && !/^\s*(Feature|Scenario)/.test(text)) continue;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderGherkin(text);
    const pre = code.parentElement && code.parentElement.tagName === 'PRE' ? code.parentElement : code;
    pre.replaceWith(wrapper.firstElementChild);
  }
}
