import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {scan} from '../scripts/page-reads-scan.mjs';
import {checkManifest, checkRoot, loadManifest} from '../scripts/page-reads-check.mjs';
import {writeReleaseManifest} from '../scripts/release-manifest.mjs';
import {INVENTORIES} from '../src/lib/capability-board-client.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = file => readFileSync(resolve(root, file), 'utf8');
const found = scan(root);
const fresh = () => structuredClone(loadManifest(root));
const run = manifest => checkManifest(manifest, structuredClone(found), read);
const has = (problems, text) => assert.ok(problems.some(p => p.includes(text)), `expected a problem with "${text}", got: ${problems.join(' | ')}`);

test('manifest is bound to the call sites: no undeclared, dead or mis-declared page read', () => {
  assert.deepEqual(checkRoot(root), []);
});

test('manifest is part of the build output source and has the contract schema', () => {
  assert.equal(existsSync(resolve(root, 'public', 'page-reads.v1.json')), true);
  const manifest = loadManifest(root);
  assert.equal(manifest.schema, 'ellmos.gui.page-reads.v1');
  assert.deepEqual(Object.keys(manifest.pages).sort(), Object.keys(found.pages).sort());
});

test('layout reads are declared once, optional, and not repeated per page', () => {
  const manifest = loadManifest(root);
  assert.ok(manifest.layout.some(e => e.path === '/api/gui/brand' && e.required === false));
  for (const entry of manifest.layout) assert.equal(entry.required, false);
  for (const [page, entries] of Object.entries(manifest.pages))
    for (const entry of entries) assert.ok(!['/api/gui/brand', '/api/domains/pins'].includes(entry.path), `${page} repeats a layout read`);
});

test('every board page requires exactly the inventory of its board', () => {
  const manifest = loadManifest(root);
  const pages = {'/skills': 'skills', '/skills/plugins': 'plugins', '/skills/mcp': 'mcp', '/skills/software': 'software', '/skills/ocean': 'ocean'};
  for (const [page, board] of Object.entries(pages)) {
    const file = page === '/skills' ? 'src/pages/skills.astro' : `src/pages${page}.astro`;
    assert.match(read(file), new RegExp(`board="${board}"`), `${file} does not show board ${board}`);
    const required = manifest.pages[page].filter(e => e.required).map(e => e.path);
    assert.deepEqual(required, [INVENTORIES[board]], page);
  }
});

test('the settings page stays usable without the cluster status widget (optional read)', () => {
  const entry = loadManifest(root).pages['/settings'].find(e => e.path === '/api/system/cluster-cockpit');
  assert.equal(entry.required, false);
});

test('negative control: a call in the code without a manifest entry fails', () => {
  const manifest = fresh();
  manifest.pages['/'] = manifest.pages['/'].filter(e => e.path !== '/api/tasks');
  has(run(manifest), 'undeclared read GET /api/tasks');
});

test('negative control: a manifest entry without a call in the code fails', () => {
  const manifest = fresh();
  manifest.pages['/domains'].push({method: 'GET', path: '/api/domains/ghost', required: false});
  has(run(manifest), 'dead entry /domains: GET /api/domains/ghost');
  const moved = fresh();
  moved.pages['/tasks'].push(moved.pages['/memory'].find(e => e.path === '/api/memory/working'));
  has(run(moved), 'dead entry /tasks: GET /api/memory/working');
});

test('negative control: the method of the call site must be the declared one', () => {
  const manifest = fresh();
  manifest.pages['/settings'].find(e => e.method === 'PUT' && e.path === '/api/settings/theme').method = 'POST';
  has(run(manifest), 'method PUT');
  const helper = fresh(); // changeRoutine(path, 'DELETE', ...) in life.astro: the method is a helper argument
  helper.pages['/life'].find(e => e.method === 'DELETE' && e.path === '/api/routines/{id}').method = 'PUT';
  has(run(helper), 'method DELETE');
});

test('negative control: dynamic entries need the function of their call site', () => {
  const missingFile = fresh();
  missingFile.pages['/tasks'].find(e => e.dynamic).found_in = 'src/lib/does-not-exist.mjs#x';
  has(run(missingFile), 'needs found_in');
  const wrongFunction = fresh();
  wrongFunction.pages['/tasks'].find(e => e.dynamic).found_in = 'src/pages/tasks.astro#noSuchFunctionAnywhere';
  has(run(wrongFunction), 'needs found_in');
  const otherFunction = fresh(); // an existing function that does not make this call
  const entry = otherFunction.pages['/tasks'].find(e => e.dynamic && e.path === '/api/tasks/{id}/result');
  entry.found_in = 'src/pages/tasks.astro#loadTasks';
  has(run(otherFunction), 'dead entry /tasks: GET /api/tasks/{id}/result');
  const wrongTail = fresh();
  wrongTail.pages['/skills'].find(e => e.dynamic && e.path.endsWith('/history')).path = '/api/capabilities/skills/{id}/nonexistent-tail';
  has(run(wrongTail), 'nonexistent-tail');
  const staticClaim = fresh();
  delete staticClaim.pages['/tasks'].find(e => e.dynamic).dynamic;
  has(run(staticClaim), 'found_in only with dynamic');
});

test('negative control: shape rules (layout required, page lists, methods, duplicates)', () => {
  const layout = fresh(); layout.layout[0].required = true; has(run(layout), 'layout reads must be optional');
  const missingPage = fresh(); delete missingPage.pages['/life']; has(run(missingPage), 'page /life: no manifest entry');
  const extraPage = fresh(); extraPage.pages['/nonexistent'] = []; has(run(extraPage), 'no such page');
  const method = fresh(); method.pages['/'][0].method = 'GRAB'; has(run(method), 'invalid method');
  const duplicate = fresh(); duplicate.pages['/'].push({...duplicate.pages['/'][0]}); has(run(duplicate), 'duplicate');
  assert.deepEqual(checkManifest({schema: 'x'}, found, read), ['schema: not ellmos.gui.page-reads.v1']);
});

// ---- fixtures: real source trees in a temp directory, scanned and checked like the GUI itself ----
const trees = [];
test.after(() => { for (const dir of trees) rmSync(dir, {recursive: true, force: true}); });
function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'page-reads-'));
  trees.push(dir);
  for (const [name, text] of Object.entries(files)) { const path = join(dir, name); mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, text); }
  return dir;
}
const page = script => `---\n---\n<main>\n  German text with an apostrophe: it's fine here.\n</main>\n<script>\n${script}\n</script>\n`;
const entry = (method, path, extra = {}) => ({method, path, required: false, ...extra});
const manifestOf = (index, layout = []) => ({schema: 'ellmos.gui.page-reads.v1', layout, pages: {'/': index}});
const noHelpers = {helpers: [], passthrough: []};
const check = (dir, manifest, options = noHelpers) => checkManifest(manifest, scan(dir, options), file => readFileSync(join(dir, file), 'utf8'));
const HERE = 'src/pages/index.astro#load';

test('fixture: a plain call passes; a new call, a new import and a new script are each found', () => {
  const ok = tree({'src/pages/index.astro': page("async function load() { await fetch('/api/a'); }")});
  assert.deepEqual(check(ok, manifestOf([entry('GET', '/api/a')])), []);

  const newCall = tree({'src/pages/index.astro': page("async function load() { await fetch('/api/a'); await fetch('/api/b'); }")});
  has(check(newCall, manifestOf([entry('GET', '/api/a')])), 'undeclared read GET /api/b');

  const imported = tree({
    'src/pages/index.astro': page("import {pull} from '../lib/pull.mjs';\nasync function load() { await pull(); }"),
    'src/lib/pull.mjs': "export async function pull() { return fetch('/api/pulled'); }\n",
    'src/lib/unused.mjs': "export async function other() { return fetch('/api/not-reachable'); }\n",
  });
  const problems = check(imported, manifestOf([]));
  has(problems, 'undeclared read GET /api/pulled');
  assert.ok(!problems.some(p => p.includes('not-reachable')), problems.join(' | '));
  assert.deepEqual(check(imported, manifestOf([entry('GET', '/api/pulled')])), []);

  const publicScript = tree({'src/pages/index.astro': page(''), 'public/extra.js': "fetch('/api/from-public');\n"});
  has(check(publicScript, manifestOf([])), 'undeclared read GET /api/from-public');
  assert.deepEqual(check(publicScript, manifestOf([], [entry('GET', '/api/from-public')])), []);
});

test('fixture: variable, composed and aliased URLs are call sites too', () => {
  const variable = tree({'src/pages/index.astro': page("const choices = ['/api/v1', '/api/v2'];\nasync function load() { const target = choices[Math.floor(Math.random() * 2)]; await fetch(target); }")});
  has(check(variable, manifestOf([])), 'composed path: needs a dynamic entry with found_in ' + HERE);
  const dynamic = (extra = {}) => manifestOf([entry('GET', '/api/v1', {dynamic: true, found_in: HERE, ...extra}), entry('GET', '/api/v2', {dynamic: true, found_in: HERE})]);
  assert.deepEqual(check(variable, dynamic()), []);
  has(check(variable, dynamic({found_in: 'src/pages/index.astro#other'})), 'needs found_in');
  const unanchored = manifestOf([entry('GET', '/api/v3', {dynamic: true, found_in: HERE})]);
  has(check(variable, unanchored), 'dead entry /: GET /api/v3');

  const composed = tree({'src/pages/index.astro': page("async function load(id) { await fetch(`/api/t/${id}/result`); }")});
  assert.deepEqual(check(composed, manifestOf([entry('GET', '/api/t/{id}/result', {dynamic: true, found_in: HERE})])), []);
  // '/result/accept' elsewhere in the manifest must not carry '/result'
  const swapped = manifestOf([entry('GET', '/api/t/{id}/result/accept', {dynamic: true, found_in: HERE})]);
  has(check(composed, swapped), 'undeclared read GET /api/t/{}/result');
  has(check(composed, swapped), 'dead entry /: GET /api/t/{id}/result/accept');
  has(check(composed, manifestOf([entry('GET', '/api/t/{id}/result')])), 'undeclared read');

  const aliased = tree({'src/pages/index.astro': page("const get = window.fetch.bind(window);\nasync function load() { await get('/api/aliased'); await window.fetch('/api/global'); await globalThis.fetch('/api/globalthis'); }")});
  const names = check(aliased, manifestOf([])).join(' | ');
  for (const path of ['/api/aliased', '/api/global', '/api/globalthis']) assert.ok(names.includes(path), names);

  const parameter = tree({'src/pages/index.astro': page("const fetchImpl = fetch;\nasync function pull(fetchImpl = fetch) { return fetchImpl('/api/impl'); }\nasync function load() { await pull(); }")});
  has(check(parameter, manifestOf([])), 'undeclared read GET /api/impl');
});

test('fixture: a wrapper around fetch must be registered; its callers are the call sites', () => {
  const files = {
    'src/lib/api.mjs': 'export async function api(path, options = {}) {\n  return fetch(path, options);\n}\n',
    'src/pages/index.astro': page("import {api} from '../lib/api.mjs';\nasync function load() { await api('/api/w'); await api('/api/w2', {method: 'PUT'}); }"),
  };
  const dir = tree(files);
  has(check(dir, manifestOf([])), 'forwards a parameter of api()');
  const registered = {helpers: [{file: 'src/lib/api.mjs', name: 'api', url: 0, options: 1, scope: 'global'}], passthrough: []};
  has(check(dir, manifestOf([]), registered), 'undeclared read GET /api/w');
  assert.deepEqual(check(dir, manifestOf([entry('GET', '/api/w'), entry('PUT', '/api/w2')]), registered), []);
  has(check(dir, manifestOf([entry('GET', '/api/w'), entry('POST', '/api/w2')]), registered), 'method PUT');
  has(check(dir, manifestOf([entry('GET', '/api/w'), entry('GET', '/api/w2')]), registered), 'method PUT');
  // a hidden extra call inside the registered helper is not a pass-through
  const sneaky = tree({...files, 'src/lib/api.mjs': "export async function api(path, options = {}) {\n  await fetch('/api/side-channel');\n  return fetch(path, options);\n}\n"});
  has(check(sneaky, manifestOf([entry('GET', '/api/w'), entry('PUT', '/api/w2')]), registered), 'undeclared read GET /api/side-channel');
});

test('fixture: the method comes from the call site (options object, implicit GET, helper argument, ternary)', () => {
  const dir = tree({'src/pages/index.astro': page(
    "async function change(path, method) { return fetch(path, {method}); }\n" +
    "async function load(id, edit) {\n" +
    "  await fetch('/api/implicit');\n" +
    "  await fetch('/api/posted', {method: 'POST', body: '{}'});\n" +
    "  await change('/api/removed', 'DELETE');\n" +
    "  await change(edit ? `/api/items/${id}` : '/api/items', edit ? 'PUT' : 'POST');\n" +
    "}")});
  const options = {helpers: [{file: 'src/pages/index.astro', name: 'change', url: 0, method: 1}], passthrough: []};
  const good = manifestOf([entry('GET', '/api/implicit'), entry('POST', '/api/posted'), entry('DELETE', '/api/removed'),
    entry('PUT', '/api/items/{id}', {dynamic: true, found_in: HERE}), entry('POST', '/api/items')]);
  assert.deepEqual(check(dir, good, options), []);
  const wrong = structuredClone(good);
  wrong.pages['/'][0].method = 'POST';
  has(check(dir, wrong, options), 'method GET at src/pages/index.astro');
  const helperWrong = structuredClone(good);
  helperWrong.pages['/'][2].method = 'PUT';
  has(check(dir, helperWrong, options), 'method DELETE');
  const ternaryWrong = structuredClone(good); // the POST belongs to the path without id, not to /api/items/{id}
  ternaryWrong.pages['/'][3].method = 'POST';
  has(check(dir, ternaryWrong, options), 'method PUT');
  // a method that cannot be read from a literal call fails instead of defaulting
  const opaque = tree({'src/pages/index.astro': page("async function load(m) { await fetch('/api/unknown', {method: m}); }")});
  has(check(opaque, manifestOf([entry('GET', '/api/unknown')])), 'not determinable');
});

test('fixture: dist copy and release receipt carry the manifest byte for byte', async () => {
  const dir = tree({'dist/index.html': '<p>fixture</p>\n'});
  const bytes = readFileSync(resolve(root, 'public', 'page-reads.v1.json'));
  writeFileSync(join(dir, 'dist', 'page-reads.v1.json'), bytes);
  mkdirSync(join(dir, 'release'), {recursive: true});
  const head = 'a'.repeat(40);
  writeFileSync(join(dir, 'release', '.build-source.json'), JSON.stringify({schema: 'ellmos-system-gui.build-source.v1', source_commit: head}));
  const record = await writeReleaseManifest({root: dir, git: (_command, args) => args[0] === 'status' ? '' : head + '\n'});
  assert.equal(record.files['page-reads.v1.json'], createHash('sha256').update(bytes).digest('hex'));
  assert.equal(JSON.parse(readFileSync(join(dir, 'dist', 'page-reads.v1.json'), 'utf8')).schema, 'ellmos.gui.page-reads.v1');
});
