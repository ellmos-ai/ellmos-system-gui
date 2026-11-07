// PB-4 (#3988): aborts are visible. Real browser (Playwright), real pages, injected backend answers.
// Builds the site into a temp folder, serves it, and answers /api/* from the fixture below, so no backend is needed.
// Without an installed browser the test is skipped (CI installs none); locally `npx playwright-core install chromium` once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon'};

const task = (id, title, status = 'pending') => ({id, title, status, priority: 'P2', assigned_to: 'BACH', description: 'Beschreibung ' + id});
const TASKS = [task(101, 'Schleife mit Flattern'), task(102, 'Zweimal zurückgegeben'), task(103, 'Einmal zurückgegeben'),
  task(104, 'Blockierte Aufgabe', 'blocked'), task(105, 'Erledigt trotz Rückgaben', 'done')];
const summary = (count, reason, over = {}) => ({available: true, contract: 'task-returns.v1', return_count: count, last_return_reason: reason,
  last_return_at: '2026-11-07T08:00:00+00:00', consecutive_identical: count, flapping: false, host_scoped: false, ...over});
const RETURNS = {
  101: summary(65, 'host_precondition:twin_status_unknown', {flapping: true, host_scoped: true}),
  102: summary(2, 'task_scope_unavailable'),
  103: summary(1, 'task_scope_unavailable'),
  104: summary(5, 'repeated_return:task_scope_unavailable'),
  105: summary(9, 'task_scope_unavailable'),
};
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString().replace('Z', '');
const EVENTS = [
  {task_id: 101, task_title: 'Schleife mit Flattern', at: ago(2), worker: 'worker-9e4c@MAC', reason: 'host_precondition:twin_status_unknown', outcome: 'return'},
  {task_id: 102, task_title: 'Zweimal zurückgegeben', at: ago(30), worker: 'worker-45dc@MAC', reason: 'task_scope_unavailable', outcome: 'return'},
  {task_id: 101, task_title: 'Schleife mit Flattern', at: ago(31), worker: 'worker-9e4c@MAC', reason: 'host_precondition:twin_status_unknown', outcome: 'return'},
];
const WORKERS = {
  schema: 'bach.workers.status.v1', availability: 'available', workers: [
    {id: 'worker-run', name: 'Läufer', backend: 'ollama', model: 'qwen', status: 'running', runtime_verified: true, running: true,
      worker_active: true, active_task_id: 101, current_activity: 'Arbeitet', tool_round: 1},
    {id: 'worker-wait', name: 'Wartender', backend: 'ollama', model: 'qwen', status: 'running', runtime_verified: true, running: false,
      worker_active: true, current_activity: 'Host-Voraussetzung fehlt (twin_status_unknown); Versuch 3, nächster in 240 s',
      precondition_wait: {state: 'waiting_precondition', code: 'twin_status_unknown', attempt: 3, next_check_at: new Date(Date.now() + 240000).toISOString()}},
    {id: 'worker-ended', name: 'Abgebrochener', backend: 'ollama', model: 'qwen', status: 'completed', runtime_verified: true, running: false,
      worker_active: false, generation: 'a'.repeat(32), current_activity: '',
      execution: {schema: 'bach.worker-execution.v1', state: 'terminal', terminal: true, generation: 'a'.repeat(32),
        provider_request: {schema: 'bach.provider-request.v1', request_id: 'c'.repeat(32), generation: 'a'.repeat(32), task_id: 101,
          task_fence_available: false, task_fence: null, state: 'terminal', phase: 'runtime_call_complete', phase_at: '2026-11-07T08:00:00+00:00',
          terminal_reason: 'total_deadline', details_available: true, lease_version_bound: false}}},
  ]};
const SESSIONS = {schema: 'bach.chat-sessions.v1', source: 'session_snapshots', snapshot_type: 'chat-transcript.v1', agent_id: null,
  context: 'global', archive: 'all', offset: 0, limit: 25, total: 2, has_more: false, source_filter: 'all', problems: false,
  source_counts: {user: 1, buddha: 0, worker: 1, system: 0}, save_limits: {max_messages: 200, max_content_chars: 20000},
  sessions: [
    {id: 1, session_id: 's1', name: 'Worker-Lauf', created_at: '2026-11-07T08:00:00', chat_id: 'worker-9e4c', source: 'worker', archived: false,
      stored_message_count: 3, failed_count: 0, context_class: null, agent_id: null},
    {id: 2, session_id: 's2', name: 'Gespräch', created_at: '2026-11-07T07:00:00', chat_id: '12345', source: 'user', archived: false,
      stored_message_count: 2, failed_count: 0, context_class: null, agent_id: null}]};

function backend(requests) {
  return route => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
    requests.push(url.pathname + url.search);
    if (url.pathname === '/api/tasks') {
      const status = url.searchParams.get('status');
      return json({success: true, tasks: TASKS, total: TASKS.length, has_more: false,
        applied_filters: {status, assignment_group: url.searchParams.get('assignment_group')}});
    }
    if (/^\/api\/tasks\/10\d$/.test(url.pathname)) return json(TASKS.find(t => `/api/tasks/${t.id}` === url.pathname));
    if (url.pathname === '/api/task-returns') {
      const ids = url.searchParams.get('ids').split(',');
      return json({tasks: Object.fromEntries(ids.filter(id => RETURNS[id]).map(id => [id, RETURNS[id]]))});
    }
    if (url.pathname === '/api/task-returns/timeline') {
      const hours = Number(url.searchParams.get('hours'));
      const only = url.searchParams.get('task_id');
      const events = EVENTS.filter(e => !only || e.task_id === Number(only));
      return json({schema: 'bach.task-return-timeline.v1', hours, total: events.length + (hours === 168 ? 40 : 0), truncated: hours === 168,
        by_reason: {task_scope_unavailable: events.length}, events});
    }
    if (url.pathname === '/api/system/workers') return json(WORKERS);
    if (url.pathname === '/api/agent-history/sessions') {
      const source = url.searchParams.get('source') || 'all';
      const sessions = SESSIONS.sessions.filter(s => source === 'all' || s.source === source);
      return json({...SESSIONS, sessions, total: sessions.length, source_filter: source});
    }
    return json({detail: 'nicht im Test'}, 404);
  };
}

const luminance = ([r, g, b]) => {
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

// Effective colors of an element in the page: text color and the background composited over its ancestors.
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
  const text = parse(getComputedStyle(node).color);
  return {text: text.rgb, background: base};
});

let launch, dist, server, baseUrl, browser;
test.before(async () => {
  try {
    const {chromium} = await import('playwright-core');
    browser = await chromium.launch();
  } catch { return; }
  dist = mkdtempSync(join(tmpdir(), 'pb4-dist-'));
  execFileSync(process.execPath, [join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build', '--outDir', dist], {cwd: root, stdio: 'pipe'});
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
  if (dist) rmSync(dist, {recursive: true, force: true});
});

async function open(path, {theme = 'dark', width = 1440} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  await context.addInitScript(value => localStorage.setItem('bach-theme', value), theme);
  const requests = [];
  await context.route('**/api/**', backend(requests));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl + path);
  return {page, context, requests, errors};
}

test('tasks: warning shield from two returns, critical for flapping and blocked, none for one return or finished tasks', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context, errors} = await open('/tasks');
  try {
    await page.locator('[data-task-return="101"] [data-return-badge]').waitFor();
    const badge = id => page.locator(`[data-task-return="${id}"] [data-return-badge]`);
    assert.equal(await badge(101).innerText(), '⚠ 65× zurückgegeben · wechselt hin und her');
    assert.equal(await badge(101).getAttribute('data-return-badge'), 'critical');
    assert.equal(await badge(102).innerText(), '⚠ 2× zurückgegeben');
    assert.equal(await badge(102).getAttribute('data-return-badge'), 'warn');
    assert.match(await badge(104).innerText(), /blockiert/);
    assert.equal(await badge(103).count(), 0, 'one return is no warning');
    assert.equal(await badge(105).count(), 0, 'finished tasks carry no shield');
    assert.match(await badge(101).getAttribute('title'), /Sperrstatus.*Mac|Mac.*Sperrstatus/s);
    assert.match(await page.locator('#tasks-returns-alert').innerText(), /3 Aufgaben/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('tasks: detail explains the last reason in plain words and keeps the raw code', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context, requests} = await open('/tasks');
  try {
    await page.locator('[data-task-return="101"] [data-return-badge]').waitFor();
    await page.locator('button[aria-label="Aufgabe #101 öffnen"]').click();
    const block = page.locator('#task-view-returns .return-block');
    await block.waitFor();
    assert.match(await block.innerText(), /65× zurückgegeben/);
    assert.match(await block.innerText(), /Sperrstatus des BACH-Zwillings unbekannt/);
    assert.match(await block.innerText(), /Finder/);
    assert.match(await block.innerText(), /Der Fehler liegt am Host, nicht an dieser Aufgabe/);
    assert.equal(await block.locator('code').innerText(), 'host_precondition:twin_status_unknown');
    await page.locator('#task-returns-detail summary').click();
    await page.locator('#task-returns-detail [data-rt-body] tr').first().waitFor();
    assert.ok(requests.some(r => r.startsWith('/api/task-returns/timeline?hours=24&limit=200&task_id=101')), requests.join('\n'));
  } finally { await context.close(); }
});

test('timeline: 24 hours and 7 days, filter by worker and by reason, truncation is stated', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context, requests} = await open('/tasks');
  try {
    await page.locator('#task-returns-overview summary').click();
    const timeline = page.locator('#task-returns-overview [data-return-timeline]');
    await timeline.locator('[data-rt-body] tr').first().waitFor();
    assert.equal(await timeline.locator('[data-rt-body] tr').count(), 3);
    assert.match(await timeline.locator('[data-rt-summary]').innerText(), /3 Rückgaben in 24 Stunden/);
    await timeline.locator('[data-rt-worker]').selectOption('worker-45dc@MAC');
    assert.equal(await timeline.locator('[data-rt-body] tr').count(), 1);
    assert.match(await timeline.locator('[data-rt-summary]').innerText(), /1 nach Filter/);
    await timeline.locator('[data-rt-worker]').selectOption('');
    await timeline.locator('[data-rt-reason]').selectOption('host_precondition:twin_status_unknown');
    assert.equal(await timeline.locator('[data-rt-body] tr').count(), 2);
    await timeline.locator('[data-rt-window]').selectOption('168');
    await page.waitForFunction(() => document.querySelector('#task-returns-overview [data-rt-summary]').textContent.includes('7 Tage'));
    assert.ok(requests.some(r => r.startsWith('/api/task-returns/timeline?hours=168&limit=200')));
    assert.match(await timeline.locator('[data-rt-summary]').innerText(), /43 Rückgaben in 7 Tage.*die neuesten 3 werden gezeigt/);
  } finally { await context.close(); }
});

test('running: the card of a running worker shows the shield of its task; a waiting worker says what it waits for', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context, errors} = await open('/agenten/running');
  try {
    const run = page.locator('#running-workers-list [data-worker-id="worker-run"]').first();
    await run.waitFor();
    await run.locator('[data-return-badge="critical"]').waitFor();
    assert.match(await run.innerText(), /65× zurückgegeben/);
    const wait = page.locator('[data-worker-wait="twin_status_unknown"]');
    await wait.waitFor();
    assert.match(await wait.innerText(), /Wartet auf Voraussetzung: Sperrstatus des BACH-Zwillings unbekannt/);
    assert.match(await wait.innerText(), /Versuch 3/);
    assert.match(await wait.innerText(), /nächste Prüfung in [34] min/);
    const ended = page.locator('[data-appearance-worker="worker-ended"] .provider-request-status').first();
    await ended.waitFor();
    assert.match(await ended.innerText(), /Letzter Provideraufruf · Aufruf beendet · Zeitlimit für den Lauf erreicht/);
    await page.locator('#running-returns-alert:not([hidden])').waitFor();
    assert.match(await page.locator('#running-returns-alert').innerText(), /3 Rückgaben in 24 Stunden/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('sessions: a worker chat is marked when its worker returned tasks, and the marker leads to the returns', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context} = await open('/agenten/sessions');
  try {
    await page.locator('#history-source').selectOption('all');
    const marker = page.locator('[data-session-problem="returns"]');
    await marker.waitFor();
    assert.match(await marker.innerText(), /Problem: 2 Rückgaben in 24 Stunden · Sperrstatus des BACH-Zwillings unbekannt/);
    assert.equal(await page.locator('[data-session-problem]').count(), 1, 'the user chat is not marked');
    await marker.getByRole('button', {name: 'Rückgaben ansehen'}).click();
    const timeline = page.locator('#returns-panel [data-return-timeline]');
    await timeline.locator('[data-rt-body] tr').first().waitFor();
    await page.waitForFunction(() => document.querySelector('#returns-panel [data-rt-worker]').value === 'worker-9e4c@MAC');
    assert.equal(await timeline.locator('[data-rt-body] tr').count(), 2);
    assert.equal(await page.locator('[data-history-tab="returns"]').getAttribute('aria-pressed'), 'true');
  } finally { await context.close(); }
});

test('contrast: shield, reason block and timeline text reach 4.5:1 in every theme', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  for (const theme of ['dark', 'light', 'warm', 'ocean', 'colorful']) {
    const {page, context} = await open('/tasks', {theme});
    try {
      await page.locator('[data-task-return="101"] [data-return-badge]').waitFor();
      await page.locator('button[aria-label="Aufgabe #101 öffnen"]').click();
      await page.locator('#task-view-returns .return-block').waitFor();
      await page.locator('#task-returns-overview summary').click();
      await page.locator('#task-returns-overview [data-rt-body] tr').first().waitFor();
      for (const selector of ['[data-task-return="101"] [data-return-badge]', '[data-task-return="102"] [data-return-badge]',
        '#task-view-returns .return-headline', '#task-view-returns .return-hint', '#tasks-returns-alert',
        '#task-returns-overview [data-rt-body] td', '#task-returns-overview .return-code', '#task-returns-overview [data-rt-summary]']) {
        const {text, background} = await colorsOf(page, selector);
        const value = ratio(text, background);
        assert.ok(value >= 4.5, `${theme} ${selector}: ${value.toFixed(2)}`);
      }
    } finally { await context.close(); }
  }
});

test('phone width: no horizontal overflow with shield, reason block and timeline open', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  for (const path of ['/tasks', '/agenten/sessions?tab=returns']) {
    const {page, context} = await open(path, {width: 390});
    try {
      if (path === '/tasks') {
        await page.locator('[data-task-return="101"] [data-return-badge]').waitFor();
        await page.locator('#task-returns-overview summary').click();
      }
      await page.locator('[data-rt-body] tr').first().waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${path} overflows by ${overflow}px`);
    } finally { await context.close(); }
  }
});
