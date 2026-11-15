// End-to-end check: launches Chrome with the extension loaded and drives the
// panel against a real Testmo run. Needs a throwaway run, because it writes
// results. Configuration comes from the environment:
//   TESTMO_URL, TESTMO_API_KEY            required
//   TESTMO_RUN_NAME                       required (a run in the project below)
//   TESTMO_PROJECT_NAME                   default: first project
//   TESTMO_LOGIN_EMAIL / TESTMO_LOGIN_PASSWORD  optional: exercises the web-session path
//   PW_MODULE                             optional: path to a playwright(-core) install
//   PW_EXECUTABLE                         optional: Chromium / Chrome for Testing binary
//   E2E_SCREENSHOTS_DIR                   optional: where to save doc screenshots
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const env = process.env;
for (const k of ['TESTMO_URL', 'TESTMO_API_KEY', 'TESTMO_RUN_NAME']) {
  if (!env[k]) {
    console.error(`Missing ${k}`);
    process.exit(2);
  }
}
const pwModule = env.PW_MODULE ? pathToFileURL(env.PW_MODULE).href : 'playwright';
const { chromium } = await import(pwModule);

const shotsDir = env.E2E_SCREENSHOTS_DIR || null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const snap = async (page, name) => {
  if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
};

let failures = 0;
let panel;
let context;
const step = async (name, fn) => {
  process.stdout.write(`- ${name} … `);
  try {
    const out = await fn();
    console.log('ok' + (out ? ` (${out})` : ''));
  } catch (err) {
    failures += 1;
    console.log(`FAIL\n    ${err.stack || err}`);
    try {
      const diag = await panel.evaluate(() => ({
        screen: [...document.querySelectorAll('section[data-screen]')].find((s) => !s.hidden)?.dataset.screen,
        errors: [...document.querySelectorAll('.error:not([hidden])')].map((e) => e.textContent.trim()),
        toast: document.querySelector('#toast')?.textContent.trim(),
      }));
      console.log('    diag:', JSON.stringify(diag));
      if (shotsDir) await panel.screenshot({ path: path.join(shotsDir, `fail-${name.replace(/\W+/g, '_').slice(0, 40)}.png`) });
    } catch {}
    if (env.E2E_STOP_ON_FAIL) {
      await context.close().catch(() => {});
      process.exit(1);
    }
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// Build a test copy of the extension whose manifest already holds the host
// permissions, so no native permission prompts appear during automation.
const work = fs.mkdtempSync(path.join(env.E2E_TMP || os.tmpdir(), 'tmo-ext-'));
const extDir = path.join(work, 'ext');
fs.cpSync(root, extDir, {
  recursive: true,
  filter: (src) => !/node_modules|\.git|dist|test|docs/.test(src.replace(root, '')),
});
const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
delete manifest.optional_host_permissions;
fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// A tiny local page for the step recorder: input, select, checkbox, button, long body.
const TEST_PAGE = `<!doctype html><html><head><title>Recorder probe page</title></head>
<body style="font-family:sans-serif;height:2600px;margin:24px">
<h1>Recorder probe page</h1>
<label for="name">Full name</label> <input id="name" placeholder="Full name">
<label>Country <select id="country"><option>Choose…</option><option>Israel</option><option>Norway</option></select></label>
<label><input type="checkbox" id="agree"> I agree to the terms</label>
<label for="pw">Password</label> <input id="pw" type="password">
<button id="go" onclick="document.getElementById('out').textContent='submitted'">Submit form</button>
<p id="out"></p></body></html>`;
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(TEST_PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const testPageUrl = `http://127.0.0.1:${server.address().port}/probe`;

context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  // Google Chrome 137+ ignores --load-extension; use Chromium / Chrome for Testing.
  ...(env.PW_EXECUTABLE ? { executablePath: env.PW_EXECUTABLE } : { channel: env.PW_CHANNEL || 'chromium' }),
  headless: false,
  viewport: null,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    '--window-size=1400,900',
    // Lets getDisplayMedia pick the tab without the native picker.
    '--auto-select-tab-capture-source-by-title=Recorder probe page',
  ],
});
context.setDefaultTimeout(30000);

let sw = context.serviceWorkers()[0];
if (!sw) sw = await context.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
console.log(`extension id ${extId}`);

const target = context.pages()[0] || (await context.newPage());
await target.goto('https://example.com/');
// The panel gets its own popup window: real clicks on it count as user
// activation (needed for getDisplayMedia) while the page under test stays the
// active tab of the normal window, like a real side panel.
const panelPromise = context.waitForEvent('page');
await sw.evaluate((url) => chrome.windows.create({ url, type: 'popup', width: 440, height: 960, left: 1420, top: 20 }), `chrome-extension://${extId}/sidepanel/index.html`);
panel = await panelPromise;
await panel.waitForLoadState();
panel.on('pageerror', (e) => console.log('   [panel pageerror]', e.message));
panel.on('response', (r) => {
  if (r.status() >= 400) console.log(`   [panel http ${r.status()}] ${r.request().method()} ${r.url().slice(0, 140)}`);
});
panel.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`   [panel ${m.type()}]`, m.text());
});

const api = async (p, init = {}) => {
  const res = await fetch(`${env.TESTMO_URL}/api/v1${p}`, { ...init, headers: { Authorization: `Bearer ${env.TESTMO_API_KEY}`, Accept: 'application/json', ...(init.headers || {}) } });
  return res.json();
};

await step('connect screen is shown', async () => {
  await panel.waitForSelector('section[data-screen="connect"]:not([hidden])');
  await snap(panel, '01-connect');
});

await step('connect with instance URL and API key', async () => {
  await panel.fill('#in-instance', env.TESTMO_URL);
  await panel.fill('#in-apikey', env.TESTMO_API_KEY);
  await panel.click('#btn-connect');
  await panel.waitForSelector('section[data-screen="runs"]:not([hidden])');
  await panel.waitForFunction(() => document.querySelectorAll('#sel-project option').length > 0);
  const toast = await panel.textContent('#toast');
  expect(/Connected as/.test(toast), `unexpected toast: ${toast}`);
  return toast.trim();
});

await step('API key is not persisted in local storage by default', async () => {
  const local = await panel.evaluate(() => chrome.storage.local.get(null));
  expect(!JSON.stringify(local).includes(env.TESTMO_API_KEY), 'key found in storage.local');
  const session = await panel.evaluate(() => chrome.storage.session.get(null));
  expect(session.apiKey === env.TESTMO_API_KEY, 'key missing from storage.session');
});

await step('select project and find the run', async () => {
  if (env.TESTMO_PROJECT_NAME) {
    await panel.selectOption('#sel-project', { label: env.TESTMO_PROJECT_NAME });
  }
  await panel.waitForFunction(() => !document.querySelector('#runs-list').textContent.includes('Loading'));
  await panel.waitForFunction(() => document.querySelectorAll('#sel-milestone option').length > 2);
  const selected = await panel.$eval('#sel-milestone', (el) => el.selectedOptions[0] && el.selectedOptions[0].textContent);
  expect(selected && selected !== 'All milestones', `default milestone should be the newest open one, got ${selected}`);
  if (env.TESTMO_MILESTONE_NAME) {
    await panel.selectOption('#sel-milestone', { label: env.TESTMO_MILESTONE_NAME });
    const visible = await panel.locator('#runs-list .item').count();
    expect(visible > 0, 'no runs in the milestone');
  }
  await panel.selectOption('#sel-milestone', 'none');
  const noneCount = await panel.locator('#runs-list .item').count();
  await panel.selectOption('#sel-milestone', 'all');
  const allCount = await panel.locator('#runs-list .item').count();
  expect(allCount >= noneCount, 'milestone filter broken');
  if (env.TESTMO_MILESTONE_NAME) await panel.selectOption('#sel-milestone', { label: env.TESTMO_MILESTONE_NAME });
  await panel.fill('#in-run-search', env.TESTMO_RUN_NAME);
  await panel.waitForSelector('#runs-list .item');
  const n = await panel.locator('#runs-list .item').count();
  expect(n >= 1, 'run not listed');
  await snap(panel, '02-runs');
});

await step('"assigned to me" toggle narrows the list using the REST fallback when not signed in', async () => {
  // Seed an assignment: the latest result of one test in the scratch run is
  // assigned to the API user (that is how the REST API expresses assignment).
  const me = await api('/user');
  const projects = await api('/projects');
  const project = projects.result.find((p) => !env.TESTMO_PROJECT_NAME || p.name === env.TESTMO_PROJECT_NAME);
  const run = (await api(`/projects/${project.id}/runs?name=${encodeURIComponent(env.TESTMO_RUN_NAME)}&per_page=15`)).result[0];
  const latest = (await api(`/runs/${run.id}/results?get_latest_result=1&per_page=15`)).result;
  expect(latest.length > 0, 'scratch run needs at least one result to seed an assignment');
  const statuses = (await api(`/projects/${project.id}/statuses?per_page=100`)).result;
  const status = statuses.find((s) => /skip/i.test(s.name)) || statuses.find((s) => !s.is_untested && !/unnamed/i.test(s.name));
  await api(`/runs/${run.id}/tests/${latest[0].test_id}/results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status_id: status.id, comment: '<p>e2e: assignment seed</p>', assignee_id: me.id }),
  });
  try {
    await panel.check('#in-assigned-me');
    await panel.waitForFunction(() => !/Checking/.test(document.querySelector('#assigned-note').textContent));
    const note = await panel.textContent('#assigned-note');
    expect(/Not signed in/.test(note), `note: ${note}`);
    const n = await panel.locator('#runs-list .item').count();
    expect(n >= 1, 'the scratch run has a result assigned to this user and should still be listed');
    expect((await panel.locator('#runs-list .item:has-text("assigned to me")').count()) >= 1, 'assigned chip missing');
    await snap(panel, '02b-runs-assigned');
    return `${n} run(s) with my assignments`;
  } finally {
    await panel.uncheck('#in-assigned-me');
  }
});

let caseCount = 0;
await step('open the run and list its tests', async () => {
  await panel.click('#runs-list .item');
  await panel.waitForSelector('section[data-screen="run"]:not([hidden])');
  await panel.waitForSelector('#run-loading', { state: 'hidden', timeout: 120000 });
  caseCount = await panel.locator('#cases-list .item').count();
  expect(caseCount > 0, 'no cases rendered');
  await snap(panel, '03-run');
  return `${caseCount} tests`;
});

await step('without a Testmo web session, untested tests are flagged and the banner explains why', async () => {
  const banner = await panel.locator('#session-banner');
  const visible = await banner.isVisible();
  const flagged = await panel.locator('#cases-list .item:has-text("no test id")').count();
  expect(visible === (flagged > 0), `banner visible=${visible} but flagged=${flagged}`);
  return `${flagged} flagged`;
});

const canLogin = env.TESTMO_LOGIN_EMAIL && env.TESTMO_LOGIN_PASSWORD;
if (canLogin) {
  await step('sign in to Testmo web UI in another tab', async () => {
    const login = await context.newPage();
    await login.goto(`${env.TESTMO_URL}/auth/login`);
    await login.fill('input[name="email"]', env.TESTMO_LOGIN_EMAIL);
    await login.fill('input[name="password"]', env.TESTMO_LOGIN_PASSWORD);
    await Promise.all([login.waitForURL((u) => !/auth\/login/.test(u.href)), login.click('button[type="submit"], input[type="submit"]')]);
    await login.close();
  });

  await step('"assigned to me" uses the My work page once signed in', async () => {
    await panel.click('#btn-back');
    await panel.waitForSelector('section[data-screen="runs"]:not([hidden])');
    try {
      await panel.check('#in-assigned-me');
      await panel.waitForFunction(() => !/Checking/.test(document.querySelector('#assigned-note').textContent));
      const note = await panel.textContent('#assigned-note');
      expect(/My work/.test(note), `note: ${note}`);
      expect((await panel.locator('#runs-list .item').count()) >= 1, 'scratch run missing from assignments');
    } finally {
      await panel.uncheck('#in-assigned-me');
    }
    await panel.click('#runs-list .item');
    await panel.waitForSelector('section[data-screen="run"]:not([hidden])');
    await panel.waitForSelector('#run-loading', { state: 'hidden', timeout: 120000 });
  });

  await step('refresh resolves every test id through the web session', async () => {
    await panel.click('#btn-refresh-run');
    await panel.waitForSelector('#run-loading', { state: 'hidden', timeout: 120000 });
    await panel.waitForFunction(() => document.querySelectorAll('#cases-list .item').length > 0);
    const flagged = await panel.locator('#cases-list .item:has-text("no test id")').count();
    expect(flagged === 0, `${flagged} tests still unresolved`);
    expect(await panel.locator('#session-banner').isHidden(), 'banner still visible');
  });
}

if (env.TESTMO_SCRATCH_FOLDER_NAME) {
  await step('add a Gherkin test case from the panel: created in the folder and added to the run', async () => {
    const before = await panel.locator('#cases-list .item').count();
    await panel.click('#btn-addcase');
    await panel.waitForSelector('section[data-screen="newcase"]:not([hidden])');
    await panel.selectOption('#nc-folder', { label: env.TESTMO_SCRATCH_FOLDER_NAME });
    const tpl = await panel.$eval('#nc-template', (el) => el.selectedOptions[0].textContent);
    expect(/bdd|gherkin/i.test(tpl), `expected a BDD template preselected, got ${tpl}`);
    const ta = panel.locator('textarea[data-gherkin]');
    await ta.waitFor();
    const stamp = Date.now();
    await ta.fill(`Scenario: e2e created case ${stamp}\n\tGiven the panel is open\n\tWhen the tester adds a case\n\tThen it appears in the run`);
    await panel.waitForFunction(() => document.querySelectorAll('.gk-preview-body .gk-step').length === 3);
    await snap(panel, '12-add-case');
    await panel.click('#nc-submit');
    await panel.waitForSelector('section[data-screen="case"]:not([hidden])', { timeout: 60000 });
    const title = (await panel.textContent('#case-title')).trim();
    expect(title === `e2e created case ${stamp}`, `title: ${title}`);
    const createdId = Number((await panel.textContent('#case-key')).replace('C', ''));
    expect(createdId > 0, 'no case id');
    expect((await panel.locator('#case-fields-body .gherkin .gk-step').count()) === 3, 'gherkin not rendered on the new case');
    // Verify in Testmo, then clean up the case this test created.
    const projects = await api('/projects');
    const project = projects.result.find((p) => !env.TESTMO_PROJECT_NAME || p.name === env.TESTMO_PROJECT_NAME);
    const run = (await api(`/projects/${project.id}/runs?name=${encodeURIComponent(env.TESTMO_RUN_NAME)}&per_page=15`)).result[0];
    const runNow = (await api(`/runs/${run.id}`)).result;
    expect(runNow.case_ids.map(Number).includes(createdId), 'case not in run');
    const inFolder = (await api(`/projects/${project.id}/cases?per_page=15&name=${encodeURIComponent(`e2e created case ${stamp}`)}`)).result;
    expect(inFolder.length === 1 && Number(inFolder[0].id) === createdId, 'created case not found by name');
    await panel.click('#btn-back');
    await panel.waitForSelector('section[data-screen="run"]:not([hidden])');
    const after = await panel.locator('#cases-list .item').count();
    expect(after === before + 1, `list grew from ${before} to ${after}`);
    const del = await fetch(`${env.TESTMO_URL}/api/v1/projects/${project.id}/cases`, { method: 'DELETE', headers: { Authorization: `Bearer ${env.TESTMO_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [createdId] }) });
    expect(del.status === 204 || del.status === 200, `cleanup delete returned ${del.status}`);
    await panel.click('#btn-refresh-run');
    await panel.waitForSelector('#run-loading', { state: 'hidden', timeout: 120000 });
    return `C${createdId} created in "${env.TESTMO_SCRATCH_FOLDER_NAME}", added to run, then deleted`;
  });
}

let firstCaseId = null;
await step('open the first test case and render instructions', async () => {
  await panel.click('#cases-list .item');
  await panel.waitForSelector('section[data-screen="case"]:not([hidden])');
  const title = (await panel.textContent('#case-title')).trim();
  expect(title.length > 0, 'empty title');
  firstCaseId = Number((await panel.textContent('#case-key')).replace('C', ''));
  const fields = await panel.locator('#case-fields-body .field').count();
  expect(fields > 0, 'no fields rendered');
  const statuses = await panel.locator('#status-buttons .status-btn').allTextContents();
  expect(statuses.some((s) => /pass/i.test(s)) && statuses.some((s) => /fail/i.test(s)), `statuses: ${statuses}`);
  const scripts = await panel.locator('#case-fields-body script').count();
  expect(scripts === 0, 'script tag survived sanitizer');
  await snap(panel, '04-case');
  return `${fields} fields, statuses: ${statuses.join(', ')}`;
});

await step('a BDD case renders as highlighted Gherkin', async () => {
  // Find a test whose instructions contain a gherkin block and open it.
  await panel.click('#btn-back');
  await panel.waitForSelector('section[data-screen="run"]:not([hidden])');
  const items = await panel.locator('#cases-list .item').count();
  let found = false;
  for (let i = 0; i < items && !found; i += 1) {
    await panel.locator('#cases-list .item').nth(i).click();
    await panel.waitForSelector('section[data-screen="case"]:not([hidden])');
    found = (await panel.locator('#case-fields-body .gherkin .gk-step').count()) > 0;
    if (!found) {
      await panel.click('#btn-back');
      await panel.waitForSelector('section[data-screen="run"]:not([hidden])');
    }
  }
  expect(found, 'no case rendered with gherkin steps');
  const kws = await panel.locator('#case-fields-body .gk-step-kw').allTextContents();
  expect(kws.some((k) => /Given|When|Then/.test(k)), `keywords: ${kws}`);
  await snap(panel, '04b-case-gherkin');
  await panel.click('#btn-back');
  await panel.waitForSelector('section[data-screen="run"]:not([hidden])');
  await snap(panel, '03b-run-grouped');
  await panel.click('#cases-list .item');
  await panel.waitForSelector('section[data-screen="case"]:not([hidden])');
  return kws.slice(0, 4).join(' ');
});

await step('sanitizer strips dangerous markup', async () => {
  const out = await panel.evaluate(async () => {
    const { sanitizeHtml } = await import(chrome.runtime.getURL('lib/sanitize.js'));
    return sanitizeHtml('<p onclick="x()">hi <script>alert(1)</script><a href="javascript:alert(1)">l</a><img src="x" onerror="y()"></p>');
  });
  expect(!/script|onclick|onerror|javascript:/.test(out), out);
  return out;
});

await step('capture a screenshot of the page under test and annotate it', async () => {
  await target.bringToFront();
  const popupPromise = context.waitForEvent('page');
  await panel.evaluate(() => document.querySelector('#btn-capture').click());
  const annot = await popupPromise;
  await annot.waitForLoadState();
  await annot.waitForFunction(() => document.querySelector('#canvas').width > 0);
  const box = await annot.locator('#canvas').boundingBox();
  await annot.mouse.move(box.x + 40, box.y + 40);
  await annot.mouse.down();
  await annot.mouse.move(box.x + 220, box.y + 160, { steps: 8 });
  await annot.mouse.up();
  await annot.click('[data-tool="arrow"]');
  await annot.mouse.move(box.x + 300, box.y + 300);
  await annot.mouse.down();
  await annot.mouse.move(box.x + 240, box.y + 180, { steps: 8 });
  await annot.mouse.up();
  await annot.click('[data-tool="text"]');
  await annot.mouse.click(box.x + 320, box.y + 60);
  await annot.waitForSelector('#text-input:not([hidden])');
  await annot.waitForFunction(() => document.activeElement === document.querySelector('#text-input'));
  await annot.keyboard.type('Bug here');
  await annot.keyboard.press('Enter');
  await annot.waitForSelector('#text-input', { state: 'hidden' });
  const toolAfterText = await annot.textContent('#hint');
  expect(/text/i.test(toolAfterText), `typing text changed the tool: ${toolAfterText}`);
  const undoEnabled = await annot.evaluate(() => !document.querySelector('#undo').disabled);
  expect(undoEnabled, 'undo should be enabled after drawing');
  await snap(annot, '05-annotator');
  await annot.click('#save');
  await annot.waitForEvent('close', { timeout: 10000 }).catch(() => {});
  await panel.bringToFront();
  await panel.waitForSelector('.shot .shot__badge');
  const n = await panel.locator('.shot').count();
  expect(n === 1, `expected 1 shot, got ${n}`);
  await snap(panel, '06-case-with-shot');
});

await step('notes are saved locally as a draft', async () => {
  await panel.fill('#in-notes', 'E2E run: observed the expected behaviour on example.com');
  await panel.waitForTimeout(600);
  await panel.click('#btn-back');
  await panel.waitForSelector('section[data-screen="run"]:not([hidden])');
  const draftMark = await panel.locator('#cases-list .item:has-text("draft")').count();
  const shotMark = await panel.locator('#cases-list .item:has-text("📷")').count();
  expect(draftMark >= 1 && shotMark >= 1, `draft=${draftMark} shots=${shotMark}`);
  await snap(panel, '07-run-with-drafts');
  await panel.click('#cases-list .item');
  await panel.waitForSelector('section[data-screen="case"]:not([hidden])');
  const restored = await panel.inputValue('#in-notes');
  expect(restored.startsWith('E2E run'), 'note not restored');
});

let firstTestId = null;
await step('submit a Passed result with the screenshot', async () => {
  await panel.click('#status-buttons .status-btn:has-text("Passed")');
  expect(!(await panel.locator('#btn-submit').isDisabled()), 'submit still disabled');
  await panel.click('#btn-submit');
  await panel.waitForFunction(() => /Saved:/.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
  const err = await panel.locator('#submit-error').isVisible();
  expect(!err, await panel.textContent('#submit-error'));
  return (await panel.textContent('#toast')).trim();
});

await step('Testmo shows the new result through the REST API', async () => {
  const run = await api(`/projects/${(await api('/projects')).result.find((p) => !env.TESTMO_PROJECT_NAME || p.name === env.TESTMO_PROJECT_NAME).id}/runs?name=${encodeURIComponent(env.TESTMO_RUN_NAME)}&per_page=15`);
  const runId = run.result[0].id;
  const results = await api(`/runs/${runId}/results?get_latest_result=1&case_id=${firstCaseId}&per_page=15`);
  const r = results.result[0];
  expect(r, 'no result found');
  firstTestId = r.test_id;
  expect(Number(r.status_id) === 2, `status ${r.status_id}`);
  expect(/E2E run/.test(r.note), `note: ${r.note}`);
  return `result ${r.id} test ${r.test_id} status ${r.status_id}`;
});

await step('auto-advanced to the next untested case', async () => {
  const pos = (await panel.textContent('#case-pos')).trim();
  const st = await panel.textContent('#case-status');
  if (/untested/i.test(st)) return `${pos} (untested)`;
  // Nothing untested left after the current test: the panel stays put. Verify that.
  await panel.click('#btn-back');
  await panel.waitForSelector('section[data-screen="run"]:not([hidden])');
  const untestedLeft = await panel.locator('#cases-list .item--untested').count();
  const idx = Number(pos.split('/')[0]);
  await panel.locator('#cases-list .item').nth(idx - 1).click();
  await panel.waitForSelector('section[data-screen="case"]:not([hidden])');
  expect(untestedLeft === 0, `stayed on a tested case although ${untestedLeft} untested remain`);
  return `${pos} (no untested tests left in the run)`;
});

await step('keyboard navigation moves between cases', async () => {
  const [startStr, totalStr] = (await panel.textContent('#case-pos')).trim().split('/');
  const start = Number(startStr);
  const total = Number(totalStr);
  await panel.focus('body');
  // Step away and back, in whichever direction has room.
  const away = start < total ? 'ArrowRight' : 'ArrowLeft';
  const back = start < total ? 'ArrowLeft' : 'ArrowRight';
  const awayPos = start < total ? start + 1 : start - 1;
  await panel.keyboard.press(away);
  await panel.waitForFunction((n) => document.querySelector('#case-pos').textContent.trim().startsWith(`${n} /`), awayPos);
  await panel.keyboard.press(back);
  await panel.waitForFunction((n) => document.querySelector('#case-pos').textContent.trim().startsWith(`${n} /`), start);
  await panel.keyboard.press('f');
  const sel = await panel.locator('.status-btn--selected').textContent();
  expect(/fail/i.test(sel), `selected ${sel}`);
  await panel.keyboard.press('f'); // toggles off
  expect((await panel.locator('.status-btn--selected').count()) === 0, 'toggle off failed');
});

await step('record steps: video + action log become evidence and notes', async () => {
  await target.goto(testPageUrl);
  await target.bringToFront();
  await panel.bringToFront();
  await panel.click('#btn-record');
  await panel.waitForSelector('#recording:not([hidden])', { timeout: 20000 });
  await target.bringToFront();
  await target.fill('#name', 'Ada Lovelace');
  await target.selectOption('#country', 'Norway');
  await target.check('#agree');
  await target.fill('#pw', 'hunter2');
  await target.click('#go');
  await target.mouse.wheel(0, 3000);
  await target.waitForTimeout(1200);
  await panel.bringToFront();
  await panel.waitForFunction(() => document.querySelectorAll('#rec-steps li').length >= 4, null, { timeout: 15000 });
  await snap(panel, '10-recording');
  await panel.click('#btn-record');
  await panel.waitForSelector('#recording', { state: 'hidden', timeout: 20000 });
  await panel.waitForSelector('.shot--video', { timeout: 10000 });
  const notes = await panel.inputValue('#in-notes');
  expect(/Steps to reproduce:/.test(notes), `notes: ${notes}`);
  expect(/Type "Ada Lovelace" into the "Full name" field/.test(notes), `typing not logged: ${notes}`);
  expect(/Select "Norway" in "Country"/.test(notes), `select not logged: ${notes}`);
  expect(/Check "I agree to the terms"/.test(notes), `checkbox not logged: ${notes}`);
  expect(/Enter a value into the "Password" field \(hidden\)/.test(notes) && !/hunter2/.test(notes), `password leaked or missing: ${notes}`);
  expect(/Click the "Submit form" button/.test(notes), `click not logged: ${notes}`);
  expect(/Scroll/.test(notes), `scroll not logged: ${notes}`);
  await snap(panel, '11-case-with-recording');
  return notes.split('\n').slice(0, 9).join(' | ');
});

await step('fallback: after the web session is gone, results go through the REST API with case attachments', async () => {
  await context.clearCookies();
  await target.goto('https://example.com/');
  await target.bringToFront();
  const popupPromise = context.waitForEvent('page');
  await panel.evaluate(() => document.querySelector('#btn-capture').click());
  const annot = await popupPromise;
  await annot.waitForLoadState();
  await annot.click('#cancel');
  await panel.bringToFront();
  await panel.waitForSelector('.shot');
  const caseId = Number((await panel.textContent('#case-key')).replace('C', ''));
  const existingNotes = await panel.inputValue('#in-notes');
  await panel.fill('#in-notes', `E2E fallback path\n\n${existingNotes}`);
  await panel.click('#status-buttons .status-btn:has-text("Failed")');
  await panel.click('#btn-submit');
  await panel.waitForFunction(() => (!document.querySelector('#toast').hidden && /Saved: Failed/.test(document.querySelector('#toast').textContent)) || document.querySelector('#submit-error').offsetParent !== null, null, { timeout: 90000 });
  expect(await panel.locator('#submit-error').isHidden(), await panel.textContent('#submit-error'));
  const atts = await api(`/cases/${caseId}/attachments?per_page=15`);
  expect((atts.result || []).some((a) => /^C\d+-\d{8}-\d{6}-\d\.png$/.test(a.name)), `attachments: ${JSON.stringify(atts.result || []).slice(0, 200)}`);
  const webm = (atts.result || []).find((a) => /recording-\d\.webm$/.test(a.name));
  expect(webm, `no .webm attachment: ${JSON.stringify((atts.result || []).map((a) => a.name))}`);
  expect(Number(webm.size) > 10000, `webm too small: ${webm.size}`);
  const projects = await api('/projects');
  const project = projects.result.find((p) => !env.TESTMO_PROJECT_NAME || p.name === env.TESTMO_PROJECT_NAME);
  const run = (await api(`/projects/${project.id}/runs?name=${encodeURIComponent(env.TESTMO_RUN_NAME)}&per_page=15`)).result[0];
  const latest = (await api(`/runs/${run.id}/results?get_latest_result=1&case_id=${caseId}&per_page=15`)).result[0];
  expect(latest && Number(latest.status_id) === 3, `latest status ${latest && latest.status_id}`);
  expect(/attachments\/view\/\d+/.test(latest.note) && !/undefined/.test(latest.note), `note: ${latest.note}`);
  expect(/Recording:/.test(latest.note) && /Steps to reproduce/.test(latest.note), `note lacks recording/steps: ${latest.note.slice(0, 200)}`);
  return `case ${caseId} has ${atts.result.length} attachment(s) incl. ${webm.name} (${webm.size} bytes)`;
});

if (canLogin) {
  await step('the submitted result and its screenshot are visible in the Testmo UI', async () => {
    // Sign back in (cookies were cleared for the fallback step) and open the test.
    const projects = await api('/projects');
    const project = projects.result.find((p) => !env.TESTMO_PROJECT_NAME || p.name === env.TESTMO_PROJECT_NAME);
    const run = (await api(`/projects/${project.id}/runs?name=${encodeURIComponent(env.TESTMO_RUN_NAME)}&per_page=15`)).result[0];
    const ui = await context.newPage();
    await ui.setViewportSize({ width: 1400, height: 900 });
    await ui.goto(`${env.TESTMO_URL}/auth/login`);
    await ui.fill('input[name="email"]', env.TESTMO_LOGIN_EMAIL);
    await ui.fill('input[name="password"]', env.TESTMO_LOGIN_PASSWORD);
    await Promise.all([ui.waitForURL((u) => !/auth\/login/.test(u.href)), ui.click('button[type="submit"], input[type="submit"]')]);
    await ui.goto(`${env.TESTMO_URL}/runs/view/${run.id}?test_id=${firstTestId}`);
    await ui.waitForLoadState('networkidle');
    await ui.waitForSelector('text=E2E run', { timeout: 30000 });
    const imgs = await ui.locator('img[src*="attachments"]').count();
    await snap(ui, '09-testmo-result');
    await ui.close();
    return `${imgs} attachment image(s) rendered`;
  });
}

await step('settings screen and disconnect', async () => {
  await panel.click('#btn-settings');
  await panel.waitForSelector('section[data-screen="settings"]:not([hidden])');
  await snap(panel, '08-settings');
  panel.once('dialog', (d) => d.accept());
  await panel.click('#btn-disconnect');
  await panel.waitForSelector('section[data-screen="connect"]:not([hidden])');
  const session = await panel.evaluate(() => chrome.storage.session.get(null));
  expect(!session.apiKey, 'key still in session storage');
});

await step('remember-on-device stores an encrypted vault and unlock works after reload', async () => {
  await panel.fill('#in-instance', env.TESTMO_URL);
  await panel.fill('#in-apikey', env.TESTMO_API_KEY);
  await panel.check('#in-remember');
  await panel.fill('#in-passphrase', 'e2e-passphrase-123');
  await panel.click('#btn-connect');
  // Connecting re-opens the last run automatically, so either screen is fine.
  await panel.waitForSelector('section[data-screen="runs"]:not([hidden]), section[data-screen="run"]:not([hidden])');
  const local = await panel.evaluate(() => chrome.storage.local.get(null));
  expect(local.vault && local.vault.ct, 'vault missing');
  expect(!JSON.stringify(local).includes(env.TESTMO_API_KEY), 'plaintext key in local storage');
  await panel.evaluate(() => chrome.storage.session.clear());
  await panel.reload();
  await panel.waitForSelector('section[data-screen="unlock"]:not([hidden])');
  await panel.fill('#in-unlock', 'wrong-passphrase');
  await panel.click('#form-unlock button[type="submit"]');
  await panel.waitForSelector('#unlock-error:not([hidden])');
  await panel.fill('#in-unlock', 'e2e-passphrase-123');
  await panel.click('#form-unlock button[type="submit"]');
  await panel.waitForSelector('section[data-screen="runs"]:not([hidden]), section[data-screen="run"]:not([hidden])');
});

await context.close();
server.close();
fs.rmSync(work, { recursive: true, force: true });
console.log(failures ? `\n${failures} step(s) FAILED` : '\nAll e2e steps passed');
process.exit(failures ? 1 : 0);
