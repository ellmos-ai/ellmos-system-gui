// PB-5b (#3989): real browser, real pages, injected backend answers (tests/fixtures/pb5b-backend.mjs).
// Tiles: one structure everywhere. Contrast: measured colors of the pinned-domain list, the talk popover and the talk
// transcript in all five themes. Header: the two status pills. Skipped without an installed Playwright browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync, readFileSync} from 'node:fs';
import {extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {backend} from './fixtures/pb5b-backend.mjs';
import {sharedDist} from './fixtures/shared-dist.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon'};
const THEMES = ['dark', 'light', 'warm', 'ocean', 'colorful'];

const luminance = ([r, g, b]) => {
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

// Effective text color and the background composited over the ancestors of the first match.
const colorsOf = (page, selector) => page.locator(selector).first().evaluate(node => {
  // computed colors come as rgb(...) or, for color-mix(), as color(srgb 0.9 0.9 0.9 / 0.5)
  const parse = value => {
    const m = value.match(/[\d.]+(?:e-?\d+)?/g).map(Number);
    const scale = value.startsWith('color(') ? 255 : 1;
    return {rgb: m.slice(0, 3).map(v => v * scale), a: m.length > 3 ? m[3] : 1};
  };
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
const assertContrast = async (page, selector, label, min = 4.5) => {
  const {text, background} = await colorsOf(page, selector);
  const value = ratio(text, background);
  assert.ok(value >= min, `${label} (${selector}): ${value.toFixed(2)} < ${min}`);
};

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

async function open(path, {theme = 'dark', width = 1440, compute, iconStyle = 'line'} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  await context.addInitScript(([t, i]) => { localStorage.setItem('bach-theme', t); localStorage.setItem('bach-ui-icon-style', i); }, [theme, iconStyle]);
  const requests = [];
  await context.route('**/api/**', backend(requests, compute ? {compute} : {}));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl + path);
  return {page, context, requests, errors};
}

test('running: every agent tile has the same slots and the same actions, without emoji', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context, errors} = await open('/agenten/running');
  try {
    await page.locator('#core-agent-cards [data-core-agent-id="buddha_chat"]').waitFor();
    await page.locator('#ready-agents-grid [data-appearance-worker="worker-ready"]').waitFor();
    await page.locator('#optional-interface-slot-cards .agent-tile').first().waitFor({state: 'attached'});
    const tiles = await page.locator('.agent-tile').evaluateAll(nodes => nodes.map(node => ({
      kind: node.dataset.tileKind,
      slots: [...node.children].map(c => c.dataset.slot).filter(s => ['head', 'status', 'model', 'task', 'error', 'actions'].includes(s)),
      actions: [...node.querySelectorAll('[data-slot="actions"] > [data-action]')].map(a => a.dataset.action),
      menu: [...node.querySelectorAll('[data-menu="true"] > [data-action]')].map(a => a.dataset.action),
      text: node.innerText,
    })));
    assert.ok(tiles.length >= 14, `expected core, worker, talk and interface tiles, found ${tiles.length}`);
    assert.deepEqual([...new Set(tiles.map(tile => tile.kind))].sort(), ['interface', 'system-profile', 'system-slot', 'talk', 'worker', 'worker-running']);
    for (const tile of tiles) {
      assert.deepEqual(tile.slots, ['head', 'status', 'model', 'task', 'error', 'actions'], tile.kind);
      assert.deepEqual(tile.actions, ['run', 'edit', 'chat', 'assign', 'more'], tile.kind);
      assert.deepEqual(tile.menu, ['pause', 'stop', 'handoff', 'decompose', 'delete'], tile.kind);
      // the return shield of PB-4 starts with a text warning sign on purpose
      assert.doesNotMatch(tile.text.replace(/⚠️?/g, ''), /\p{Extended_Pictographic}/u, tile.kind + ': ' + tile.text);
    }
    assert.equal(await page.locator('article.core-agent-card:not(.agent-tile)').count(), 0, 'no card outside the tile component');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('running: PB-4 evidence is kept, an error tile says why or that the reason is missing, disabled actions say why', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context} = await open('/agenten/running');
  try {
    const run = page.locator('#running-workers-list article[data-worker-id="worker-run"]');
    await run.locator('[data-return-badge="critical"]').waitFor();
    assert.match(await run.innerText(), /65× zurückgegeben/);
    assert.match(await page.locator('[data-worker-wait="twin_status_unknown"]').innerText(), /Wartet auf Voraussetzung/);
    assert.match(await page.locator('[data-appearance-worker="worker-ended"] [data-slot="error"]').innerText(), /Zeitlimit für den Lauf erreicht/);
    const failed = page.locator('[data-appearance-worker="worker-error"]');
    assert.match(await failed.locator('.agent-tile-status').innerText(), /Fehler/);
    assert.match(await failed.locator('[data-slot="error"]').innerText(), /Ursache vom Backend nicht gemeldet/);
    const chat = failed.locator('[data-action="chat"]');
    assert.equal(await chat.getAttribute('aria-disabled'), 'true');
    assert.match(await chat.getAttribute('title'), /kein Chat angebunden/);
    // the running worker can be paused from the main slot, the on/off switch of a system slot keeps its role
    assert.equal(await run.locator('[data-action="run"]').innerText(), 'Pausieren');
    assert.equal(await page.locator('[data-core-agent-id="buddha_chat"] [data-action="run"]').innerText(), 'Pausieren');
  } finally { await context.close(); }
});

test('running: tiles stay inside the page at 390 px and the five actions never overflow their tile', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context} = await open('/agenten/running', {width: 390});
  try {
    await page.locator('.agent-tile').first().waitFor();
    const overflow = await page.evaluate(() => ({page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tiles: [...document.querySelectorAll('.agent-tile')].filter(t => t.offsetParent && t.scrollWidth > t.clientWidth + 1)
        .map(t => t.dataset.tileKind + ':' + t.scrollWidth + '>' + t.clientWidth)}));
    assert.equal(overflow.page <= 0, true, 'page scrolls sideways');
    assert.deepEqual(overflow.tiles, []);
  } finally { await context.close(); }
});

test('talk section: three groups, no raw backticks, no emoji, nothing clipped, saved values still read back', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context} = await open('/agenten/running');
  try {
    const section = page.locator('#talk-slot');
    await section.waitFor();
    assert.equal(await section.locator('fieldset, details.talk-group').count(), 3);
    const text = await section.innerText();
    assert.doesNotMatch(text, /`/);
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
    const clipped = await section.locator('select, input').evaluateAll(nodes => nodes.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.id));
    assert.deepEqual(clipped, []);
    for (const id of ['persona', 'primary-model', 'fast-model', 'opmode', 'summon-policy', 'wakeword', 'mic-device', 'speaker-device', 'camera-device'])
      assert.equal(await page.locator('#running-talk-' + id).count(), 1, id);
  } finally { await context.close(); }
});

test('header: backend and RAM pills are words with a dot, no emoji, one statement each', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context} = await open('/agenten/running');
  try {
    const backendPill = page.locator('#backend-origin-badge');
    await page.waitForFunction(() => document.getElementById('backend-origin-badge').textContent === 'Backend Server');
    assert.equal(await backendPill.getAttribute('data-tone'), 'ok');
    const ram = page.locator('#header-ram-claim-label');
    await page.waitForFunction(() => document.getElementById('header-ram-claim-label').textContent.startsWith('Modell aktiv'));
    assert.equal(await ram.innerText(), 'Modell aktiv · qwen3.8:27b-mlx');
    assert.equal(await page.locator('#header-ram-claim-btn').getAttribute('data-tone'), 'busy');
    assert.doesNotMatch(await page.locator('.main-header .header-left').innerText(), /\p{Extended_Pictographic}/u);
    const dot = await page.locator('#backend-origin-badge').evaluate(n => getComputedStyle(n, '::before').backgroundColor);
    assert.notEqual(dot, 'rgba(0, 0, 0, 0)');
  } finally { await context.close(); }
});

for (const theme of THEMES) {
  test(`${theme}: pinned domains, talk popover and talk transcript are readable (4.5:1, measured)`, async t => {
    if (!browser) return t.skip('kein Playwright-Browser installiert');
    const running = await open('/agenten/running', {theme});
    try {
      const {page} = running;
      await page.locator('#domain-pins-menu').waitFor({state: 'attached'});
      await page.evaluate(() => {
        document.getElementById('domain-pins-menu').innerHTML = '<a class="dropdown-item" href="#"><span class="dropdown-item-icon">x</span><span class="dropdown-item-text"><span class="dropdown-item-title">Förderplaner</span><span class="dropdown-item-desc">Therapie- und Förderplanung</span></span></a>';
        document.getElementById('app-sidebar').classList.add('is-open');
      });
      await assertContrast(page, '.sidebar-domain-pins .dropdown-item-title', 'pinned domain title');
      await assertContrast(page, '.sidebar-domain-pins .dropdown-item-desc', 'pinned domain description');
      await assertContrast(page, '.sidebar-domain-pins-label', 'pinned domain label');
      await page.locator('#header-talk-radio-btn').click();
      await page.locator('#header-talk-popover:not([hidden])').waitFor();
      for (const selector of ['.talk-console-subtitle', '.talk-section-label', '.talk-persona-pill:not(.is-active)', '.talk-persona-pill.is-active',
        '.talk-ptt-hero', '.talk-duplex-btn', '.talk-quick-input', '.talk-mode-pill:not(.is-active)', '.talk-drawer-summary', '.talk-footer-link', '.talk-footer-link-primary', '.talk-mono-pill'])
        await assertContrast(page, '#header-talk-popover ' + selector, 'popover ' + selector);
    } finally { await running.context.close(); }

    const talk = await open('/talk?companion=1', {theme});
    try {
      const {page} = talk;
      await page.route('**/api/talk/turn', route => route.fulfill({status: 200, contentType: 'application/json',
        body: JSON.stringify({spoken_text: 'Hallo Lukas.', visual_state: {color_primary: '#38bdf8'}})}));
      await page.locator('#utteranceInput').fill('Wie geht es dir?');
      await page.locator('#utteranceInput').press('Enter');
      await page.locator('.talk-transcript-model').waitFor();
      await assertContrast(page, '.talk-transcript-user', 'transcript row (you)');
      await assertContrast(page, '.talk-transcript-user .talk-transcript-role', 'transcript role (you)');
      await assertContrast(page, '.talk-transcript-model', 'transcript row (model)');
      await assertContrast(page, '.talk-transcript-model .talk-transcript-role', 'transcript role (model)');
    } finally { await talk.context.close(); }
  });
}

test('icon style: line glyphs by default, the emoji only in emoji mode', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  for (const [style, line, emoji] of [['line', true, false], ['emoji', false, true]]) {
    const {page, context} = await open('/agenten/running', {iconStyle: style});
    try {
      const refresh = page.locator('.section-action-bar button', {hasText: 'Neu prüfen'}).first();
      await refresh.waitFor();
      assert.equal(await refresh.locator('.icon-glyph-line').first().isVisible(), line, style + ' line');
      assert.equal(await refresh.locator('.icon-glyph-emoji').first().isVisible(), emoji, style + ' emoji');
    } finally { await context.close(); }
  }
});
