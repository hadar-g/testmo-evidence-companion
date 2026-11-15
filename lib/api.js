// Minimal client for the Testmo REST API v1 (https://<instance>/api/v1).
// Only the endpoints this extension needs are wrapped.

export class TestmoApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'TestmoApiError';
    this.status = status;
    this.body = body;
  }
}

const PAGE_SIZE = 100; // Testmo accepts 15, 25, 50, 100 for per_page.

export class TestmoApi {
  constructor(instanceUrl, apiKey) {
    this.base = `${instanceUrl}/api/v1`;
    this.apiKey = apiKey;
  }

  async request(method, path, { query, body, form } = {}) {
    const url = new URL(this.base + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    const headers = { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' };
    let payload;
    if (form) {
      payload = form;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let res;
    try {
      // Never follow redirects with a bearer token attached.
      res = await fetch(url, { method, headers, body: payload, redirect: 'error', credentials: 'omit' });
    } catch (err) {
      throw new TestmoApiError(`Could not reach ${url.host}. Check the instance URL and that the extension has permission for it.`, 0, null);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || `${res.status} ${res.statusText}`;
      throw new TestmoApiError(friendlyError(res.status, msg), res.status, data);
    }
    return data;
  }

  async getAllPages(path, query = {}) {
    const out = [];
    let page = 1;
    for (;;) {
      const data = await this.request('GET', path, { query: { ...query, page, per_page: PAGE_SIZE } });
      out.push(...(data.result || []));
      if (!data.next_page || page >= (data.last_page || page)) break;
      page += 1;
      if (page > 200) break; // hard stop against runaway pagination
    }
    return out;
  }

  // --- identity / projects ---
  getCurrentUser() {
    return this.request('GET', '/user').then((d) => d.result || d);
  }
  getProjects() {
    return this.getAllPages('/projects');
  }
  getProjectUsers(projectId) {
    return this.getAllPages(`/projects/${projectId}/users`);
  }

  // --- runs ---
  getRuns(projectId, { isClosed = false, name } = {}) {
    return this.getAllPages(`/projects/${projectId}/runs`, {
      is_closed: isClosed ? 1 : 0,
      name,
      sort: 'runs:created_at',
      order: 'desc',
    });
  }
  getRun(runId) {
    return this.request('GET', `/runs/${runId}`).then((d) => d.result);
  }
  getStatuses(projectId) {
    return this.getAllPages(`/projects/${projectId}/statuses`);
  }
  getMilestones(projectId) {
    return this.getAllPages(`/projects/${projectId}/milestones`);
  }
  getFolder(folderId) {
    return this.request('GET', `/folders/${folderId}`).then((d) => d.result || d);
  }
  // Latest results in a run whose assignee is the given user. Only tests that
  // have a result can appear here; assignment without a result is invisible
  // to the REST API.
  getResultsAssignedTo(runId, userId) {
    return this.request('GET', `/runs/${runId}/results`, { query: { assignee_id: userId, get_latest_result: 1, per_page: 15 } }).then((d) => d.result || []);
  }

  // Latest result per test in the run. Gives us test_id, current status and note.
  getLatestRunResults(runId) {
    return this.getAllPages(`/runs/${runId}/results`, { get_latest_result: 1 });
  }
  getResultsForTest(runId, testId) {
    return this.getAllPages(`/runs/${runId}/results`, { test_id: testId });
  }

  createResult(runId, testId, { statusId, comment, elapsed, assigneeId }) {
    const body = { status_id: statusId };
    if (comment) body.comment = comment;
    if (elapsed) body.elapsed = elapsed;
    if (assigneeId) body.assignee_id = assigneeId;
    return this.request('POST', `/runs/${runId}/tests/${testId}/results`, { body }).then((d) => d.result);
  }

  // --- repository cases ---
  getFields(projectId) {
    return this.getAllPages(`/projects/${projectId}/fields`, { entity: 'repository_case' });
  }
  getTemplates(projectId) {
    return this.request('GET', `/projects/${projectId}/templates`).then((d) => d.result || []);
  }

  // The cases endpoint has no "ids" filter, so we page through a folder-less
  // listing and keep only the ids we need. Most runs live in a handful of
  // folders, so we first try folder-scoped requests when we know the folders.
  async getCasesByIds(projectId, caseIds) {
    const wanted = new Set(caseIds.map(Number));
    const found = new Map();
    let page = 1;
    for (;;) {
      const data = await this.request('GET', `/projects/${projectId}/cases`, {
        query: { page, per_page: PAGE_SIZE, sort: 'repository_cases:id', order: 'desc' },
      });
      for (const c of data.result || []) {
        if (wanted.has(Number(c.id))) found.set(Number(c.id), c);
      }
      if (found.size >= wanted.size) break;
      if (!data.next_page || page >= (data.last_page || page)) break;
      page += 1;
      if (page > 500) break;
    }
    return found;
  }

  async getCasesInFolders(projectId, folderIds) {
    const out = new Map();
    for (const folderId of folderIds) {
      const cases = await this.getAllPages(`/projects/${projectId}/cases`, { folder_id: folderId });
      for (const c of cases) out.set(Number(c.id), c);
    }
    return out;
  }

  // Create one repository case; custom template fields go in as custom_* keys.
  createCase(projectId, casePayload) {
    return this.request('POST', `/projects/${projectId}/cases`, { body: { cases: [casePayload] } }).then((d) => {
      const r = Array.isArray(d.result) ? d.result[0] : d.result;
      if (!r || !r.id) throw new TestmoApiError('Testmo did not return the created case.', 500, d);
      return r;
    });
  }

  // Replace the run's case set. Existing tests keep their ids and results;
  // new cases get new run tests. (Undocumented but stable PATCH field.)
  updateRunCases(runId, caseIds) {
    return this.request('PATCH', `/runs/${runId}`, { body: { cases: caseIds.map(Number) } }).then((d) => d.result || d);
  }

  getCaseAttachments(caseId) {
    return this.request('GET', `/cases/${caseId}/attachments`).then((d) => d.result || []);
  }

  uploadCaseAttachment(caseId, blob, filename) {
    const form = new FormData();
    form.append('file', blob, filename);
    // Testmo wraps this one in an array even though a single file was sent.
    return this.request('POST', `/cases/${caseId}/attachments/single`, { form }).then((d) => {
      const att = Array.isArray(d.result) ? d.result[0] : d.result;
      if (!att || !att.id) throw new TestmoApiError('Attachment upload returned no id.', 500, d);
      return att;
    });
  }
}

function friendlyError(status, msg) {
  if (status === 401) return 'Testmo rejected the API key (401). Check the key and that it has not been revoked.';
  if (status === 403) return `Testmo denied this action (403): ${msg}`;
  if (status === 404) return `Not found (404): ${msg}`;
  if (status === 422) return `Testmo rejected the request (422): ${msg}`;
  if (status === 429) return 'Testmo rate limit hit (429). Wait a moment and try again.';
  return msg;
}
