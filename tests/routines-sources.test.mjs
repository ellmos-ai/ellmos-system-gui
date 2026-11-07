// PB-6 (#3990): /routinen reads every source by probe (not by constant) and says honestly why one is unreachable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRoutinesClient, filterRoutines, attention, formatWhen, SOURCE_KEYS} from '../src/lib/routines.mjs';
import {routinesBackend} from './fixtures/routines-backend.mjs';

const loadRoutines = fetcher => createRoutinesClient(fetcher).load();
const runControl = (fetcher, control) => createRoutinesClient(fetcher).run(control);
const byId = (items, id) => items.find(item => item.id === id);

test('all sources answer: one list with stable IDs, measured data and a confirmed state per source', async () => {
  const {items, sources} = await loadRoutines(routinesBackend());
  assert.deepEqual(items.map(i => i.id).sort(), ['bach-job:1', 'bach-job:2', 'bach-job:3', 'bach-recurring:doc_review', 'bach-recurring:self_check',
    'life:12', 'life:13', 'ocean:team.weekly']);
  assert.equal(new Set(items.map(i => i.id)).size, items.length);
  assert.ok(items.every(i => i.dataSource === 'measured'));
  assert.deepEqual(SOURCE_KEYS, ['bach', 'ocean', 'module', 'life']);
  assert.equal(sources.bach.state, 'available');
  assert.equal(sources.bach.count, 5);
  assert.match(sources.bach.note, /Daemon.*gestoppt/);
  assert.deepEqual([sources.ocean.state, sources.ocean.count], ['available', 1]);
  assert.deepEqual([sources.life.state, sources.life.count], ['available', 2]);
});

test('a deleted trigger (tombstone) is not listed as a routine', async () => {
  const {items} = await loadRoutines(routinesBackend());
  assert.equal(byId(items, 'ocean:old.trigger'), undefined);
});

test('the module source has no backend path yet and says so instead of pretending', async () => {
  const calls = [];
  const {sources} = await loadRoutines(routinesBackend({}, calls));
  assert.equal(sources.module.state, 'unavailable');
  assert.match(sources.module.reason, /kein Backend-Pfad/);
  assert.ok(!calls.some(c => /modul/i.test(c)));
});

test('an unreachable source names its reason, the other sources stay intact', async () => {
  const cases = [
    [{ocean: 404}, 'ocean', /nicht vorhanden/],
    [{ocean: 503}, 'ocean', /nicht verfügbar/],
    [{life: 401}, 'life', /Geräteanmeldung/],
    [{life: 'down'}, 'life', /Verbindung/],
  ];
  for (const [fault, key, reason] of cases) {
    const {items, sources} = await loadRoutines(routinesBackend(fault));
    assert.equal(sources[key].state, 'unavailable', JSON.stringify(fault));
    assert.match(sources[key].reason, reason);
    assert.equal(items.some(i => i.source === key), false);
    for (const other of ['bach', 'life', 'ocean'].filter(k => k !== key)) assert.equal(sources[other].state, 'available');
  }
});

test('BACH is partial when only one of its reads fails, unavailable when all fail', async () => {
  const partial = await loadRoutines(routinesBackend({recurring: 503}));
  assert.equal(partial.sources.bach.state, 'partial');
  assert.match(partial.sources.bach.reason, /Wiederkehrende Aufgaben.*nicht verfügbar/);
  assert.equal(partial.items.filter(i => i.source === 'bach').length, 3);
  const none = await loadRoutines(routinesBackend({bach: 503, recurring: 503}));
  assert.equal(none.sources.bach.state, 'unavailable');
});

test('a 200 without the confirmed contract is not an available source', async () => {
  const wrong = async () => ({ok: true, status: 200, json: async () => ({unexpected: true})});
  const {items, sources} = await loadRoutines(wrong);
  assert.deepEqual(items, []);
  for (const key of SOURCE_KEYS) assert.equal(sources[key].state, 'unavailable');
  assert.match(sources.life.reason, /Vertrag/);
});

test('a job that never ran or whose last run failed carries a warning; healthy and paused ones do not', async () => {
  const {items} = await loadRoutines(routinesBackend());
  assert.equal(attention(byId(items, 'bach-job:1')).code, 'never-run');
  assert.equal(attention(byId(items, 'bach-job:2')).code, 'failed');
  assert.equal(attention(byId(items, 'bach-job:3')), null);
  assert.equal(attention(byId(items, 'life:13')).code, 'overdue');
  assert.equal(attention(byId(items, 'bach-recurring:doc_review')), null);
  assert.equal(attention(byId(items, 'life:12')), null);
});

test('controls point at the backend routes that exist, and only where they exist', async () => {
  const {items} = await loadRoutines(routinesBackend());
  assert.deepEqual(byId(items, 'bach-job:1').controls.toggle, {method: 'PUT', url: '/api/daemon/jobs/1/toggle'});
  assert.deepEqual(byId(items, 'bach-job:1').controls.run, {method: 'POST', url: '/api/daemon/jobs/1/run'});
  assert.deepEqual(byId(items, 'bach-recurring:self_check').controls.run, {method: 'POST', url: '/api/recurring/trigger/self_check'});
  assert.equal(byId(items, 'bach-recurring:self_check').controls.toggle, null);
  assert.deepEqual(byId(items, 'life:13').controls.complete, {method: 'POST', url: '/api/routines/13/complete'});
  assert.equal(byId(items, 'life:12').controls.complete, null);
  assert.deepEqual(byId(items, 'ocean:team.weekly').controls, {toggle: null, run: null, complete: null});
});

test('runControl needs a successful answer and never reports success for a failed call', async () => {
  const calls = [];
  await runControl(routinesBackend({}, calls), {method: 'PUT', url: '/api/daemon/jobs/1/toggle'});
  assert.deepEqual(calls, ['PUT /api/daemon/jobs/1/toggle']);
  await assert.rejects(runControl(routinesBackend({bach: 503}), {method: 'POST', url: '/api/daemon/jobs/1/run'}), /503/);
  await assert.rejects(runControl(routinesBackend({life: 'down'}), {method: 'POST', url: '/api/routines/13/complete'}), /Verbindung/);
});

test('filters combine origin, type and a text query', async () => {
  const {items} = await loadRoutines(routinesBackend());
  assert.equal(filterRoutines(items, {source: 'bach'}).length, 5);
  assert.equal(filterRoutines(items, {source: 'life'}).length, 2);
  assert.equal(filterRoutines(items, {source: 'bach', kind: 'job'}).length, 3);
  assert.deepEqual(filterRoutines(items, {query: 'rauchmelder'}).map(i => i.id), ['life:13']);
  assert.equal(filterRoutines(items, {}).length, items.length);
});

test('times read the same in every row: local wall time without time zone shift', () => {
  assert.equal(formatWhen('2026-01-28 06:58:01'), '28.01.2026, 06:58');
  assert.equal(formatWhen('2026-11-14T09:00:00'), '14.11.2026, 09:00');
  assert.equal(formatWhen('2026-11-01'), '01.11.2026');
  assert.equal(formatWhen(null, 'nie'), 'nie');
  assert.equal(formatWhen('kein Datum'), 'kein Datum');
});

test('the page no longer hard-codes an unavailable source', () => {
  const page = readFileSync(new URL('../src/pages/routinen.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /available:\s*false/);
  assert.doesNotMatch(page, /routineSources/);
});

// Route contract: every read and every control the routines page can issue exists in the backend route snapshot
// (tests/fixtures/backend-routes.v1.json). Controls are built from data, so the page-reads scanner cannot see them.
test('every GET and every control of the routines page exists in the backend route snapshot', async () => {
  const routes = new Set(JSON.parse(readFileSync(new URL('./fixtures/backend-routes.v1.json', import.meta.url), 'utf8')).routes);
  const generic = (method, url) => `${method} ${url.replace(/\/\d+(?=\/|$)/g, '/{}').replace(/(?<=\/recurring\/trigger\/)[^/]+$/, '{}')}`;
  const calls = [];
  const {items} = await loadRoutines(routinesBackend({}, calls));
  const wanted = [...calls, ...items.flatMap(i => Object.values(i.controls).filter(Boolean).map(c => `${c.method} ${c.url}`))];
  const missing = [...new Set(wanted.map(c => generic(...c.split(' '))))].filter(c => !routes.has(c));
  // GET /api/agent-triggers: the trigger API is source-complete in BACH PR #640/#646 but not on main yet (route-contract.test.mjs lists it too).
  assert.deepEqual(missing, ['GET /api/agent-triggers']);
});
