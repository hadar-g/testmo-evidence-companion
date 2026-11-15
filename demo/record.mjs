// Records the product demo against the mock instance; see demo/README.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startMockTestmo } from './mock-testmo/server.mjs';
import { startShop } from './shop/server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const env = process.env;
const outDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'evidence-companion-demo'));
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'snaps'), { recursive: true });

const TESTMO_HOST = 'acme.testmo.net';
const SHOP_HOST = 'summit-outfitters.example';
const API_KEY = 'tmo_demo_3f9a1c7e5b2d4a8f';
const APP = { w: 880, h: 724 };
const PANEL = { w: 400, h: 688 };
const OVERLAY = { w: 1000, h: 600 };

const { chromium } = await import(env.PW_MODULE ? pathToFileURL(env.PW_MODULE).href : 'playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vp = (s) => ({ width: s.w, height: s.h });

const testmo = await startMockTestmo({ port: 8443, apiKey: API_KEY });
const shop = await startShop({ port: 8444 });

// Extension copy with host permissions granted up front (no permission prompts).
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-demo-'));
const extDir = path.join(work, 'ext');
fs.cpSync(root, extDir, { recursive: true, filter: (src) => !/node_modules|\.git|dist|test|docs|demo/.test(src.replace(root, '')) });
const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
delete manifest.optional_host_permissions;
fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  ...(env.PW_EXECUTABLE ? { executablePath: env.PW_EXECUTABLE } : { channel: 'chromium' }),
  headless: false,
  viewport: null,
  ignoreHTTPSErrors: true,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    `--host-resolver-rules=MAP ${TESTMO_HOST} 127.0.0.1:${testmo.port}, MAP ${SHOP_HOST} 127.0.0.1:${shop.port}`,
    '--ignore-certificate-errors',
    '--window-size=900,820',
    '--window-position=0,0',
    '--auto-select-tab-capture-source-by-title=Summit Outfitters',
    '--hide-scrollbars',
  ],
});
context.setDefaultTimeout(30000);
let sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
const extId = new URL(sw.url()).host;

const app = context.pages()[0] || (await context.newPage());
await app.setViewportSize(vp(APP));
await app.goto(`https://${SHOP_HOST}/`);

const panelPromise = context.waitForEvent('page');
await sw.evaluate((url) => chrome.windows.create({ url, type: 'popup', width: 420, height: 760, left: 920, top: 40 }), `chrome-extension://${extId}/sidepanel/index.html`);
const panel = await panelPromise;
await panel.waitForLoadState();
await panel.setViewportSize(vp(PANEL));
panel.on('pageerror', (e) => console.log('[panel error]', e.message));
panel.on('console', (m) => m.type() === 'error' && console.log('[panel console]', m.text()));

// ---------------------------------------------------------------------------
// Frame capture
// ---------------------------------------------------------------------------
const film = {
  frames: [],
  n: 0,
  running: false,
  scene: 'intro',
  caption: '',
  cursor: null, // { page: 'app'|'panel'|'overlay', x, y }
  clickAt: 0,
  overlay: null,
  overlayKind: null,
};
context.on('page', async (p) => {
  const url = p.url() || (await p.waitForLoadState().then(() => p.url()).catch(() => ''));
  if (!/\/annotate\/(annotate|preview)\.html/.test(url)) return;
  await p.setViewportSize(vp(OVERLAY)).catch(() => {});
  film.overlay = p;
  film.overlayKind = /preview/.test(url) ? 'preview' : 'annotate';
  p.on('close', () => {
    if (film.overlay === p) film.overlay = null;
  });
});
const shot = (page, type = 'jpeg') => page.screenshot({ type, ...(type === 'jpeg' ? { quality: 88 } : {}), animations: 'allow', caret: 'hide' }).catch(() => null);
async function captureFrame(kind = 'frame', name = null) {
  const overlay = film.overlay;
  const [a, p, o] = await Promise.all([shot(app, kind === 'snap' ? 'png' : 'jpeg'), shot(panel, kind === 'snap' ? 'png' : 'jpeg'), overlay ? shot(overlay, kind === 'snap' ? 'png' : 'jpeg') : null]);
  if (!a || !p) return;
  const ext = kind === 'snap' ? 'png' : 'jpg';
  const id = kind === 'snap' ? name : String(++film.n).padStart(5, '0');
  const dir = kind === 'snap' ? 'snaps' : 'frames';
  fs.writeFileSync(path.join(outDir, dir, `${id}-app.${ext}`), a);
  fs.writeFileSync(path.join(outDir, dir, `${id}-panel.${ext}`), p);
  if (o) fs.writeFileSync(path.join(outDir, dir, `${id}-overlay.${ext}`), o);
  const rec = { id, t: Date.now(), scene: film.scene, url: app.url(), caption: film.caption, cursor: film.cursor, click: Date.now() - film.clickAt < 260, overlay: o ? film.overlayKind : null };
  if (kind === 'snap') film.snaps.push(rec);
  else film.frames.push(rec);
}
film.snaps = [];
async function filmLoop() {
  while (film.running) {
    if (film.paused) {
      await sleep(20);
      continue;
    }
    await captureFrame();
    await sleep(30);
  }
}
const scene = (name, caption = '') => {
  film.scene = name;
  film.caption = caption;
};
const caption = (text) => (film.caption = text);
// Snaps pause the frame loop so the PNGs show exactly this moment.
const snap = async (name) => {
  film.paused = true;
  await sleep(200);
  await captureFrame('snap', name);
  film.paused = false;
};

// ---------------------------------------------------------------------------
// Human-like input
// ---------------------------------------------------------------------------
const pageName = (page) => (page === app ? 'app' : page === panel ? 'panel' : 'overlay');
const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
async function glide(page, x, y, ms = 420) {
  const from = film.cursor && film.cursor.page === pageName(page) ? { x: film.cursor.x, y: film.cursor.y } : { x: x - 120, y: y + 90 };
  const steps = Math.max(6, Math.round(ms / 28));
  for (let i = 1; i <= steps; i += 1) {
    const k = ease(i / steps);
    const cx = from.x + (x - from.x) * k;
    const cy = from.y + (y - from.y) * k;
    await page.mouse.move(cx, cy);
    film.cursor = { page: pageName(page), x: cx, y: cy };
    await sleep(ms / steps);
  }
}
async function box(page, selector) {
  const loc = typeof selector === 'string' ? page.locator(selector).first() : selector;
  await loc.waitFor({ state: 'visible' });
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  return b;
}
async function click(page, selector, { dx = 0.5, dy = 0.5, hold = 90 } = {}) {
  const b = await box(page, selector);
  await glide(page, b.x + b.width * dx, b.y + b.height * dy);
  await page.mouse.down();
  film.clickAt = Date.now();
  await sleep(hold);
  await page.mouse.up();
}
async function type(page, selector, text, delay = 38) {
  await click(page, selector);
  await page.keyboard.type(text, { delay });
}
async function drag(page, x1, y1, x2, y2, ms = 600) {
  await glide(page, x1, y1);
  await page.mouse.down();
  film.clickAt = Date.now();
  await glide(page, x2, y2, ms);
  await page.mouse.up();
}
const hold = (ms) => sleep(ms);

// ---------------------------------------------------------------------------
// The demo
// ---------------------------------------------------------------------------
film.running = true;
const loop = filmLoop();
try {
  // 1. Connect --------------------------------------------------------------
  scene('connect', 'Connect with your Testmo URL and a personal API key');
  await panel.waitForSelector('section[data-screen="connect"]:not([hidden])');
  await hold(900);
  await snap('01-connect');
  await type(panel, '#in-instance', `https://${TESTMO_HOST}`, 30);
  await type(panel, '#in-apikey', API_KEY, 22);
  await hold(300);
  await click(panel, '#btn-connect');
  await panel.waitForSelector('section[data-screen="runs"]:not([hidden])');
  await panel.waitForFunction(() => document.querySelectorAll('#runs-list .item').length > 0);
  await hold(1400);

  // 2. Runs and run ---------------------------------------------------------
  scene('runs', 'Runs for the current milestone, progress at a glance');
  await glide(panel, 200, 300);
  await hold(900);
  await snap('02-runs');
  await click(panel, '#in-assigned-me', { dx: 0.2 });
  await panel.waitForFunction(() => !/Checking/.test(document.querySelector('#assigned-note').textContent));
  caption('“Assigned to me” shows only the runs waiting on you');
  await hold(1400);
  await snap('02b-runs-assigned');
  await click(panel, '#in-assigned-me', { dx: 0.2 });
  await hold(500);
  await click(panel, panel.locator('#runs-list .item', { hasText: 'Checkout regression' }));
  await panel.waitForSelector('section[data-screen="run"]:not([hidden])');
  await panel.waitForSelector('#run-loading', { state: 'hidden' });
  scene('run', 'Every test in the run, grouped by folder, with status and drafts');
  await glide(panel, 200, 420);
  await hold(1600);
  await snap('03-run');
  await click(panel, panel.locator('#cases-list .item', { hasText: 'Apply a percentage discount code' }));
  await panel.waitForSelector('section[data-screen="case"]:not([hidden])');
  scene('test', 'Read the scenario next to the page you are testing');
  await glide(panel, 200, 330);
  await hold(2000);
  await snap('04-test-gherkin');

  // 3. Test in the app, capture, annotate, submit ---------------------------
  scene('capture', 'Follow the steps in the application…');
  await click(app, '[data-add="tent"]');
  await hold(700);
  await click(app, '.cart-link');
  await app.waitForSelector('#coupon');
  await type(app, '#coupon', 'SAVE10', 60);
  await click(app, '#coupon-form button');
  await app.waitForSelector('#sum-discount');
  await glide(app, 700, 330);
  caption('The discount line appears, but the total never changes');
  await hold(1800);
  caption('Capture the page with one click…');
  const totalBox = await box(app, '#sum-total');
  const overlayPromise = context.waitForEvent('page');
  await click(panel, '#btn-capture');
  const annot = await overlayPromise;
  await annot.waitForLoadState();
  await annot.setViewportSize(vp(OVERLAY));
  await annot.waitForFunction(() => document.querySelector('#canvas').width > 0);
  await hold(900);
  caption('…annotate it: rectangle, arrow, text, pixelate, crop…');
  const canvas = await box(annot, '#canvas');
  const scale = canvas.width / APP.w;
  const tx = canvas.x + totalBox.x * scale;
  const ty = canvas.y + totalBox.y * scale;
  const tw = totalBox.width * scale;
  const th = totalBox.height * scale;
  await drag(annot, tx - 10, ty - 8, tx + tw + 10, ty + th + 8, 700);
  await hold(300);
  await click(annot, '[data-tool="arrow"]');
  await drag(annot, tx - 190, ty + 140, tx - 18, ty + th / 2 + 6, 650);
  await hold(300);
  await click(annot, '[data-tool="text"]');
  await glide(annot, tx - 330, ty + 150);
  await annot.mouse.down();
  film.clickAt = Date.now();
  await annot.mouse.up();
  await annot.waitForSelector('#text-input:not([hidden])');
  await annot.keyboard.type('Total ignores the discount', { delay: 40 });
  await annot.keyboard.press('Enter');
  await annot.waitForSelector('#text-input', { state: 'hidden' });
  await glide(annot, canvas.x + canvas.width - 60, canvas.y + canvas.height - 40);
  await hold(1200);
  await snap('05-annotate');
  caption('…and save it to the test');
  await click(annot, '#save');
  await annot.waitForEvent('close').catch(() => {});
  await panel.waitForSelector('.shot .shot__badge');
  await hold(900);
  caption('Notes and evidence are saved locally until you submit');
  await type(panel, '#in-notes', 'Discount line shows −$24.90 but the total stays $249.00.\nExpected $224.10.', 26);
  await hold(500);
  await click(panel, panel.locator('#status-buttons .status-btn', { hasText: 'Failed' }));
  await hold(1000);
  await snap('06-test-evidence');
  caption('Submit: the result, notes and screenshot land in Testmo');
  await click(panel, '#btn-submit');
  await panel.waitForFunction(() => /Saved:/.test(document.querySelector('#toast').textContent));
  await hold(1600);
  await panel.waitForSelector('section[data-screen="case"]:not([hidden])');
  caption('The panel moves on to the next untested test');
  await glide(panel, 200, 300);
  await hold(1800);

  // 4. Record steps ---------------------------------------------------------
  scene('record', 'Record steps: tab video plus a log of every click and keystroke');
  await click(app, '.brand');
  await app.waitForFunction(() => document.title === 'Summit Outfitters');
  await hold(400);
  await click(panel, '#btn-record');
  await panel.waitForSelector('#recording:not([hidden])', { timeout: 20000 });
  await hold(600);
  await click(app, '.cart-link');
  await app.waitForSelector('#coupon');
  await click(app, '#coupon');
  await app.keyboard.press('Meta+A');
  await app.keyboard.type('SUMMER24', { delay: 60 });
  await click(app, '#coupon-form button');
  await app.waitForSelector('#coupon-msg .msg--err');
  await hold(600);
  await app.mouse.wheel(0, 400);
  await hold(1200);
  await glide(panel, 200, 420);
  await hold(1200);
  await snap('07-recording');
  await click(panel, '#btn-record');
  await panel.waitForSelector('#recording', { state: 'hidden', timeout: 20000 });
  await panel.waitForSelector('.shot--video', { timeout: 15000 });
  caption('Steps to reproduce are written into your notes, passwords never');
  await panel.evaluate(() => {
    const ta = document.querySelector('#in-notes');
    ta.scrollIntoView({ block: 'center' });
  });
  await glide(panel, 200, 560);
  await hold(2600);
  await snap('08-test-recording');
  await click(panel, panel.locator('#status-buttons .status-btn', { hasText: 'Passed' }));
  await click(panel, '#btn-submit');
  await panel.waitForFunction(() => /Saved:/.test(document.querySelector('#toast').textContent));
  await hold(1500);

  // 5. Add a case -----------------------------------------------------------
  scene('addcase', 'Missed a scenario? Add a Gherkin case to the run in one step');
  await click(panel, '#btn-back');
  await panel.waitForSelector('section[data-screen="run"]:not([hidden])');
  await hold(600);
  await click(panel, '#btn-addcase');
  await panel.waitForSelector('section[data-screen="newcase"]:not([hidden])');
  await panel.selectOption('#nc-folder', { label: 'Discounts & promotions' });
  const ta = panel.locator('textarea[data-gherkin]');
  await click(panel, ta);
  await panel.keyboard.press('Meta+A');
  await panel.keyboard.type('Scenario: Discount code is not case sensitive\n', { delay: 30 });
  await panel.keyboard.type('Given my cart contains "Ridgeline 2P Tent"\n', { delay: 24 });
  await panel.keyboard.type('When I apply the code "save10"\n', { delay: 24 });
  await panel.keyboard.type('Then I see the message "Discount applied"', { delay: 24 });
  await hold(1500);
  await snap('09-add-case');
  await click(panel, '#nc-submit');
  await panel.waitForSelector('section[data-screen="case"]:not([hidden])', { timeout: 30000 });
  caption('Created in the repository, added to this run, open and ready to test');
  await glide(panel, 200, 320);
  await hold(2200);
  await snap('10-new-case');

  // 6. Settings -------------------------------------------------------------
  scene('settings', 'Your key stays on your device. No telemetry, no third-party servers.');
  await click(panel, '#btn-settings');
  await panel.waitForSelector('section[data-screen="settings"]:not([hidden])');
  await glide(panel, 200, 300);
  await hold(2200);
  await snap('11-settings');
  scene('outro', '');
  await hold(600);
} catch (err) {
  console.error('DEMO FAILED:', err);
  film.failed = err.message;
  await snap('fail').catch(() => {});
} finally {
  film.running = false;
  await loop;
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ app: APP, panel: PANEL, overlay: OVERLAY, hosts: { testmo: TESTMO_HOST, shop: SHOP_HOST }, frames: film.frames, snaps: film.snaps, failed: film.failed || null }, null, 1));
  console.log(`${film.frames.length} frames, ${film.snaps.length} snaps → ${outDir}`);
  await context.close().catch(() => {});
  testmo.server.close();
  shop.server.close();
  process.exit(film.failed ? 1 : 0);
}
