// PB-6 (#3990): /routinen in a real browser (Playwright) with injected backend answers: all sources, honest failure, layout, themes.
// Builds the site into a temp folder and serves it. Without an installed Chromium the test is skipped (CI installs none).
// PB6_SHOTS=<dir> additionally writes before/after screenshots (1440 and 390 wide, light and dark).
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {routinesBackend} from './fixtures/routines-backend.mjs';
import {sharedDist} from './fixtures/shared-dist.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon'};
const THEMES = ['dark', 'light', 'ocean', 'warm', 'colorful'];

const luminance = ([r, g, b]) => {
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
// Effective text color and the background composited over the ancestors.
const colorsOf = (page, selector) => page.locator(selector).first().evaluate(node => {
  const parse = value => { const m = value.match(/[\d.]+/g).map(Number); return {rgb: m.slice(0, 3), a: m.length > 3 ? m[3] : 1}; };
  const layers = [];
  for (let n = node; n; n = n.parentElement) {
    const bg = parse(getComputedStyle(n).backgroundColor);
    if (bg.a > 0) layers.push(bg);
    if (bg.a === 1) break;
  }
  let base = layers.length && layers[layers.length - 1].a === 1 ? layers.pop().rgb : [255, 255, 255];
  for (const layer of layers.reverse()) base = base.map((v, i) => Math.round(layer.rgb[i] * layer.a + v * (1 - layer.a)));
  return {text: parse(getComputedStyle(node).color).rgb, background: base};
});

let dist, server, baseUrl, browser;
test.before(async () => {
  try {
    const {chromium} = await import('playwright-core');
    browser = await chromium.launch();
  } catch { return; }
  dist = await sharedDist(root);
  server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/' || path === '') path = '/index';
    const file = [join(dist, path), join(dist, path + '.html')].find(f => existsSync(f) && extname(f));
    if (!file) { res.writeHead(404); return res.end('nicht gefunden'); }
    res.writeHead(200, {'content-type': TYPES[extname(file)] || 'application/octet-stream'});
    res.end(readFileSync(file));
  }).listen(0, '127.0.0.1');
  await new Promise(done => server.once('listening', done));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => {
  await browser?.close();
  server?.close();
});

async function open({fault = {}, theme = 'dark', width = 1440} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  await context.addInitScript(value => localStorage.setItem('bach-theme', value), theme);
  const requests = [];
  const answer = routinesBackend(fault, requests);
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    let reply;
    try { reply = await answer(url.pathname + url.search, {method: request.method()}); } catch { return route.abort(); }
    await route.fulfill({status: reply.status, contentType: 'application/json', body: JSON.stringify(await reply.json())});
  });
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl + '/routinen');
  await page.locator('#routine-list .routine-row, #routine-list .routine-empty').first().waitFor();
  return {page, context, requests, errors};
}
async function shot(page, name) {
  if (process.env.PB6_SHOTS) { mkdirSync(process.env.PB6_SHOTS, {recursive: true}); await page.screenshot({path: join(process.env.PB6_SHOTS, name), fullPage: true}); }
}

test('every source is read: rows from BACH, Ocean and Life, all measured, source cards from probes', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context, errors} = await open();
  try {
    const rows = page.locator('#routine-list .routine-row');
    assert.equal(await rows.count(), 9);
    assert.equal(await page.locator('#routine-list .routine-row[data-source="measured"]').count(), 9);
    const origins = await rows.evaluateAll(nodes => [...new Set(nodes.map(n => n.dataset.origin))].sort());
    assert.deepEqual(origins, ['bach', 'life', 'module', 'ocean']);
    const card = key => page.locator(`[data-source-card="${key}"]`);
    assert.equal(await card('bach').getAttribute('data-state'), 'available');
    assert.equal(await card('ocean').getAttribute('data-state'), 'available');
    assert.equal(await card('life').getAttribute('data-state'), 'available');
    assert.equal(await card('module').getAttribute('data-state'), 'available');
    assert.match(await card('bach').innerText(), /Daemon ist gestoppt/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a job that never ran and one whose last run failed carry a visible warning', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context} = await open();
  try {
    const flag = id => page.locator(`[data-id="${id}"] [data-flag]`);
    assert.equal(await flag('bach-job:1').getAttribute('data-flag'), 'never-run');
    assert.match(await flag('bach-job:1').innerText(), /Noch nie gelaufen/);
    assert.equal(await flag('bach-job:2').getAttribute('data-flag'), 'failed');
    assert.match(await page.locator('[data-id="bach-job:2"]').innerText(), /Fehlgeschlagen/);
    assert.equal(await flag('bach-job:3').count(), 0);
  } finally { await context.close(); }
});

test('an unreachable source is named with its reason and the other sources stay on the page', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context} = await open({fault: {ocean: 404, life: 401, module: 404}});
  try {
    assert.equal(await page.locator('#routine-list .routine-row').count(), 5);
    assert.match(await page.locator('[data-source-card="ocean"]').innerText(), /nicht erreichbar: Pfad nicht vorhanden/);
    assert.match(await page.locator('[data-source-card="life"]').innerText(), /nicht erreichbar: Geräteanmeldung erforderlich/);
    assert.match(await page.locator('[data-source-card="module"]').innerText(), /nicht erreichbar: Pfad nicht vorhanden/);
    await page.selectOption('#routine-source-filter', 'life');
    assert.match(await page.locator('#routine-list .routine-empty').innerText(), /Life.*nicht erreichbar: Geräteanmeldung/);
    await page.selectOption('#routine-source-filter', 'module');
    assert.match(await page.locator('#routine-list .routine-empty').innerText(), /Modul.*nicht erreichbar: Pfad nicht vorhanden/);
  } finally { await context.close(); }
});

test('desktop: rows use the header grid, cells sit on one line without touching, rows stay compact, nothing scrolls sideways', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context} = await open();
  try {
    const geometry = await page.evaluate(() => {
      const columns = node => getComputedStyle(node).gridTemplateColumns;
      const head = document.querySelector('.routine-head');
      const rows = [...document.querySelectorAll('#routine-list .routine-row')];
      const wrap = document.querySelector('.routine-table-wrap');
      return {
        headColumns: columns(head), rowColumns: rows.map(columns),
        rowHeights: rows.map(r => Math.round(r.getBoundingClientRect().height)),
        spreadY: rows.map(r => { const ys = [...r.children].map(c => c.getBoundingClientRect().top); return Math.max(...ys) - Math.min(...ys); }),
        gaps: rows.flatMap(r => { const boxes = [...r.children].map(c => c.getBoundingClientRect()); return boxes.slice(1).map((b, i) => b.left - boxes[i].right); }),
        overflow: wrap.scrollWidth - wrap.clientWidth,
      };
    });
    assert.ok(geometry.rowColumns.every(c => c === geometry.headColumns), 'header and rows share the grid');
    assert.ok(geometry.rowColumns[0].split(' ').length === 6);
    assert.ok(Math.max(...geometry.rowHeights) <= 72, `row heights ${geometry.rowHeights}`);
    assert.ok(Math.max(...geometry.spreadY) <= 4 + 40, 'cells start on the same line (tops within a short stack)');
    assert.ok(Math.min(...geometry.gaps) >= 8, `cell gaps ${geometry.gaps}`);
    assert.ok(geometry.overflow <= 1, `sideways overflow ${geometry.overflow}`);
    await shot(page, 'routinen_1440_dunkel.png');
  } finally { await context.close(); }
});

test('mobile 390: rows become labelled cards and the page does not scroll sideways', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context} = await open({width: 390});
  try {
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      label: getComputedStyle(document.querySelector('#routine-list .routine-cell:nth-child(2)'), '::before').content,
    }));
    assert.ok(metrics.overflow <= 1, `sideways overflow ${metrics.overflow}`);
    assert.match(metrics.label, /Routine \/ Job|Planung/);
    await shot(page, 'routinen_390_dunkel.png');
  } finally { await context.close(); }
});

test('actions call the backend routes and report what happened; a failed action changes nothing', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context, requests} = await open();
  try {
    await page.locator('[data-id="bach-job:1"] .routine-toggle').click();
    await page.locator('#routine-status', {hasText: 'pausiert'}).waitFor();
    assert.ok(requests.includes('PUT /api/daemon/jobs/1/toggle'), requests.join('\n'));
    await page.locator('[data-id="bach-job:1"] button', {hasText: 'Jetzt ausführen'}).click();
    await page.locator('#routine-status', {hasText: 'gestartet'}).waitFor();
    assert.ok(requests.includes('POST /api/daemon/jobs/1/run'));
    await page.locator('[data-id="life:13"] button', {hasText: 'Erledigt'}).click();
    await page.locator('#routine-status', {hasText: 'als erledigt'}).waitFor();
    assert.ok(requests.includes('POST /api/routines/13/complete'));
    assert.equal(await page.locator('[data-id="ocean:team.weekly"] .routine-state.is-readonly').count(), 1);
    assert.equal(await page.locator('[data-id="ocean:team.weekly"] button').count(), 0);
  } finally { await context.close(); }
  const failing = await open({fault: {bach: 503}});
  try {
    assert.equal(await failing.page.locator('[data-id="bach-job:1"]').count(), 0, 'jobs are not listed when their read failed');
  } finally { await failing.context.close(); }
});

for (const theme of THEMES) {
  test(`${theme}: text, muted text, status chips and buttons reach 4.5:1 on the rows`, async t => {
    if (!browser) return t.skip('kein Playwright-Browser installiert');
    const {page, context} = await open({theme});
    try {
      const targets = {
        name: '[data-id="bach-job:1"] .routine-title strong', origin: '[data-id="bach-job:1"] .routine-origin',
        cell: '[data-id="bach-job:2"] .routine-cell:nth-child(2)', flag: '[data-id="bach-job:1"] .routine-flag',
        failed: '[data-id="bach-job:2"] .routine-result', ok: '[data-id="bach-job:3"] .routine-result',
        readonly: '[data-id="ocean:team.weekly"] .routine-state', button: '[data-id="bach-job:1"] .routine-toggle',
        action: '[data-id="bach-job:1"] .routine-actions .btn', head: '.routine-head .routine-heading', card: '[data-source-card="module"] [data-source-state]',
      };
      for (const [name, selector] of Object.entries(targets)) {
        const {text, background} = await colorsOf(page, selector);
        assert.ok(ratio(text, background) >= 4.5, `${theme} ${name}: ${ratio(text, background).toFixed(2)}`);
      }
      if (theme === 'dark' || theme === 'light') await shot(page, `routinen_1440_${theme === 'light' ? 'hell' : 'dunkel'}_themes.png`);
    } finally { await context.close(); }
  });
}
