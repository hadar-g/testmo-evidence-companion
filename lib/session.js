// Helpers that piggyback on the user's normal logged-in Testmo browser
// session. The official REST API has two gaps this covers:
//   1. it cannot list the run-test ids of untested cases in a run, and
//   2. it cannot attach files to a run result (only to repository cases).
// Everything here talks to Testmo's own web routes with the user's cookies,
// so it only works while they are signed in to Testmo in this Chrome profile.
// These routes are not a public contract; every call degrades gracefully.

export class TestmoSession {
  constructor(instanceUrl) {
    this.base = instanceUrl;
    this.csrf = null;
    this.loggedIn = null; // unknown until probed
  }

  // Any authenticated Testmo page carries the CSRF token; the run page is
  // used when we have a run, otherwise the "My work" page.
  async probe(runId) {
    const path = runId ? `runs/view/${runId}` : 'todos';
    try {
      const res = await fetch(`${this.base}/${path}`, { credentials: 'include', redirect: 'follow' });
      if (!res.ok || /\/auth\/login/.test(res.url)) {
        this.loggedIn = false;
        return false;
      }
      const html = await res.text();
      const m = html.match(/name="csrf-token"\s+content="([^"]+)"/);
      if (!m) {
        this.loggedIn = false;
        return false;
      }
      this.csrf = m[1];
      this.loggedIn = true;
      return true;
    } catch {
      this.loggedIn = false;
      return false;
    }
  }

  headers(extra = {}) {
    return {
      'X-CSRF-TOKEN': this.csrf,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/html',
      ...extra,
    };
  }

  async postJson(path, body) {
    const res = await fetch(`${this.base}/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 419 || /\/auth\/login/.test(res.url)) {
      this.loggedIn = false;
      throw new Error('Testmo session expired. Sign in to Testmo in another tab and retry.');
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Testmo web request failed (${res.status}) for ${path}: ${text.slice(0, 200)}`);
    return text;
  }

  // Find the run-test id (run_tests.id) for a case inside a run by using the
  // run page's test search, which accepts a case id and returns one row.
  async findTestId(runId, caseId) {
    const html = await this.postJson(`runs/render_test_search/${runId}`, { search: String(caseId) });
    const ids = [...html.matchAll(/<tr[^>]*\sdata-id="(\d+)"/g)].map((m) => Number(m[1]));
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) {
      // A case id can also match a test id or a name containing digits. Prefer
      // the row that carries the case identifier text.
      const rows = html.split(/<tr/).slice(1);
      for (const row of rows) {
        const idm = row.match(/\sdata-id="(\d+)"/);
        if (idm && new RegExp(`\\bC?${caseId}\\b`).test(row.replace(/<[^>]+>/g, ' '))) return Number(idm[1]);
      }
    }
    return null;
  }

  // Run ids that have at least one test assigned to the signed-in user, from
  // the assignment table on Testmo's "My work" page.
  async assignedRunIds() {
    const html = await this.postJson('todos/render_assignment_table', {});
    return parseAssignmentTable(html);
  }

  async uploadAttachment(projectId, blob, filename) {
    const form = new FormData();
    form.append('attachment', blob, filename);
    const res = await fetch(`${this.base}/attachments/create/${projectId}`, {
      method: 'POST',
      credentials: 'include',
      headers: this.headers({ 'X-Forge-Upload': '1' }),
      body: form,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Attachment upload failed (${res.status}): ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    const att = data.data && data.data.id ? data.data : data;
    if (!att.id) throw new Error(`Attachment upload returned no id: ${text.slice(0, 200)}`);
    return { id: att.id, name: att.name || filename };
  }

  // Create a result through the same route the Testmo UI uses, so files show up
  // as proper result attachments.
  // `attachments` is the list returned by uploadAttachment ({id, name}).
  async createResult(testId, { statusId, comment, elapsed, attachments = [], assigneeId = null }) {
    const body = {
      status_id: statusId,
      comment: comment || '',
      attachments: attachments.map((a) => ({ attachment_id: a.id, name: a.name })),
      issues: [],
      assignee_id: assigneeId,
    };
    if (elapsed) body.elapsed = elapsed;
    const text = await this.postJson(`runs/create_result/${testId}`, body);
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
}

// Rows look like <tr data-id="12"> … href="…/runs/view/12" … "1 test assigned".
// Session rows (…/sessions/view/…) are skipped.
export function parseAssignmentTable(html) {
  const out = new Map();
  for (const row of String(html || '').split(/<tr\b/).slice(1)) {
    const id = row.match(/\sdata-id="(\d+)"/);
    if (!id || !/\/runs\/view\/\d+/.test(row)) continue;
    const count = row.replace(/<[^>]+>/g, ' ').match(/(\d+)\s+tests?\s+assigned/i);
    out.set(Number(id[1]), count ? Number(count[1]) : 1);
  }
  return out;
}
