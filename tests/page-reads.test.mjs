import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {scan} from '../scripts/page-reads-scan.mjs';
import {checkManifest, checkRoot, loadManifest} from '../scripts/page-reads-check.mjs';
import {INVENTORIES} from '../src/lib/capability-board-client.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = file => readFileSync(resolve(root, file), 'utf8');
const found = scan(root);
const fresh = () => structuredClone(loadManifest(root));
const run = manifest => checkManifest(manifest, structuredClone(found), read);
const has = (problems, text) => assert.ok(problems.some(p => p.includes(text)), `expected a problem with "${text}", got: ${problems.join(' | ')}`);

test('manifest is bound to the code: no undeclared, dead or mis-declared page read', () => {
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

test('negative control: a call in the code without a manifest entry fails', () => {
  const manifest = fresh();
  manifest.pages['/'] = manifest.pages['/'].filter(e => e.path !== '/api/tasks');
  has(run(manifest), 'undeclared read /api/tasks');
  const synthetic = structuredClone(found);
  synthetic.pages['/memory'].push({file: 'src/pages/memory.astro', line: 1, pattern: '/api/memory/new-endpoint'});
  has(checkManifest(fresh(), synthetic, read), 'undeclared read /api/memory/new-endpoint');
});

test('negative control: a manifest entry without a call in the code fails', () => {
  const manifest = fresh();
  manifest.pages['/domains'].push({method: 'GET', path: '/api/domains/ghost', required: false});
  has(run(manifest), 'dead entry /domains: GET /api/domains/ghost');
  const moved = fresh();
  moved.pages['/tasks'].push(moved.pages['/memory'].find(e => e.path === '/api/memory/working'));
  has(run(moved), 'dead entry /tasks: GET /api/memory/working');
});

test('negative control: a method stated at the call site must be declared', () => {
  const manifest = fresh();
  const entry = manifest.pages['/settings'].find(e => e.method === 'PUT' && e.path === '/api/settings/theme');
  entry.method = 'POST';
  has(run(manifest), 'method PUT');
});

test('negative control: dynamic entries need a living source location', () => {
  const missingFile = fresh();
  missingFile.pages['/tasks'].find(e => e.dynamic).found_in = 'src/lib/does-not-exist.mjs#x';
  has(run(missingFile), 'needs found_in');
  const wrongFunction = fresh();
  wrongFunction.pages['/tasks'].find(e => e.dynamic).found_in = 'src/pages/tasks.astro#noSuchFunctionAnywhere';
  has(run(wrongFunction), 'does not contain noSuchFunctionAnywhere');
  const wrongTail = fresh();
  const dyn = wrongTail.pages['/skills'].find(e => e.dynamic && e.path.endsWith('/history'));
  dyn.path = '/api/capabilities/skills/{id}/nonexistent-tail';
  has(run(wrongTail), 'does not contain /nonexistent-tail');
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
