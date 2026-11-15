import { TestmoApi } from '../lib/api.js';
import { TestmoSession } from '../lib/session.js';
import * as store from '../lib/storage.js';
import * as db from '../lib/db.js';
import { sanitizeHtml, escapeHtml, textToHtml, stripHtml } from '../lib/sanitize.js';
import { resolveTestIds, loadCases, describeFields, runsAssignedToMe, defaultMilestoneId } from '../lib/runloader.js';
import { upgradeGherkinBlocks } from '../lib/gherkin.js';
import { TabRecorder } from '../lib/recording.js';
import { eventsToSteps, stepsToText, fmtClock, redactUrl } from '../lib/steps.js';
import { sortRunCases } from '../lib/runorder.js';
import { formFieldsForTemplate, buildCasePayload, deriveNameFromGherkin, defaultFolderId, GHERKIN_TEMPLATE } from '../lib/casebuilder.js';
import { renderGherkin } from '../lib/gherkin.js';
import { fmtElapsed, fmtDate, statusColor, timestampSlug, submitFailureMessage } from '../lib/format.js';
import { ATTACH_ACCEPT, partitionFiles, evidenceName } from '../lib/evidence.js';
import { captureActiveTab, requestCapturePermission, revokeCapturePermission, hasCapturePermission, getActiveTab } from '../lib/capture.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  settings: null,
  apiKey: null,
  api: null,
  session: null,
  user: null,
  projects: [],
  statuses: [], // all statuses for the current project
  templates: [],
  fields: [],
  runs: [],
  milestones: [],
  assigned: null, // { ids, counts, source } when the "assigned to me" toggle is on
  folderCache: new Map(), // folderId -> folder
  run: null, // current run object
  runCases: [], // ordered array of { caseId, case, testId, latest }
  unresolved: new Set(),
  caseCache: new Map(), // caseId -> case object (per project)
  drafts: new Map(), // caseId -> draft
  shotCounts: new Map(),
  current: null, // index into runCases
  timer: { startedAt: null, base: 0, handle: null },
  recorder: null, // TabRecorder while recording
  recCaseKey: null,
  recTick: null,
  screen: null,
  history: [], // screen stack for the back button
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function show(screen, { push = true } = {}) {
  if (push && state.screen && state.screen !== screen) state.history.push(state.screen);
  state.screen = screen;
  $$('section[data-screen]').forEach((s) => (s.hidden = s.dataset.screen !== screen));
  $('#btn-back').hidden = !['run', 'case', 'settings', 'newcase'].includes(screen);

  $('#btn-settings').hidden = !state.api || screen === 'settings' || screen === 'connect' || screen === 'unlock';
  const titles = {
    connect: 'Testmo Evidence Companion',
    unlock: 'Testmo Evidence Companion',
    runs: 'Test runs',
    run: state.run ? state.run.name : 'Run',
    case: state.run ? state.run.name : 'Test',
    settings: 'Settings',
    newcase: state.run ? state.run.name : 'Add a test case',
  };
  $('#topbar-title').textContent = titles[screen] || 'Testmo';
  $('#topbar-title').title = titles[screen] || '';
  document.querySelector('main').scrollTop = 0;
}

function goBack() {
  if (state.screen === 'newcase') return state.current === null ? openRunScreen() : openCase(state.current);
  if (state.screen === 'case') return openRunScreen();
  if (state.screen === 'run') {
    stopTimer();
    state.run = null;
    return show('runs');
  }
  const prev = state.history.pop() || 'runs';
  show(prev, { push: false });
}

let toastHandle;
function toast(msg, { error = false, ms = 2600 } = {}) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('toast--error', error);
  el.hidden = false;
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => (el.hidden = true), ms);
}

function showError(sel, err) {
  const el = $(sel);
  if (!err) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.textContent = err.message || String(err);
  el.hidden = false;
}

function busy(btn, on, label) {
  if (!btn) return;
  if (on) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = label || 'Working…';
    btn.disabled = true;
  } else {
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
    delete btn.dataset.label;
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Boot / auth
// ---------------------------------------------------------------------------
async function boot() {
  state.settings = await store.getSettings();
  $('#set-version').textContent = `Version ${chrome.runtime.getManifest().version}`;
  wireEvents();
  const instance = state.settings.instanceUrl;
  if (instance) $('#in-instance').value = instance;
  const sessionKey = await store.getSessionKey();
  if (instance && sessionKey) {
    return connect(instance, sessionKey, { silent: true });
  }
  if (instance && (await store.hasVault())) {
    $('#unlock-instance').textContent = instance;
    return show('unlock', { push: false });
  }
  show('connect', { push: false });
}

async function ensureHostPermission(instanceUrl) {
  const origin = `${instanceUrl}/*`;
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

async function connect(instanceUrl, apiKey, { silent = false } = {}) {
  const api = new TestmoApi(instanceUrl, apiKey);
  const user = await api.getCurrentUser();
  state.api = api;
  state.apiKey = apiKey;
  state.user = user;
  state.session = new TestmoSession(instanceUrl);
  await store.setSessionKey(apiKey);
  state.settings = await store.updateSettings({ instanceUrl });
  $('#set-instance').textContent = instanceUrl;
  $('#set-user').textContent = user.name || `user #${user.id}`;
  if (!silent) toast(`Connected as ${user.name}`);
  await loadProjects();
  show('runs', { push: false });
  await loadRuns();
  if (state.settings.lastRunId) {
    const run = state.runs.find((r) => Number(r.id) === Number(state.settings.lastRunId));
    if (run) await openRun(run);
  }
}

async function onConnectSubmit(e) {
  e.preventDefault();
  showError('#connect-error', null);
  const btn = $('#btn-connect');
  try {
    const instanceUrl = store.normalizeInstanceUrl($('#in-instance').value);
    const apiKey = $('#in-apikey').value.trim();
    if (!apiKey) throw new Error('Paste your API key.');
    busy(btn, true, 'Connecting…');
    const granted = await ensureHostPermission(instanceUrl);
    if (!granted) throw new Error(`Permission for ${instanceUrl} is required so the extension can call its API.`);
    const remember = $('#in-remember').checked;
    const passphrase = $('#in-passphrase').value;
    if (remember) store.validatePassphrase(passphrase);
    // Validate the key against Testmo before persisting anything.
    await new TestmoApi(instanceUrl, apiKey).getCurrentUser();
    if (remember) await store.saveVault(apiKey, passphrase);
    else await store.clearVault();
    await connect(instanceUrl, apiKey);
    $('#in-apikey').value = '';
    $('#in-passphrase').value = '';
  } catch (err) {
    showError('#connect-error', err);
  } finally {
    busy(btn, false);
  }
}

async function onUnlockSubmit(e) {
  e.preventDefault();
  showError('#unlock-error', null);
  const btn = e.submitter;
  try {
    busy(btn, true, 'Unlocking…');
    const apiKey = await store.openVault($('#in-unlock').value);
    const instanceUrl = state.settings.instanceUrl;
    const granted = await ensureHostPermission(instanceUrl);
    if (!granted) throw new Error(`Permission for ${instanceUrl} is required.`);
    await connect(instanceUrl, apiKey);
    $('#in-unlock').value = '';
  } catch (err) {
    showError('#unlock-error', err);
  } finally {
    busy(btn, false);
  }
}

async function disconnect() {
  if (!confirm('Forget the API key on this device? Local drafts and screenshots are kept.')) return;
  await store.setSessionKey(null);
  await store.clearVault();
  if (state.settings.instanceUrl) {
    chrome.permissions.remove({ origins: [`${state.settings.instanceUrl}/*`] }).catch(() => {});
  }
  state.api = null;
  state.apiKey = null;
  state.run = null;
  stopTimer();
  state.history = [];
  show('connect', { push: false });
}

// ---------------------------------------------------------------------------
// Projects and runs
// ---------------------------------------------------------------------------
async function loadProjects() {
  state.projects = (await state.api.getProjects()).filter((p) => !p.is_completed);
  const sel = $('#sel-project');
  sel.innerHTML = '';
  for (const p of state.projects) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  }
  let projectId = state.settings.projectId;
  if (!state.projects.some((p) => Number(p.id) === Number(projectId))) projectId = state.projects[0] && state.projects[0].id;
  sel.value = projectId;
  await selectProject(projectId, { reloadRuns: false });
}

async function selectProject(projectId, { reloadRuns = true } = {}) {
  projectId = Number(projectId);
  state.settings = await store.updateSettings({ projectId });
  state.caseCache = new Map();
  const [statuses, templates, fields, milestones] = await Promise.all([
    state.api.getStatuses(projectId),
    state.api.getTemplates(projectId),
    state.api.getFields(projectId),
    state.api.getMilestones(projectId).catch(() => []),
  ]);
  state.statuses = statuses;
  state.templates = templates;
  state.fields = fields;
  state.milestones = milestones;
  state.folderCache = new Map();
  state.assigned = null;
  renderMilestoneSelect();
  if (reloadRuns) await loadRuns();
}

function milestoneById(id) {
  return state.milestones.find((m) => Number(m.id) === Number(id)) || null;
}

function currentMilestoneChoice() {
  const saved = (state.settings.milestoneByProject || {})[state.settings.projectId];
  if (saved === 'all' || saved === 'none') return saved;
  if (saved && milestoneById(saved)) return Number(saved);
  return defaultMilestoneId(state.milestones);
}

function renderMilestoneSelect() {
  const sel = $('#sel-milestone');
  sel.innerHTML = '';
  const add = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  };
  const open = state.milestones.filter((m) => !m.is_completed);
  const closed = state.milestones.filter((m) => m.is_completed);
  const sortNewest = (a, b) => ((b.start_date || b.created_at || '') > (a.start_date || a.created_at || '') ? 1 : -1);
  add('all', 'All milestones');
  for (const m of open.sort(sortNewest)) add(m.id, m.name);
  if (closed.length) {
    const grp = document.createElement('optgroup');
    grp.label = 'Completed';
    for (const m of closed.sort(sortNewest)) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.name;
      grp.appendChild(o);
    }
    sel.appendChild(grp);
  }
  add('none', 'No milestone');
  sel.value = String(currentMilestoneChoice());
}

async function onMilestoneChange(e) {
  const v = e.target.value;
  const choice = v === 'all' || v === 'none' ? v : Number(v);
  const map = { ...(state.settings.milestoneByProject || {}), [state.settings.projectId]: choice };
  state.settings = await store.updateSettings({ milestoneByProject: map });
  renderRuns();
}

async function onAssignedToggle(e) {
  if (!e.target.checked) {
    state.assigned = null;
    $('#assigned-note').hidden = true;
    return renderRuns();
  }
  $('#assigned-note').textContent = 'Checking your assignments…';
  $('#assigned-note').hidden = false;
  // The user may have signed in since we last looked; re-probe cheaply.
  if (state.session && state.session.loggedIn === false) state.session.loggedIn = null;
  try {
    state.assigned = await runsAssignedToMe({ api: state.api, session: state.session, runs: state.runs, userId: state.user.id });
    $('#assigned-note').textContent =
      state.assigned.source === 'session'
        ? 'Assignments read from your Testmo "My work" page.'
        : 'Not signed in to Testmo in this browser: only tests that already have a result assigned to you can be detected. Sign in for the full list.';
  } catch (err) {
    state.assigned = { ids: new Set(), counts: new Map(), source: 'error' };
    $('#assigned-note').textContent = `Could not read assignments: ${err.message}`;
  }
  renderRuns();
}

async function loadRuns() {
  const list = $('#runs-list');
  list.innerHTML = '<div class="muted center">Loading runs…</div>';
  try {
    const projectId = state.settings.projectId;
    const showClosed = $('#in-show-closed').checked;
    const [active, closed] = await Promise.all([
      state.api.getRuns(projectId, { isClosed: false }),
      showClosed ? state.api.getRuns(projectId, { isClosed: true }) : Promise.resolve([]),
    ]);
    state.runs = [...active, ...closed];
    if ($('#in-assigned-me').checked) {
      state.assigned = await runsAssignedToMe({ api: state.api, session: state.session, runs: state.runs, userId: state.user.id }).catch(() => null);
    }
    renderRuns();
  } catch (err) {
    list.innerHTML = '';
    toast(err.message, { error: true, ms: 5000 });
  }
}

function statusById(id) {
  return state.statuses.find((s) => Number(s.id) === Number(id)) || null;
}

function progressBar(counts) {
  // counts: Map(statusId -> n) plus untested
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  const parts = [];
  for (const [sid, n] of counts) {
    if (!n) continue;
    const st = statusById(sid);
    const color = sid === 'untested' ? '#c8c9ca' : statusColor(st);
    const name = sid === 'untested' ? 'Untested' : st ? st.name : `Status ${sid}`;
    parts.push(`<span style="width:${(n / total) * 100}%;background:${color}" title="${escapeHtml(name)}: ${n}"></span>`);
  }
  return parts.join('');
}

function runCounts(run) {
  const counts = new Map();
  for (const st of state.statuses) {
    const n = Number(run[`status${st.id}_count`] || 0);
    if (n && !st.is_untested) counts.set(Number(st.id), n);
  }
  counts.set('untested', Number(run.untested_count || 0));
  return counts;
}

function renderRuns() {
  const q = $('#in-run-search').value.trim().toLowerCase();
  const list = $('#runs-list');
  list.innerHTML = '';
  const milestone = currentMilestoneChoice();
  const runs = state.runs.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || String(r.id).includes(q))) return false;
    if (milestone === 'none' && r.milestone_id) return false;
    if (milestone !== 'all' && milestone !== 'none' && Number(r.milestone_id) !== Number(milestone)) return false;
    if (state.assigned && !state.assigned.ids.has(Number(r.id))) return false;
    return true;
  });
  $('#runs-empty').hidden = runs.length > 0;
  $('#runs-empty').textContent = state.assigned ? 'No runs with tests assigned to you here.' : 'No runs found for this milestone.';
  for (const run of runs) {
    const total = Number(run.total_count || 0);
    const done = Number(run.completed_count || 0);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const assignedCount = state.assigned && state.assigned.counts.get(Number(run.id));
    const el = document.createElement('button');
    el.className = 'item item--run';
    el.innerHTML = `
      <div class="item__main">
        <div class="item__title">${escapeHtml(run.name)}</div>
        <div class="progress">${progressBar(runCounts(run))}</div>
        <div class="item__sub">
          <span class="chip">${pct}%</span>
          <span>${done}/${total} done</span>
          ${assignedCount ? `<span class="chip chip--me">${assignedCount} assigned to me</span>` : ''}
          ${run.is_closed ? '<span class="chip">closed</span>' : ''}
          <span class="muted">${escapeHtml(fmtDate(run.created_at))}</span>
        </div>
      </div>`;
    el.addEventListener('click', () => openRun(run));
    list.appendChild(el);
  }
}

// ---------------------------------------------------------------------------
// Run view
// ---------------------------------------------------------------------------
async function openRun(run) {
  stopTimer();
  state.run = run;
  state.runCases = [];
  state.current = null;
  state.settings = await store.updateSettings({ lastRunId: run.id });
  show('run');
  $('#run-name').textContent = run.name;
  const ms = milestoneById(run.milestone_id);
  $('#run-milestone').textContent = ms ? ms.name : '';
  $('#run-progress').innerHTML = progressBar(runCounts(run));
  $('#run-meta').textContent = '';
  $('#cases-list').innerHTML = '';
  $('#session-banner').hidden = true;
  $('#run-loading').hidden = false;
  try {
    await loadRunData();
  } catch (err) {
    toast(err.message, { error: true, ms: 6000 });
  } finally {
    $('#run-loading').hidden = true;
  }
}

async function loadRunData() {
  const run = await state.api.getRun(state.run.id);
  state.run = run;
  const caseIds = (run.case_ids || []).map(Number);
  $('#run-loading').textContent = `Loading ${caseIds.length} tests…`;

  const cases = await loadCases({
    api: state.api,
    projectId: run.project_id,
    caseIds,
    cache: state.caseCache,
    onProgress: (n, total) => ($('#run-loading').textContent = `Loading tests… ${n}/${total}`),
  });

  $('#run-loading').textContent = 'Matching tests to run…';
  const { byCase, unresolved, sessionLoggedIn } = await resolveTestIds({
    api: state.api,
    session: state.session,
    runId: run.id,
    caseIds,
    onProgress: (n, total) => ($('#run-loading').textContent = `Matching tests to run… ${n}/${total}`),
  });
  state.unresolved = new Set(unresolved);

  const runCases = caseIds.map((caseId) => {
    const hit = byCase.get(caseId) || {};
    return { caseId, case: cases.get(caseId) || { id: caseId, name: `Case ${caseId}` }, testId: hit.testId || null, latest: hit.latest || null };
  });
  await loadFolderNames(runCases.map((rc) => rc.case.folder_id).filter(Boolean));
  state.runCases = sortRunCases(runCases, state.folderCache);

  const drafts = await db.listDraftsForRun(state.settings.instanceUrl, run.id);
  state.drafts = new Map(drafts.map((d) => [Number(d.key.split('|').pop()), d]));
  state.shotCounts = await db.countShotsForRun(state.settings.instanceUrl, run.id);

  $('#set-session').textContent = sessionLoggedIn ? 'signed in' : 'not signed in';
  const banner = $('#session-banner');
  if (unresolved.length) {
    banner.innerHTML = sessionLoggedIn === false
      ? `${unresolved.length} untested test${unresolved.length > 1 ? 's' : ''} cannot receive results until you <a href="${state.settings.instanceUrl}/auth/login" target="_blank" rel="noopener">sign in to Testmo</a> in this browser, then refresh. (Testmo's API only exposes test ids once a result exists.)`
      : `${unresolved.length} test${unresolved.length > 1 ? 's' : ''} could not be matched to this run. Refresh to retry.`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
  renderRunHeader();
  renderCases();
}

async function loadFolderNames(folderIds) {
  const missing = [...new Set(folderIds.map(Number))].filter((id) => !state.folderCache.has(id));
  await Promise.all(
    missing.map(async (id) => {
      try {
        state.folderCache.set(id, await state.api.getFolder(id));
      } catch {
        state.folderCache.set(id, { id, name: `Folder ${id}` });
      }
    }),
  );
}

function folderName(folderId) {
  const f = state.folderCache.get(Number(folderId));
  return f ? f.name : '';
}

function localCounts() {
  const counts = new Map();
  for (const rc of state.runCases) {
    const sid = rc.latest ? Number(rc.latest.status_id) : 'untested';
    counts.set(sid, (counts.get(sid) || 0) + 1);
  }
  return counts;
}

function renderRunHeader() {
  const counts = localCounts();
  $('#run-progress').innerHTML = progressBar(counts);
  const total = state.runCases.length;
  const untested = counts.get('untested') || 0;
  const pct = total ? Math.round(((total - untested) / total) * 100) : 0;
  const parts = [`<span class="chip chip--strong">${pct}% · ${total - untested}/${total} done</span>`];
  for (const [sid, n] of counts) {
    if (sid === 'untested') continue;
    const st = statusById(sid);
    parts.push(`<span class="chip"><span class="dot" style="background:${statusColor(st)}"></span>${escapeHtml(st ? st.name : sid)} <b>${n}</b></span>`);
  }
  if (untested) parts.push(`<span class="chip"><span class="dot"></span>Untested <b>${untested}</b></span>`);
  $('#run-meta').innerHTML = parts.join('');
}

function caseMatchesFilter(rc, filter, q) {
  if (q) {
    const hay = `${rc.caseId} ${rc.case.name || ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  const st = rc.latest ? statusById(rc.latest.status_id) : null;
  if (filter === 'untested') return !rc.latest;
  if (filter === 'done') return Boolean(rc.latest);
  if (filter === 'failed') return Boolean(st && /fail|block/i.test(st.name));
  if (filter === 'drafts') return state.drafts.has(rc.caseId) || state.shotCounts.has(rc.caseId);
  return true;
}

function renderCases() {
  const list = $('#cases-list');
  list.innerHTML = '';
  $('#btn-addcase').hidden = !state.run || Boolean(state.run.is_closed) || !state.runCases.length;
  const q = $('#in-case-search').value.trim().toLowerCase();
  const filter = $('#sel-case-filter').value;
  let lastFolder = null;
  const multipleFolders = new Set(state.runCases.map((rc) => rc.case.folder_id)).size > 1;
  state.runCases.forEach((rc, idx) => {
    if (!caseMatchesFilter(rc, filter, q)) return;
    if (multipleFolders && rc.case.folder_id !== lastFolder) {
      lastFolder = rc.case.folder_id;
      const h = document.createElement('div');
      h.className = 'group-head';
      const n = state.runCases.filter((x) => x.case.folder_id === lastFolder).length;
      h.innerHTML = `<span>${escapeHtml(folderName(lastFolder) || 'Tests')}</span><span class="muted">${n}</span>`;
      list.appendChild(h);
    }
    const st = rc.latest ? statusById(rc.latest.status_id) : null;
    const color = st ? statusColor(st) : '#c8c9ca';
    const draft = state.drafts.get(rc.caseId);
    const shots = state.shotCounts.get(rc.caseId) || 0;
    const el = document.createElement('button');
    el.className = 'item item--test' + (idx === state.current ? ' item--active' : '') + (st ? '' : ' item--untested');
    el.style.setProperty('--status', color);
    el.innerHTML = `
      <span class="item__idx">${idx + 1}</span>
      <div class="item__main">
        <div class="item__title">${escapeHtml(rc.case.name || `Case ${rc.caseId}`)}</div>
        <div class="item__sub">
          <span class="chip chip--status" style="--status:${color}">${escapeHtml(st ? st.name : 'Untested')}</span>
          <span class="muted">C${rc.caseId}</span>
          ${draft && (draft.note || draft.statusId) ? '<span class="chip chip--draft" title="Unsubmitted notes">✎ draft</span>' : ''}
          ${shots ? `<span class="chip chip--draft" title="Unsubmitted screenshots">📷 ${shots}</span>` : ''}
          ${!rc.testId ? '<span class="chip chip--warn" title="Cannot submit yet">no test id</span>' : ''}
        </div>
      </div>`;
    el.addEventListener('click', () => openCase(idx));
    list.appendChild(el);
  });
}

function openRunScreen() {
  stopTimer();
  show('run', { push: false });
  renderRunHeader();
  renderCases();
}

// ---------------------------------------------------------------------------
// Case view
// ---------------------------------------------------------------------------
function currentCase() {
  return state.current === null ? null : state.runCases[state.current];
}

function draftKey(rc) {
  return db.caseKey(state.settings.instanceUrl, state.run.id, rc.caseId);
}

async function openCase(idx) {
  if (idx < 0 || idx >= state.runCases.length) return;
  if (state.recorder && state.recorder.active) await stopRecording();
  await persistTimer();
  stopTimer();
  state.current = idx;
  const rc = state.runCases[idx];
  show('case');
  renderCase(rc);
  const draft = await db.getDraft(draftKey(rc));
  $('#in-notes').value = (draft && draft.note) || '';
  state.selectedStatus = (draft && draft.statusId) || null;
  renderStatusButtons();
  startTimer((draft && draft.elapsed) || 0);
  $('#in-autoadvance').checked = state.settings.autoAdvance;
  showError('#submit-error', null);
  showError('#capture-error', null);
  await renderShots();
  loadHistory(rc).catch(() => {});
}

function renderFieldValue(field, baseUrl) {
  if (field.type === 'steps' && Array.isArray(field.value)) {
    const steps = [...field.value].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    return `<div class="steps">${steps
      .map((s) => {
        const extra = [s.text2, s.text4].filter(Boolean).map((t) => `<div class="step__extra">${sanitizeHtml(t, { baseUrl })}</div>`).join('');
        return `<div class="step"><span class="step__num"></span><div>
          <div>${sanitizeHtml(s.text1, { baseUrl })}</div>
          ${s.text3 ? `<div class="step__expected"><div class="step__label">Expected</div>${sanitizeHtml(s.text3, { baseUrl })}</div>` : ''}
          ${extra}
        </div></div>`;
      })
      .join('')}</div>`;
  }
  if (field.type === 'dropdown' && field.value && typeof field.value === 'object') {
    return `<span class="pill">${escapeHtml(field.value.name || field.value.id)}</span>`;
  }
  if (typeof field.value === 'object') return `<pre>${escapeHtml(JSON.stringify(field.value, null, 2))}</pre>`;
  return sanitizeHtml(String(field.value), { baseUrl });
}

function renderCase(rc) {
  const st = rc.latest ? statusById(rc.latest.status_id) : null;
  $('#case-pos').textContent = `${state.current + 1} / ${state.runCases.length}`;
  $('#btn-prev').disabled = state.current === 0;
  $('#btn-next').disabled = state.current >= state.runCases.length - 1;
  $('#case-title').textContent = rc.case.name || `Case ${rc.caseId}`;
  $('#case-key').textContent = `C${rc.caseId}`;
  const stEl = $('#case-status');
  stEl.textContent = st ? st.name : 'Untested';
  stEl.className = 'pill' + (st ? ' pill--status' : '');
  stEl.style.background = st ? statusColor(st) : '';
  const link = $('#case-link');
  link.href = rc.testId
    ? `${state.settings.instanceUrl}/runs/view/${state.run.id}?test_id=${rc.testId}`
    : `${state.settings.instanceUrl}/runs/view/${state.run.id}`;

  const fields = describeFields(rc.case, state.templates, state.fields);
  const body = $('#case-fields-body');
  body.innerHTML = fields.length
    ? fields
        .map((f) => `<div class="field"><div class="field__name">${escapeHtml(f.name)}</div><div class="field__body">${renderFieldValue(f, state.settings.instanceUrl)}</div></div>`)
        .join('')
    : '<p class="muted">This case has no instructions.</p>';
  upgradeGherkinBlocks(body);
  $('#case-history-body').innerHTML = '<p class="muted">Loading…</p>';
  $('#case-history-count').textContent = '';
}

async function loadHistory(rc) {
  const body = $('#case-history-body');
  if (!rc.testId) {
    body.innerHTML = '<p class="muted">No results yet.</p>';
    return;
  }
  const results = await state.api.getResultsForTest(state.run.id, rc.testId);
  if (currentCase() !== rc) return;
  results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  $('#case-history-count').textContent = results.length ? `(${results.length})` : '';
  body.innerHTML = results.length
    ? results
        .map((r) => {
          const st = statusById(r.status_id);
          return `<div class="history">
            <div class="history__meta"><span class="dot" style="background:${statusColor(st)}"></span><strong>${escapeHtml(st ? st.name : r.status_id)}</strong><span>${escapeHtml(fmtDate(r.created_at))}</span>${r.elapsed ? `<span>${fmtElapsed(r.elapsed)}</span>` : ''}</div>
            <div class="history__note">${sanitizeHtml(r.note, { baseUrl: state.settings.instanceUrl })}</div>
          </div>`;
        })
        .join('')
    : '<p class="muted">No results yet.</p>';
}

function visibleStatuses() {
  return state.statuses.filter((s) => !s.is_untested && s.name && !/^unnamed$/i.test(s.name));
}

function renderStatusButtons() {
  const wrap = $('#status-buttons');
  wrap.innerHTML = '';
  const statuses = visibleStatuses();
  statuses.forEach((st, i) => {
    const b = document.createElement('button');
    const major = i < 2;
    b.className = 'status-btn' + (major ? '' : ' status-btn--minor');
    const color = statusColor(st);
    b.textContent = st.name;
    b.style.borderColor = color;
    if (Number(state.selectedStatus) === Number(st.id)) {
      b.classList.add('status-btn--selected');
      b.style.background = color;
    }
    b.title = major ? `Shortcut: ${st.name[0].toUpperCase()}` : '';
    b.addEventListener('click', () => selectStatus(st.id));
    wrap.appendChild(b);
  });
  $('#btn-submit').disabled = !state.selectedStatus;
}

async function selectStatus(id) {
  state.selectedStatus = Number(state.selectedStatus) === Number(id) ? null : Number(id);
  showError('#submit-error', null);
  renderStatusButtons();
  const rc = currentCase();
  if (rc) {
    await db.saveDraft(draftKey(rc), { statusId: state.selectedStatus });
    state.drafts.set(rc.caseId, await db.getDraft(draftKey(rc)));
  }
}

let noteSaveHandle;
function onNotesInput() {
  clearTimeout(noteSaveHandle);
  noteSaveHandle = setTimeout(async () => {
    const rc = currentCase();
    if (!rc) return;
    const note = $('#in-notes').value;
    await db.saveDraft(draftKey(rc), { note });
    state.drafts.set(rc.caseId, await db.getDraft(draftKey(rc)));
  }, 300);
}

// --- timer ---
function startTimer(baseSec) {
  state.timer = { startedAt: Date.now(), base: baseSec || 0, handle: setInterval(tickTimer, 1000) };
  tickTimer();
}
function elapsedSeconds() {
  const t = state.timer;
  if (!t.startedAt) return t.base || 0;
  return t.base + Math.floor((Date.now() - t.startedAt) / 1000);
}
function tickTimer() {
  $('#timer').textContent = fmtElapsed(elapsedSeconds());
}
function stopTimer() {
  if (state.timer.handle) clearInterval(state.timer.handle);
  state.timer = { startedAt: null, base: elapsedSeconds(), handle: null };
}
async function persistTimer() {
  const rc = currentCase();
  if (!rc || !state.timer.startedAt) return;
  await db.saveDraft(draftKey(rc), { elapsed: elapsedSeconds() });
}

// --- screenshots ---
async function renderShots() {
  const rc = currentCase();
  if (!rc) return;
  const shots = await db.listShots(draftKey(rc));
  const wrap = $('#shots');
  wrap.innerHTML = '';
  for (const s of shots) {
    const el = document.createElement('div');
    if (s.kind === 'video') {
      el.className = 'shot shot--video';
      el.title = 'Click to play the recording';
      const size = s.blob.size >= 1048576 ? `${(s.blob.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(s.blob.size / 1024))} KB`;
      el.innerHTML = `<span class="shot__play">▶</span><span>${fmtClock(s.duration || 0)} · ${size}</span>`;
      const del = document.createElement('button');
      del.className = 'shot__del';
      del.textContent = '×';
      del.title = 'Delete recording';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        await db.deleteShot(s.id);
        await renderShots();
      });
      el.appendChild(del);
      el.addEventListener('click', () => openPreview(s.id));
      wrap.appendChild(el);
      continue;
    }
    el.className = 'shot';
    el.title = 'Click to annotate';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(s.blob);
    img.onload = () => URL.revokeObjectURL(img.src);
    el.appendChild(img);
    if (s.annotated) {
      const b = document.createElement('span');
      b.className = 'shot__badge';
      b.textContent = 'annotated';
      el.appendChild(b);
    }
    const del = document.createElement('button');
    del.className = 'shot__del';
    del.textContent = '×';
    del.title = 'Delete screenshot';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await db.deleteShot(s.id);
      await renderShots();
    });
    el.appendChild(del);
    el.addEventListener('click', () => openAnnotator(s.id));
    wrap.appendChild(el);
  }
  $('#shots-count').textContent = shots.length ? `(${shots.length})` : '';
  state.shotCounts.set(rc.caseId, shots.length);
  if (!shots.length) state.shotCounts.delete(rc.caseId);
}

// Decode without fetch(): the extension CSP only allows https connections.
async function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Unexpected screenshot format.');
  const mime = m[1] || 'image/png';
  if (m[2]) {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(m[3])], { type: mime });
}

async function storeCapture({ dataUrl, tabUrl, tabTitle }, { annotate = true } = {}) {
  const rc = currentCase();
  if (!rc) throw new Error('Open a test case first.');
  const blob = await dataUrlToBlob(dataUrl);
  const id = await db.addShot(draftKey(rc), blob, { tabUrl: redactUrl(tabUrl || ''), tabTitle: String(tabTitle || '').slice(0, 200), annotated: false });
  await renderShots();
  if (annotate) await openAnnotator(id);
  return id;
}

async function onCapture() {
  showError('#capture-error', null);
  const btn = $('#btn-capture');
  busy(btn, true, 'Capturing…');
  try {
    let shot;
    try {
      shot = await captureActiveTab();
    } catch (err) {
      if (err.code !== 'NEEDS_PERMISSION') throw err;
      const granted = await requestCapturePermission();
      if (!granted) throw new Error('Screenshot permission was not granted. Chrome only allows tab capture with the "all sites" permission, which you can revoke any time in Settings.');
      shot = await captureActiveTab();
    }
    await storeCapture(shot);
  } catch (err) {
    showError('#capture-error', err);
  } finally {
    busy(btn, false);
  }
}

async function attachFiles(files) {
  showError('#capture-error', null);
  const rc = currentCase();
  if (!rc) return;
  const { accepted, rejected } = partitionFiles(files);
  try {
    for (const f of accepted) await db.addShot(draftKey(rc), f, { fileName: String(f.name || '').slice(0, 200), annotated: false });
  } catch (err) {
    showError('#capture-error', err);
  }
  if (accepted.length) await renderShots();
  if (rejected.length) showError('#capture-error', new Error(`Only PNG, JPEG, GIF and WebP images can be attached. Skipped: ${rejected.join(', ')}`));
}

function hasFiles(e) {
  return Boolean(e.dataTransfer && [...e.dataTransfer.types].includes('Files'));
}

function bindEvidenceDrop() {
  const zone = $('#evidence');
  let depth = 0;
  const reset = () => {
    depth = 0;
    zone.classList.remove('evidence--drop');
  };
  zone.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    zone.classList.add('evidence--drop');
  });
  zone.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  zone.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) reset();
  });
  zone.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    reset();
    attachFiles([...e.dataTransfer.files]);
  });
  // A file dropped anywhere else would navigate the panel away and lose the draft.
  for (const type of ['dragover', 'drop']) {
    document.addEventListener(type, (e) => {
      if (hasFiles(e) && !zone.contains(e.target)) e.preventDefault();
    });
  }
}

async function openPreview(shotId) {
  const url = chrome.runtime.getURL(`annotate/preview.html?shot=${shotId}`);
  await chrome.windows.create({ url, type: 'popup', width: 1100, height: 760, focused: true });
}

// --- step recording ---
function renderRecSteps() {
  const rec = state.recorder;
  if (!rec) return;
  const steps = eventsToSteps(rec.events, rec.startedAt);
  const ol = $('#rec-steps');
  ol.innerHTML = steps.map((s) => `<li>${escapeHtml(s.text)}<span class="muted">${fmtClock(s.at)}</span></li>`).join('');
  ol.scrollTop = ol.scrollHeight;
}

async function toggleRecording() {
  if (state.recorder && state.recorder.active) return stopRecording();
  const rc = currentCase();
  if (!rc) return;
  showError('#capture-error', null);
  const btn = $('#btn-record');
  try {
    const tab = await getActiveTab();
    const rec = new TabRecorder({
      onEvent: () => renderRecSteps(),
      onStatus: (msg) => {
        if (msg === 'ended') stopRecording().catch((err) => showError('#capture-error', err));
        else $('#rec-status').textContent = msg;
      },
    });
    busy(btn, true, 'Starting…');
    await rec.start(tab);
    state.recorder = rec;
    state.recCaseKey = draftKey(rc);
    busy(btn, false);
    btn.textContent = '■ Stop recording';
    btn.classList.add('btn--recording');
    $('#recording').hidden = false;
    $('#rec-status').textContent = rec.source === 'tabCapture' ? '' : 'sharing via Chrome tab picker';
    $('#rec-steps').innerHTML = '';
    clearInterval(state.recTick);
    state.recTick = setInterval(() => ($('#rec-time').textContent = fmtClock(Math.round((Date.now() - rec.startedAt) / 1000))), 500);
  } catch (err) {
    busy(btn, false);
    const msg = String(err && err.message || err);
    if (/NotAllowedError|Permission denied|denied/i.test(msg)) showError('#capture-error', new Error('Recording was cancelled or not permitted.'));
    else if (/Cannot access|host permission|permission/i.test(msg)) {
      showError('#capture-error', new Error('Screenshot/recording permission is needed. Press Capture once to grant it, then record.'));
    } else showError('#capture-error', err);
  }
}

async function stopRecording() {
  const rec = state.recorder;
  if (!rec) return;
  clearInterval(state.recTick);
  const btn = $('#btn-record');
  busy(btn, true, 'Saving…');
  try {
    const result = await rec.stop();
    state.recorder = null;
    const steps = eventsToSteps(result.events, result.startedAt);
    const key = state.recCaseKey;
    if (result.blob.size > 0) {
      await db.addShot(key, result.blob, { kind: 'video', mime: 'video/webm', duration: result.duration, steps, annotated: false });
    }
    // Append the steps to the notes of the case that was being recorded.
    const rc = currentCase();
    if (steps.length && rc && draftKey(rc) === key) {
      const notes = $('#in-notes');
      const block = `Steps to reproduce:
${stepsToText(steps)}`;
      notes.value = notes.value.trim() ? `${notes.value.trim()}

${block}` : block;
      onNotesInput();
    } else if (steps.length) {
      const existing = (await db.getDraft(key)) || {};
      const block = `Steps to reproduce:
${stepsToText(steps)}`;
      await db.saveDraft(key, { note: existing.note ? `${existing.note.trim()}

${block}` : block });
    }
    toast(result.blob.size ? `Recording saved (${fmtClock(result.duration)}, ${steps.length} steps)` : `Steps saved (${steps.length}); no video captured`);
    await renderShots();
  } catch (err) {
    showError('#capture-error', err);
  } finally {
    busy(btn, false);
    btn.textContent = '● Record steps';
    btn.classList.remove('btn--recording');
    $('#recording').hidden = true;
    state.recCaseKey = null;
  }
}

async function openAnnotator(shotId) {
  const url = chrome.runtime.getURL(`annotate/annotate.html?shot=${shotId}`);
  const width = Math.min(1400, Math.max(900, (screen.availWidth || 1200) - 80));
  const height = Math.min(1000, Math.max(640, (screen.availHeight || 800) - 80));
  await chrome.windows.create({ url, type: 'popup', width, height, focused: true });
}

// --- submit ---
function buildComment(note, shots, attachmentLinks) {
  let html = textToHtml(note);
  if (state.settings.includeTabUrl) {
    const urls = [...new Set(shots.map((s) => s.tabUrl).filter(Boolean).map(redactUrl))];
    if (urls.length) {
      html += `<p><em>Tested on:</em> ${urls.map((u) => `<a href="${escapeHtml(u)}">${escapeHtml(u)}</a>`).join(', ')}</p>`;
    }
  }
  for (const link of attachmentLinks) {
    if (link.video) html += `<p>🎬 Recording: <a href="${escapeHtml(link.url)}">${escapeHtml(link.name)}</a></p>`;
    else html += `<p><a href="${escapeHtml(link.url)}">${escapeHtml(link.name)}</a><br><img src="${escapeHtml(link.url)}" alt="${escapeHtml(link.name)}"></p>`;
  }
  return html;
}

async function onSubmit() {
  const rc = currentCase();
  if (!rc || !state.selectedStatus) return;
  showError('#submit-error', null);
  $('#toast').hidden = true;
  const btn = $('#btn-submit');
  busy(btn, true, 'Submitting…');
  try {
    if (!rc.testId) {
      // One more try: the user may have signed in since the run was loaded.
      const { byCase } = await resolveTestIds({ api: state.api, session: state.session, runId: state.run.id, caseIds: [rc.caseId] });
      const hit = byCase.get(rc.caseId);
      if (hit) rc.testId = hit.testId;
    }
    if (!rc.testId) {
      throw new Error(`Testmo's API does not expose this test's id until it has a result. Sign in to Testmo in this browser (${state.settings.instanceUrl}) and press refresh, or record the first result in Testmo itself.`);
    }
    await persistTimer();
    const elapsed = elapsedSeconds();
    const note = $('#in-notes').value;
    const shots = await db.listShots(draftKey(rc));
    const slug = timestampSlug();
    let result;
    let via = 'api';
    let webErr = null;

    const sessionOk = state.session.loggedIn ?? (await state.session.probe(state.run.id));
    if (sessionOk) {
      // Preferred: attachments land on the result itself, like in the Testmo UI.
      try {
        const uploaded = [];
        for (const [i, s] of shots.entries()) {
          busy(btn, true, `Uploading ${i + 1}/${shots.length}…`);
          uploaded.push(await state.session.uploadAttachment(state.run.project_id, s.blob, evidenceName(rc.caseId, slug, i, s)));
        }
        busy(btn, true, 'Saving result…');
        await state.session.createResult(rc.testId, { statusId: state.selectedStatus, comment: buildComment(note, shots, []), elapsed, attachments: uploaded });
        via = 'web';
      } catch (err) {
        console.warn('Web-session submit failed, falling back to REST API', err);
        webErr = err;
        via = 'api';
      }
    }
    if (via === 'api') {
      try {
        const links = [];
        for (const [i, s] of shots.entries()) {
          busy(btn, true, `Uploading ${i + 1}/${shots.length}…`);
          const name = evidenceName(rc.caseId, slug, i, s);
          const att = await state.api.uploadCaseAttachment(rc.caseId, s.blob, name);
          const url = att.path && /^https?:/.test(att.path) ? att.path : `${state.settings.instanceUrl}/attachments/view/${att.id}`;
          links.push({ url, name, video: s.kind === 'video' });
        }
        busy(btn, true, 'Saving result…');
        result = await state.api.createResult(state.run.id, rc.testId, { statusId: state.selectedStatus, comment: buildComment(note, shots, links), elapsed });
      } catch (err) {
        const st = statusById(state.selectedStatus);
        throw new Error(submitFailureMessage(st ? st.name : `Status ${state.selectedStatus}`, err, webErr));
      }
    }
    // Re-read the latest result so the list reflects exactly what Testmo stored.
    const fresh = await state.api.getResultsForTest(state.run.id, rc.testId);
    fresh.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    rc.latest = fresh[0] || result || { status_id: state.selectedStatus };

    await db.deleteDraft(draftKey(rc));
    await db.deleteShotsForCase(draftKey(rc));
    state.drafts.delete(rc.caseId);
    state.shotCounts.delete(rc.caseId);
    state.selectedStatus = null;
    $('#in-notes').value = '';
    stopTimer();
    state.timer.base = 0;
    const st = statusById(rc.latest.status_id);
    const nVideo = shots.filter((s) => s.kind === 'video').length;
    const nImg = shots.length - nVideo;
    const parts = [];
    if (nImg) parts.push(`${nImg} screenshot${nImg > 1 ? 's' : ''}`);
    if (nVideo) parts.push(`${nVideo} recording${nVideo > 1 ? 's' : ''}`);
    toast(`Saved: ${st ? st.name : 'result'}${parts.length ? ` with ${parts.join(' and ')}` : ''}`);
    renderRunHeader();
    if ($('#in-autoadvance').checked) {
      const nextIdx = state.runCases.findIndex((c, i) => i > state.current && !c.latest);
      if (nextIdx !== -1) return openCase(nextIdx);
    }
    await openCase(state.current);
  } catch (err) {
    showError('#submit-error', err);
  } finally {
    busy(btn, false);
    $('#btn-submit').disabled = !state.selectedStatus;
  }
}

// ---------------------------------------------------------------------------
// Add a test case to the run
// ---------------------------------------------------------------------------
const nc = { formFields: [], stepsRows: new Map() };

function openNewCase() {
  if (!state.run) return;
  showError('#nc-error', null);
  $('#nc-name').value = '';
  const folderSel = $('#nc-folder');
  folderSel.innerHTML = '';
  const folderIds = [...new Set(state.runCases.map((rc) => Number(rc.case.folder_id)).filter(Boolean))];
  for (const id of folderIds) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = folderName(id) || `Folder ${id}`;
    folderSel.appendChild(o);
  }
  const def = defaultFolderId(state.runCases, currentCase());
  if (def) folderSel.value = String(def);
  const tplSel = $('#nc-template');
  tplSel.innerHTML = '';
  const templates = [...state.templates].sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)));
  for (const t of templates) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name;
    tplSel.appendChild(o);
  }
  const preferred = templates.find((t) => /bdd|gherkin/i.test(t.name)) || templates.find((t) => t.is_default) || templates[0];
  if (preferred) tplSel.value = String(preferred.id);
  renderNewCaseFields();
  show('newcase');
  setTimeout(() => $('#nc-name').focus(), 50);
}

function renderNewCaseFields() {
  const template = state.templates.find((t) => Number(t.id) === Number($('#nc-template').value));
  nc.formFields = formFieldsForTemplate(template, state.fields);
  nc.stepsRows = new Map();
  const wrap = $('#nc-fields');
  wrap.innerHTML = '';
  for (const f of nc.formFields) {
    const label = document.createElement('label');
    label.textContent = f.name;
    label.htmlFor = `nc-f-${f.id}`;
    wrap.appendChild(label);
    if (f.kind === 'dropdown') {
      const sel = document.createElement('select');
      sel.id = `nc-f-${f.id}`;
      sel.dataset.column = f.column;
      for (const o of f.options) {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.value;
        sel.appendChild(opt);
      }
      const normal = f.options.find((o) => /normal|medium/i.test(o.value));
      if (normal) sel.value = String(normal.id);
      wrap.appendChild(sel);
    } else if (f.kind === 'steps') {
      const box = document.createElement('div');
      box.className = 'steps-editor';
      box.dataset.column = f.column;
      const rows = [{ step: '', expected: '' }];
      nc.stepsRows.set(f.column, rows);
      const draw = () => {
        box.innerHTML = '';
        rows.forEach((r, i) => {
          const row = document.createElement('div');
          row.className = 'step-row';
          const s = document.createElement('textarea');
          s.placeholder = `Step ${i + 1}`;
          s.value = r.step;
          s.addEventListener('input', () => (r.step = s.value));
          const e = document.createElement('textarea');
          e.placeholder = 'Expected result';
          e.value = r.expected;
          e.addEventListener('input', () => (r.expected = e.value));
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'step-del';
          del.textContent = '×';
          del.title = 'Remove step';
          del.addEventListener('click', () => {
            rows.splice(i, 1);
            if (!rows.length) rows.push({ step: '', expected: '' });
            draw();
          });
          row.append(s, e, del);
          box.appendChild(row);
        });
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'btn btn--small';
        add.textContent = '+ Add step';
        add.addEventListener('click', () => {
          rows.push({ step: '', expected: '' });
          draw();
        });
        box.appendChild(add);
      };
      draw();
      wrap.appendChild(box);
    } else if (f.gherkin) {
      wrap.appendChild(buildGherkinEditor(f));
    } else {
      const ta = document.createElement('textarea');
      ta.id = `nc-f-${f.id}`;
      ta.dataset.column = f.column;
      ta.rows = 3;
      wrap.appendChild(ta);
    }
  }
}

function buildGherkinEditor(f) {
  const box = document.createElement('div');
  box.className = 'gk-editor';
  const bar = document.createElement('div');
  bar.className = 'gk-toolbar';
  const ta = document.createElement('textarea');
  ta.id = `nc-f-${f.id}`;
  ta.dataset.column = f.column;
  ta.dataset.gherkin = '1';
  ta.value = GHERKIN_TEMPLATE;
  ta.spellcheck = false;
  const preview = document.createElement('details');
  preview.className = 'gk-preview';
  preview.open = true;
  preview.innerHTML = '<summary>Preview</summary><div class="gk-preview-body"></div>';
  const body = preview.querySelector('.gk-preview-body');
  const refresh = () => {
    body.innerHTML = renderGherkin(ta.value);
    if (!$('#nc-name').value.trim()) $('#nc-name').placeholder = deriveNameFromGherkin(ta.value) || 'Leave empty to use the Scenario title';
  };
  const insertLine = (kw) => {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const after = ta.value.slice(ta.selectionEnd);
    const atLineStart = before === '' || before.endsWith('\n');
    const text = `${atLineStart ? '' : '\n'}\t${kw} `;
    ta.value = before + text + after;
    ta.selectionStart = ta.selectionEnd = before.length + text.length;
    ta.focus();
    refresh();
  };
  for (const [kw, cls] of [['Given', 'kw-given'], ['When', 'kw-when'], ['Then', 'kw-then'], ['And', ''], ['But', '']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = kw;
    b.addEventListener('click', () => insertLine(kw));
    bar.appendChild(b);
  }
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const pos = ta.selectionStart;
      ta.value = `${ta.value.slice(0, pos)}\t${ta.value.slice(ta.selectionEnd)}`;
      ta.selectionStart = ta.selectionEnd = pos + 1;
      refresh();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // Keep the indentation of the current line, like a code editor.
      const pos = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
      const indent = (ta.value.slice(lineStart, pos).match(/^[\t ]*/) || [''])[0];
      e.preventDefault();
      ta.value = `${ta.value.slice(0, pos)}\n${indent}${ta.value.slice(ta.selectionEnd)}`;
      ta.selectionStart = ta.selectionEnd = pos + 1 + indent.length;
      refresh();
    }
  });
  ta.addEventListener('input', refresh);
  box.append(bar, ta, preview);
  setTimeout(() => {
    refresh();
    ta.focus();
    ta.selectionStart = ta.selectionEnd = 'Scenario: '.length;
  }, 60);
  return box;
}

function collectNewCaseValues() {
  const values = {};
  for (const f of nc.formFields) {
    if (f.kind === 'steps') values[f.column] = nc.stepsRows.get(f.column) || [];
    else {
      const el = document.getElementById(`nc-f-${f.id}`);
      values[f.column] = el ? el.value : '';
    }
  }
  return values;
}

async function onNewCaseSubmit(e) {
  e.preventDefault();
  showError('#nc-error', null);
  const btn = $('#nc-submit');
  try {
    const values = collectNewCaseValues();
    const gherkinField = nc.formFields.find((f) => f.gherkin);
    const gherkinText = gherkinField ? values[gherkinField.column] : '';
    let name = $('#nc-name').value.trim();
    if (!name && gherkinText) name = deriveNameFromGherkin(gherkinText);
    if (gherkinField && !/^\s*(Given|When|Then|And|But)\b/m.test(gherkinText)) throw new Error('Add at least one Given / When / Then step.');
    const payload = buildCasePayload({ name, folderId: $('#nc-folder').value, templateId: $('#nc-template').value, formFields: nc.formFields, values });
    busy(btn, true, 'Creating case…');
    const created = await state.api.createCase(state.run.project_id, payload);
    state.caseCache.set(Number(created.id), created);
    if (!state.run.include_all) {
      busy(btn, true, 'Adding to run…');
      const ids = [...new Set([...state.run.case_ids.map(Number), Number(created.id)])];
      await state.api.updateRunCases(state.run.id, ids);
    }
    busy(btn, true, 'Refreshing…');
    await loadRunData();
    toast(`Added C${created.id} to the run`);
    const idx = state.runCases.findIndex((rc) => rc.caseId === Number(created.id));
    if (idx !== -1) await openCase(idx);
    else openRunScreen();
  } catch (err) {
    showError('#nc-error', err);
  } finally {
    busy(btn, false);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function renderCapturePermission() {
  const has = await hasCapturePermission();
  $('#set-capture-state').textContent = has ? 'granted for all sites' : 'not granted (asked on first capture)';
  $('#btn-capture-toggle').textContent = has ? 'Revoke screenshot permission' : 'Grant screenshot permission';
}

function openSettings() {
  renderCapturePermission();
  $('#set-include-url').checked = Boolean(state.settings.includeTabUrl);
  $('#set-instance').textContent = state.settings.instanceUrl;
  $('#set-user').textContent = state.user ? state.user.name : '';
  $('#set-session').textContent = state.session && state.session.loggedIn === true ? 'signed in' : state.session && state.session.loggedIn === false ? 'not signed in' : 'unknown until a run is opened';
  show('settings');
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function wireEvents() {
  $('#form-connect').addEventListener('submit', onConnectSubmit);
  $('#in-remember').addEventListener('change', (e) => ($('#remember-fields').hidden = !e.target.checked));
  $('#form-unlock').addEventListener('submit', onUnlockSubmit);
  $('#btn-forget').addEventListener('click', async () => {
    await store.clearVault();
    show('connect', { push: false });
  });
  $('#btn-back').addEventListener('click', goBack);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#sel-project').addEventListener('change', (e) => selectProject(e.target.value));
  $('#btn-refresh-runs').addEventListener('click', loadRuns);
  $('#in-run-search').addEventListener('input', renderRuns);
  $('#sel-milestone').addEventListener('change', onMilestoneChange);
  $('#in-assigned-me').addEventListener('change', onAssignedToggle);
  $('#in-show-closed').addEventListener('change', loadRuns);
  $('#btn-refresh-run').addEventListener('click', async () => {
    $('#run-loading').hidden = false;
    try {
      if (state.session) state.session.loggedIn = null;
      await loadRunData();
      toast('Refreshed');
    } catch (err) {
      toast(err.message, { error: true, ms: 5000 });
    } finally {
      $('#run-loading').hidden = true;
    }
  });
  $('#in-case-search').addEventListener('input', renderCases);
  $('#sel-case-filter').addEventListener('change', renderCases);
  $('#btn-prev').addEventListener('click', () => openCase(state.current - 1));
  $('#btn-next').addEventListener('click', () => openCase(state.current + 1));
  $('#in-notes').addEventListener('input', onNotesInput);
  $('#btn-capture').addEventListener('click', onCapture);
  $('#in-attach').accept = ATTACH_ACCEPT;
  $('#btn-attach').addEventListener('click', () => $('#in-attach').click());
  $('#in-attach').addEventListener('change', async (e) => {
    await attachFiles([...e.target.files]);
    e.target.value = '';
  });
  bindEvidenceDrop();
  $('#btn-addcase').addEventListener('click', openNewCase);
  $('#nc-cancel').addEventListener('click', goBack);
  $('#nc-template').addEventListener('change', renderNewCaseFields);
  $('#form-newcase').addEventListener('submit', onNewCaseSubmit);
  $('#btn-record').addEventListener('click', toggleRecording);
  $('#btn-submit').addEventListener('click', onSubmit);
  $('#in-autoadvance').addEventListener('change', async (e) => {
    state.settings = await store.updateSettings({ autoAdvance: e.target.checked });
  });
  $('#btn-capture-toggle').addEventListener('click', async () => {
    if (await hasCapturePermission()) await revokeCapturePermission();
    else await requestCapturePermission();
    renderCapturePermission();
  });
  $('#set-include-url').addEventListener('change', async (e) => {
    state.settings = await store.updateSettings({ includeTabUrl: e.target.checked });
  });
  $('#btn-clear-drafts').addEventListener('click', async () => {
    if (!confirm('Delete every unsubmitted note and screenshot stored by this extension?')) return;
    await db.wipeAll();
    state.drafts = new Map();
    state.shotCounts = new Map();
    toast('Local drafts deleted');
  });
  $('#btn-disconnect').addEventListener('click', disconnect);

  // Keyboard shortcuts while on a case (not while typing).
  document.addEventListener('keydown', (e) => {
    if (state.screen !== 'case') return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const statuses = visibleStatuses();
    const key = e.key.toLowerCase();
    if (key === 'arrowright' || key === 'j') return openCase(state.current + 1);
    if (key === 'arrowleft' || key === 'k') return openCase(state.current - 1);
    if (key === 's' && !e.shiftKey) return onCapture();
    if (key === 'enter' && state.selectedStatus) return onSubmit();
    const byInitial = statuses.find((s) => s.name[0].toLowerCase() === key);
    if (byInitial) selectStatus(byInitial.id);
  });

  // Messages from the annotator window and the keyboard-shortcut capture.
  chrome.runtime.onMessage.addListener((msg, sender) => {
    // Only our own extension pages / service worker may drive the panel; the
    // injected recorder (a content script, sender.tab set) talks to the recorder.
    // Extension pages opened as popup windows (the annotator) do have sender.tab,
    // so identify our own contexts by URL rather than by the absence of a tab.
    const own = sender && sender.id === chrome.runtime.id && (!sender.tab || String(sender.url || '').startsWith(chrome.runtime.getURL('')));
    if (!own) return;
    if (msg && msg.type === 'shot-updated') renderShots();
    if (msg && msg.type === 'shortcut-capture' && state.screen === 'case' && typeof msg.dataUrl === 'string' && msg.dataUrl.startsWith('data:image/')) {
      storeCapture({ dataUrl: msg.dataUrl, tabUrl: redactUrl(String(msg.tabUrl || '')), tabTitle: String(msg.tabTitle || '').slice(0, 200) }).catch((err) => showError('#capture-error', err));
    }
  });

  window.addEventListener('beforeunload', () => {
    persistTimer();
  });
}

boot().catch((err) => {
  console.error(err);
  showError('#connect-error', err);
  show('connect', { push: false });
});
