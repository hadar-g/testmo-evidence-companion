// Stand-in Testmo instance for demos and development; see demo/README.md.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildData } from './data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const PORT = Number(opt('port', process.env.MOCK_TESTMO_PORT || 8443));
const HOST = opt('host', '127.0.0.1');
const PLAIN = args.includes('--http');
const API_KEY = opt('api-key', process.env.MOCK_TESTMO_API_KEY || 'demo-api-key');
const CSRF = 'demo-csrf-token';

export function ensureCert(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '30', '-subj', '/CN=mock-testmo', '-addext', 'subjectAltName=DNS:localhost,DNS:*.testmo.net,DNS:*.example,IP:127.0.0.1'], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

export function createMockTestmo({ apiKey = API_KEY } = {}) {
  let db = buildData();
  let webSession = true;

  const latestByTest = (runId) => {
    const map = new Map();
    for (const r of db.results) {
      if (r.run_id !== runId) continue;
      const prev = map.get(r.test_id);
      if (!prev || r.created_at > prev.created_at || (r.created_at === prev.created_at && r.id > prev.id)) map.set(r.test_id, r);
    }
    return map;
  };
  const runView = (run) => {
    const tests = db.tests.filter((t) => t.run_id === run.id);
    const latest = latestByTest(run.id);
    const out = { ...run, total_count: tests.length, completed_count: 0, untested_count: 0 };
    for (const s of db.statuses) out[`status${s.id}_count`] = 0;
    for (const t of tests) {
      const r = latest.get(t.id);
      if (!r) {
        out.untested_count += 1;
        out.status1_count += 1;
      } else {
        out.completed_count += 1;
        out[`status${r.status_id}_count`] = (out[`status${r.status_id}_count`] || 0) + 1;
      }
    }
    return out;
  };
  const resultView = (r) => ({ id: r.id, run_id: r.run_id, test_id: r.test_id, case_id: r.case_id, status_id: r.status_id, note: r.note, elapsed: r.elapsed, assignee_id: r.assignee_id, created_by: r.created_by, created_at: r.created_at, attachments: r.attachments });

  const paged = (items, query) => {
    const perPage = Math.min(100, Number(query.get('per_page')) || 15);
    const page = Math.max(1, Number(query.get('page')) || 1);
    const total = items.length;
    const lastPage = Math.max(1, Math.ceil(total / perPage));
    return { result: items.slice((page - 1) * perPage, page * perPage), page, per_page: perPage, total, last_page: lastPage, next_page: page < lastPage ? `?page=${page + 1}` : null };
  };

  const json = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify(body));
  };
  const html = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...extra });
    res.end(body);
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });
  const parseMultipart = (buf, contentType) => {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || '');
    if (!m) return [];
    const boundary = Buffer.from(`--${m[1] || m[2]}`);
    const parts = [];
    let start = buf.indexOf(boundary) + boundary.length + 2;
    for (;;) {
      const end = buf.indexOf(boundary, start);
      if (end === -1) break;
      const part = buf.subarray(start, end - 2);
      const sep = part.indexOf('\r\n\r\n');
      const head = part.subarray(0, sep).toString();
      const body = part.subarray(sep + 4);
      const name = /name="([^"]*)"/.exec(head);
      const filename = /filename="([^"]*)"/.exec(head);
      const type = /content-type:\s*([^\r\n]+)/i.exec(head);
      parts.push({ name: name ? name[1] : '', filename: filename ? filename[1] : null, mime: type ? type[1].trim() : 'application/octet-stream', body });
      start = end + boundary.length + 2;
      if (buf.subarray(end + boundary.length, end + boundary.length + 2).toString() === '--') break;
    }
    return parts;
  };
  const storeAttachment = (part, extra) => {
    const id = ++db.nextIds.attachment;
    const att = { id, name: part.filename || `file-${id}`, size: part.body.length, mime: part.mime, buffer: part.body, path: `/attachments/view/${id}`, created_at: new Date().toISOString().slice(0, 19).replace('T', ' '), ...extra };
    db.attachments.push(att);
    return att;
  };
  const publicAttachment = (a) => ({ id: a.id, name: a.name, size: a.size, mime: a.mime, path: a.path, case_id: a.case_id ?? null, created_at: a.created_at });

  const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="csrf-token" content="${CSRF}"><title>${title} · Testmo (demo)</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:#f5f6f8;color:#1f2937}header{background:#1e293b;color:#fff;padding:12px 24px;font-weight:600}main{padding:24px;max-width:960px}table{border-collapse:collapse;width:100%;background:#fff}td,th{padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:left}.badge{display:inline-block;padding:2px 8px;border-radius:999px;color:#fff;font-size:12px}</style></head>
<body><header>Testmo (demo instance)</header><main>${body}</main></body></html>`;
  const loginPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign in · Testmo (demo)</title></head><body style="font-family:system-ui,sans-serif;padding:48px"><h1>Sign in</h1><form method="post" action="/auth/login"><label>Email <input name="email"></label> <label>Password <input name="password" type="password"></label> <button type="submit">Sign in</button></form></body></html>`;

  const handler = async (req, res) => {
    const url = new URL(req.url, 'https://mock');
    const q = url.searchParams;
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method;
    let m;

    // --- control ---
    if (p === '/__demo/session') {
      webSession = q.get('on') !== '0';
      return json(res, 200, { webSession });
    }
    if (p === '/__demo/reset') {
      db = buildData();
      webSession = true;
      return json(res, 200, { ok: true });
    }
    if (p === '/__demo/state') return json(res, 200, { webSession, runs: db.runs.map(runView), results: db.results.map(resultView), tests: db.tests, attachments: db.attachments.map(publicAttachment), cases: db.cases.map((c) => ({ id: c.id, name: c.name, folder_id: c.folder_id })) });

    // --- attachments served to the browser ---
    if ((m = p.match(/^\/attachments\/view\/(\d+)$/))) {
      const a = db.attachments.find((x) => x.id === Number(m[1]));
      if (!a) return html(res, 404, 'not found');
      res.writeHead(200, { 'content-type': a.mime, 'content-length': a.size });
      return res.end(a.buffer);
    }

    // --- REST API v1 ---
    if (p.startsWith('/api/v1/')) {
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${apiKey}`) return json(res, 401, { message: 'Unauthenticated.' });
      const api = p.slice('/api/v1'.length);
      const body = method === 'GET' ? null : await readBody(req);
      const jsonBody = () => {
        try {
          return JSON.parse(body.toString() || '{}');
        } catch {
          return {};
        }
      };

      if (api === '/user') return json(res, 200, db.me);
      if (api === '/projects') return json(res, 200, paged(db.projects, q));
      if ((m = api.match(/^\/projects\/(\d+)\/users$/))) return json(res, 200, paged(db.users, q));
      if ((m = api.match(/^\/projects\/(\d+)\/statuses$/))) return json(res, 200, paged(db.statuses, q));
      if ((m = api.match(/^\/projects\/(\d+)\/milestones$/))) return json(res, 200, paged(db.milestones.filter((x) => x.project_id === Number(m[1])), q));
      if ((m = api.match(/^\/projects\/(\d+)\/fields$/))) return json(res, 200, paged(db.fields, q));
      if ((m = api.match(/^\/projects\/(\d+)\/templates$/))) return json(res, 200, { result: db.templates });
      if ((m = api.match(/^\/folders\/(\d+)$/))) {
        const f = db.folders.find((x) => x.id === Number(m[1]));
        return f ? json(res, 200, { result: f }) : json(res, 404, { message: 'Folder not found.' });
      }
      if ((m = api.match(/^\/projects\/(\d+)\/runs$/))) {
        const closed = q.get('is_closed') === '1';
        let items = db.runs.filter((r) => r.project_id === Number(m[1]) && Boolean(r.is_closed) === closed);
        if (q.get('name')) items = items.filter((r) => r.name.toLowerCase().includes(q.get('name').toLowerCase()));
        items = [...items].sort((a, b) => (q.get('order') === 'asc' ? 1 : -1) * (a.created_at < b.created_at ? -1 : 1));
        return json(res, 200, paged(items.map(runView), q));
      }
      if ((m = api.match(/^\/runs\/(\d+)$/))) {
        const run = db.runs.find((r) => r.id === Number(m[1]));
        if (!run) return json(res, 404, { message: 'Run not found.' });
        if (method === 'PATCH') {
          const b = jsonBody();
          if (Array.isArray(b.cases)) {
            const ids = b.cases.map(Number);
            for (const caseId of ids) {
              if (!db.tests.some((t) => t.run_id === run.id && t.case_id === caseId)) {
                db.nextIds.test += 1 + (caseId % 3);
                db.tests.push({ id: db.nextIds.test, run_id: run.id, case_id: caseId, assignee_id: null });
              }
            }
            run.case_ids = ids;
          }
          if (typeof b.name === 'string') run.name = b.name;
        }
        return json(res, 200, { result: runView(run) });
      }
      if ((m = api.match(/^\/runs\/(\d+)\/results$/))) {
        const runId = Number(m[1]);
        let items = db.results.filter((r) => r.run_id === runId);
        if (q.get('get_latest_result') === '1') items = [...latestByTest(runId).values()];
        if (q.get('test_id')) items = items.filter((r) => r.test_id === Number(q.get('test_id')));
        if (q.get('case_id')) items = items.filter((r) => r.case_id === Number(q.get('case_id')));
        if (q.get('assignee_id')) items = items.filter((r) => r.assignee_id === Number(q.get('assignee_id')));
        if (q.get('status_id')) items = items.filter((r) => r.status_id === Number(q.get('status_id')));
        items = [...items].sort((a, b) => b.id - a.id);
        return json(res, 200, paged(items.map(resultView), q));
      }
      if ((m = api.match(/^\/runs\/(\d+)\/tests\/(\d+)\/results$/)) && method === 'POST') {
        const t = db.tests.find((x) => x.id === Number(m[2]) && x.run_id === Number(m[1]));
        if (!t) return json(res, 404, { message: 'Test not found.' });
        const b = jsonBody();
        if (!db.statuses.some((s) => s.id === Number(b.status_id))) return json(res, 422, { message: 'The given status_id is invalid.' });
        const r = { id: ++db.nextIds.result, run_id: t.run_id, test_id: t.id, case_id: t.case_id, status_id: Number(b.status_id), note: b.comment || '', elapsed: Number(b.elapsed) || 0, assignee_id: b.assignee_id ? Number(b.assignee_id) : t.assignee_id, created_by: db.me.id, created_at: new Date().toISOString().slice(0, 19).replace('T', ' '), attachments: [] };
        if (b.assignee_id) t.assignee_id = Number(b.assignee_id);
        db.results.push(r);
        return json(res, 201, { result: resultView(r) });
      }
      if ((m = api.match(/^\/projects\/(\d+)\/cases$/))) {
        const projectId = Number(m[1]);
        if (method === 'POST') {
          const b = jsonBody();
          const created = [];
          for (const c of b.cases || []) {
            if (!c.name || !c.folder_id) return json(res, 422, { message: 'name and folder_id are required.' });
            const row = { id: ++db.nextIds.case, project_id: projectId, created_at: new Date().toISOString().slice(0, 19).replace('T', ' '), template_id: Number(c.template_id) || 1, ...c, folder_id: Number(c.folder_id) };
            for (const f of db.fields) {
              if (f.type === 'dropdown' && typeof row[f.column_name] === 'number') {
                const opts = db.templates.flatMap((t) => t.fields).find((tf) => tf.id === f.id)?.options || [];
                const o = opts.find((x) => x.id === row[f.column_name]);
                if (o) row[f.column_name] = { id: o.id, name: o.value };
              }
            }
            db.cases.push(row);
            created.push(row);
          }
          return json(res, 201, { result: created });
        }
        if (method === 'DELETE') {
          const ids = (jsonBody().ids || []).map(Number);
          db.cases = db.cases.filter((c) => !ids.includes(c.id));
          res.writeHead(204);
          return res.end();
        }
        let items = db.cases.filter((c) => c.project_id === projectId);
        if (q.get('folder_id')) items = items.filter((c) => c.folder_id === Number(q.get('folder_id')));
        if (q.get('name')) items = items.filter((c) => c.name.toLowerCase().includes(q.get('name').toLowerCase()));
        const desc = q.get('order') === 'desc';
        items = [...items].sort((a, b) => (desc ? b.id - a.id : a.id - b.id));
        return json(res, 200, paged(items, q));
      }
      if ((m = api.match(/^\/cases\/(\d+)\/attachments$/))) return json(res, 200, paged(db.attachments.filter((a) => a.case_id === Number(m[1])).map(publicAttachment), q));
      if ((m = api.match(/^\/cases\/(\d+)\/attachments\/single$/)) && method === 'POST') {
        const part = parseMultipart(body, req.headers['content-type']).find((x) => x.filename);
        if (!part) return json(res, 422, { message: 'No file.' });
        const att = storeAttachment(part, { case_id: Number(m[1]) });
        return json(res, 201, { result: [publicAttachment(att)] });
      }
      return json(res, 404, { message: `No route for ${method} ${api}` });
    }

    // --- web UI routes (cookie session) ---
    if (p === '/auth/login') {
      if (method === 'POST') {
        webSession = true;
        res.writeHead(302, { location: '/todos' });
        return res.end();
      }
      return html(res, 200, loginPage);
    }
    if (!webSession) {
      res.writeHead(302, { location: '/auth/login' });
      return res.end();
    }
    if (p === '/' || p === '/todos') return html(res, 200, page('My work', '<h1>My work</h1><p>Signed in as ' + db.me.name + '.</p>'));
    if ((m = p.match(/^\/runs\/view\/(\d+)$/))) {
      const run = db.runs.find((r) => r.id === Number(m[1]));
      if (!run) return html(res, 404, page('Not found', '<h1>Run not found</h1>'));
      const latest = latestByTest(run.id);
      const rows = db.tests
        .filter((t) => t.run_id === run.id)
        .map((t) => {
          const c = db.cases.find((x) => x.id === t.case_id) || { name: `Case ${t.case_id}` };
          const r = latest.get(t.id);
          const s = db.statuses.find((x) => x.id === (r ? r.status_id : 1));
          const focus = q.get('test_id') === String(t.id) ? ' style="background:#eef2ff"' : '';
          return `<tr data-id="${t.id}"${focus}><td>C${t.case_id}</td><td>${c.name}</td><td><span class="badge" style="background:${s.color}">${s.name}</span></td><td>${r && r.note ? r.note : ''}${r ? r.attachments.map((a) => `<div><img src="/attachments/view/${a.attachment_id}" alt="${a.name}" style="max-width:320px;display:block;margin-top:6px"></div>`).join('') : ''}</td></tr>`;
        })
        .join('');
      return html(res, 200, page(run.name, `<h1>${run.name}</h1><table><thead><tr><th>ID</th><th>Test</th><th>Status</th><th>Latest result</th></tr></thead><tbody>${rows}</tbody></table>`));
    }
    if ((m = p.match(/^\/runs\/render_test_search\/(\d+)$/)) && method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString() || '{}');
      const term = String(b.search || '').trim();
      const rows = db.tests
        .filter((t) => t.run_id === Number(m[1]))
        .filter((t) => {
          const c = db.cases.find((x) => x.id === t.case_id);
          return String(t.case_id) === term || (c && c.name.toLowerCase().includes(term.toLowerCase()));
        })
        .map((t) => `<tr data-id="${t.id}"><td>C${t.case_id}</td><td>${(db.cases.find((x) => x.id === t.case_id) || {}).name || ''}</td></tr>`);
      return html(res, 200, `<table><tbody>${rows.join('')}</tbody></table>`);
    }
    if (p === '/todos/render_assignment_table' && method === 'POST') {
      const rows = db.runs
        .map((run) => ({ run, n: db.tests.filter((t) => t.run_id === run.id && t.assignee_id === db.me.id).length }))
        .filter((x) => x.n > 0)
        .map(({ run, n }) => `<tr data-id="${run.id}"><td><a href="/runs/view/${run.id}">${run.name}</a></td><td>${n} test${n === 1 ? '' : 's'} assigned</td></tr>`);
      return html(res, 200, `<table><tbody>${rows.join('')}</tbody></table>`);
    }
    if ((m = p.match(/^\/attachments\/create\/(\d+)$/)) && method === 'POST') {
      const body = await readBody(req);
      const part = parseMultipart(body, req.headers['content-type']).find((x) => x.filename);
      if (!part) return json(res, 422, { message: 'No file.' });
      const att = storeAttachment(part, { project_id: Number(m[1]) });
      return json(res, 200, { id: att.id, name: att.name, size: att.size });
    }
    if ((m = p.match(/^\/runs\/create_result\/(\d+)$/)) && method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString() || '{}');
      const t = db.tests.find((x) => x.id === Number(m[1]));
      if (!t) return json(res, 404, { message: 'Test not found.' });
      const r = { id: ++db.nextIds.result, run_id: t.run_id, test_id: t.id, case_id: t.case_id, status_id: Number(b.status_id), note: b.comment || '', elapsed: Number(b.elapsed) || 0, assignee_id: b.assignee_id ? Number(b.assignee_id) : t.assignee_id, created_by: db.me.id, created_at: new Date().toISOString().slice(0, 19).replace('T', ' '), attachments: (b.attachments || []).map((a) => ({ attachment_id: Number(a.attachment_id), name: a.name })) };
      db.results.push(r);
      return json(res, 200, { success: true, result: resultView(r) });
    }
    return html(res, 404, page('Not found', '<h1>Not found</h1>'));
  };

  return {
    handler,
    get webSession() {
      return webSession;
    },
    set webSession(v) {
      webSession = Boolean(v);
    },
    reset() {
      db = buildData();
      webSession = true;
    },
    get db() {
      return db;
    },
  };
}

export function startMockTestmo({ port = PORT, host = HOST, plain = PLAIN, certDir = path.join(here, '.cert'), apiKey = API_KEY } = {}) {
  const mock = createMockTestmo({ apiKey });
  const wrap = (req, res) =>
    mock.handler(req, res).catch((err) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: err.message }));
    });
  const server = plain ? http.createServer(wrap) : https.createServer(ensureCert(certDir), wrap);
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, mock, port: server.address().port, url: `${plain ? 'http' : 'https'}://${host}:${server.address().port}` })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { url } = await startMockTestmo();
  console.log(`Mock Testmo listening on ${url}  (API key: ${API_KEY})`);
}
