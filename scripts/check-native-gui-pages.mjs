// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile} from 'node:fs/promises';
import {extname, join} from 'node:path';

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'],
  ['.webp', 'image/webp'], ['.ico', 'image/x-icon'], ['.woff2', 'font/woff2'],
]);
const openTask = {id:920001, title:'CI-Aufgabe für die Desktop-Prüfung', status:'pending', priority:'P2'};
const doneTask = {id:920002, title:'CI-Aufgabe bereits erledigt', status:'done', priority:'P3'};
const worker = {id:'ci-worker', name:'CI-Worker für die Desktop-Prüfung',
  status:'idle', backend:'ollama', model:'ci-model', runtime_verified:true, running:false};

export const smokeSamples = {openTask, doneTask, worker};

export async function openVerifiedGui(dist, commit) {
  const manifest = JSON.parse(await readFile(join(dist, 'dist-manifest.json'), 'utf8'));
  assert.match(commit, /^[0-9a-f]{40}$/);
  assert.equal(manifest.schema, 'ellmos-system-gui.dist.v1');
  assert.equal(manifest.source_commit, commit);
  const files = new Map(Object.entries(manifest.files));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  async function verifiedFile(file) {
    assert.ok(files.has(file) && !/[\\:]/.test(file)
      && file.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid GUI file: ' + file);
    const bytes = await readFile(join(dist, file));
    assert.equal(hash(bytes), files.get(file), 'Shared GUI file changed: ' + file);
    return bytes;
  }
  const pages = JSON.parse(await verifiedFile('page-reads.v1.json'));
  assert.equal(pages.schema, 'ellmos.gui.page-reads.v1');
  const routes = new Map(Object.keys(pages.pages).map(path => [path, path === '/' ? 'index.html' : path.slice(1) + '.html']));
  assert.deepEqual([...routes.values()].sort(), [...files.keys()].filter(file => file.endsWith('.html')).sort(),
    'Static web build and shared GUI page contract disagree');

  function json(response, code, value) {
    response.writeHead(code, {'Content-Type':'application/json', 'Cache-Control':'no-store'}).end(JSON.stringify(value));
  }
  async function respond(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method !== 'GET') {
      json(response, 405, {detail:'Read-only desktop fixture'});
      return;
    }
    if (url.pathname === '/api/tasks') {
      const status = url.searchParams.get('status');
      const tasks = status === 'done' ? [doneTask] : [openTask];
      json(response, 200, {success:true, tasks, total:tasks.length, has_more:false, applied_filters:{
        status, sort:url.searchParams.get('sort') ?? 'priority', assignment_group:'all',
      }});
      return;
    }
    if (url.pathname === '/api/system/workers') {
      json(response, 200, {schema:'bach.workers.status.v1', availability:'available', workers:[worker]});
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      json(response, 501, {detail:'Backend operation outside the desktop smoke fixture'});
      return;
    }
    const file = routes.get(url.pathname) ?? decodeURIComponent(url.pathname.slice(1));
    if (!files.has(file)) {
      response.writeHead(404).end();
      return;
    }
    const body = await verifiedFile(file);
    response.writeHead(200, {'Content-Type':contentTypes.get(extname(file)) ?? 'application/octet-stream',
      'Cache-Control':'no-store'}).end(body);
  }
  return {
    respond, pageCount:routes.size, sourceCommit:commit,
    pageHash:path => files.get(routes.get(path)),
  };
}

export async function walkGuiPages(page, gui, origin, output) {
  const timeout = 10000;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin ? route.continue() : route.abort();
  });
  await mkdir(output, {recursive:true});
  const results = [];
  async function record(path, name, heading) {
    assert.equal(new URL(page.url()).pathname, path);
    assert.equal(new URL(page.url()).origin, origin);
    await page.getByRole('heading', {level:1, name:heading}).waitFor({state:'visible', timeout});
    const screenshot = name + '.png';
    await page.screenshot({path:join(output, screenshot), timeout});
    results.push({route:path, html_sha256:gui.pageHash(path), screenshot});
  }

  // The native connection flow already opened this target. Reuse it for the real web distribution.
  const dashboard = await page.reload({waitUntil:'domcontentloaded', timeout});
  assert.equal(dashboard.status(), 200);
  await page.locator('#tasks-container').getByText(openTask.title, {exact:false}).waitFor({timeout});
  assert.equal(await page.locator('#stat-tasks').textContent(), '1');
  await record('/', 'dashboard', /Willkommen/);
  await page.locator('#main-content a[href="/tasks"]').click({timeout});
  const taskTable = page.locator('#tasks-table-container');
  await taskTable.getByText(openTask.title, {exact:true}).waitFor({timeout});
  await page.locator('#tasks-status-filter').selectOption('done', {timeout});
  await taskTable.getByText(doneTask.title, {exact:true}).waitFor({timeout});
  assert.equal(await taskTable.getByText(openTask.title, {exact:true}).count(), 0);
  await record('/tasks', 'aufgaben', /^Aufgaben$/);

  await page.goBack({waitUntil:'domcontentloaded', timeout});
  await page.locator('#main-content a[href="/agenten/running"]').last().click({timeout});
  await page.locator('#worker-status-summary').filter({hasText:'1 Worker registriert'}).waitFor({timeout});
  const readyWorker = page.locator('#ready-agents-grid').getByText(worker.name, {exact:true});
  await readyWorker.waitFor({timeout});
  const search = page.locator('#agent-overview-query');
  await search.fill('anderer Name', {timeout});
  await readyWorker.waitFor({state:'hidden', timeout});
  await search.fill('', {timeout});
  await readyWorker.waitFor({timeout});
  await record('/agenten/running', 'running', /Living & Running/);
  assert.deepEqual(errors, [], 'Uncaught JavaScript errors in the native page walk');
  return {
    source_commit:gui.sourceCommit, web_build_page_count:gui.pageCount, page_contract_count:gui.pageCount,
    fixture_backend:'loopback-read-only', uncaught_javascript_errors:errors.length, routes:results,
  };
}
