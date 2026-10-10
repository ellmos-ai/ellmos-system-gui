import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseCatalog, catalogQuery, itemsOfType, gitLabel, sourceProblems, catalogFailure, loadCatalog} from '../src/lib/catalog-projection.mjs';

// tests/fixtures/catalog-projection.v1.json is the byte-identical copy of BACH
// system/tests/fixtures/catalog_projection_v1.json (c71e4605 + catalog-adapter-2016), written by the Python handler
// test (observe() over synthetic sources, BACH_WRITE_CATALOG_FIXTURE). It is a handler response, not hand-written.
const raw = readFileSync(new URL('./fixtures/catalog-projection.v1.json', import.meta.url));
const fixture = () => JSON.parse(raw.toString('utf8'));

test('the fixture is the pinned handler output', () => {
  assert.equal(createHash('sha256').update(raw).digest('hex'), '64293a1dabbe33e508b194dabae4bb9aa314864f1e2cc8ac65aba2808408351b');
});

test('a real handler response parses and counts come from the items', () => {
  const catalog = parseCatalog(fixture());
  assert.equal(catalog.items.length, 8);
  assert.deepEqual(catalog.counts, {bundle: 2, module: 2, satellite: 2, skill: 2});
  for (const type of Object.keys(catalog.counts)) assert.equal(itemsOfType(catalog, type).length, catalog.counts[type]);
  assert.equal(catalog.host.source, 'declared');
});

test('git stays unknown without a host record and host values come from file content', () => {
  const catalog = parseCatalog(fixture());
  const unknown = catalog.items.find(i => i.id === 'example-org/sat-unknown');
  assert.equal(unknown.git.state, 'unknown');
  assert.equal(gitLabel(unknown.git), 'Git unbekannt');
  const known = catalog.items.find(i => i.id === 'example-org/sat-known');
  assert.equal(gitLabel(known.git), 'Änderungen offen (TEST-HOST)');
  const module = catalog.items.find(i => i.id === 'alpha-core');
  assert.equal(module.git.state, 'unknown');
  assert.deepEqual(module.gitHosts.map(g => [g.host, g.state]), [['MANIFEST-HOST', 'clean']]);
});

test('architecture relations are declared and measurement is unverified', () => {
  const catalog = parseCatalog(fixture());
  const module = catalog.items.find(i => i.id === 'alpha-core');
  assert.ok(module.relations.every(r => r.basis === 'declared'));
  assert.equal(module.measured.installed, null);
  assert.equal(module.measured.connectionState, 'unverified');
  const bundle = catalog.items.find(i => i.id === 'bundle-one');
  assert.deepEqual(bundle.relations.map(r => r.requirement), ['required', 'optional', null]);
});

test('unavailable sources are visible as problems', () => {
  const body = fixture();
  body.sources[0].availability = 'missing';
  body.sources[0].error = 'file_missing';
  const problems = sourceProblems(parseCatalog(body));
  assert.equal(problems.length, 1);
  assert.equal(problems[0].error, 'file_missing');
  assert.ok(parseCatalog(fixture()).errors.some(e => e.reason === 'manifest_FileNotFoundError'));
});

test('contract violations are errors instead of defaults', () => {
  const broken = mutate => { const body = fixture(); mutate(body); return () => parseCatalog(body); };
  assert.throws(broken(b => { b.schema = 'bach.catalog.v0'; }), /schema/);
  assert.throws(broken(b => { delete b.generated_at; }), /generated_at/);
  assert.throws(broken(b => { delete b.items[0].pin; }), /pin/);
  assert.throws(broken(b => { delete b.items[0].measured; }), /measured/);
  assert.throws(broken(b => { b.items[0].git.state = 'maybe'; }), /git\.state/);
  assert.throws(broken(b => { b.items[0].relations = [{kind: 'requires', target: 'x', basis: 'measured'}]; }), /Relation/);
  assert.throws(broken(b => { b.counts.module = 99; }), /counts\.module/);
  assert.throws(broken(b => { b.count = 1; }), /count stimmt/);
  assert.throws(broken(b => { b.items.push(structuredClone(b.items[0])); b.count += 1; b.counts[b.items[0].type] += 1; }), /doppelte id/);
  assert.throws(broken(b => { b.items[0].source_ids = ['ghost']; }), /unbekannte Quelle/);
  assert.throws(broken(b => { b.sources[0].availability = 'ok'; }), /availability/);
  assert.throws(broken(b => { delete b.truncated; }), /Pflichtfelder/);
});

test('an absolute path anywhere in the response is a contract violation', () => {
  for (const leaked of [String.raw`C:\Users\someone\repo`, '/Users/someone/repo', String.raw`\\server\share`]) {
    const body = fixture();
    body.items[0].description = leaked;
    assert.throws(() => parseCatalog(body), /absoluter Pfad/, leaked);
  }
});

test('query building mirrors the route parameters', () => {
  assert.equal(catalogQuery({kind: 'skill', host: ' H '}).toString(), 'kind=skill&host=H');
  assert.equal(catalogQuery({}).toString(), '');
  assert.throws(() => catalogQuery({kind: 'plugin'}), /kind/);
  assert.throws(() => catalogQuery({host: 'x'.repeat(81)}), /host/);
});

test('loadCatalog separates network, auth, route and contract failures (no mock fallback)', async () => {
  const respond = (status, body) => async () => ({ok: status >= 200 && status < 300, status, json: async () => body});
  await assert.rejects(loadCatalog({}, async () => { throw new TypeError('offline'); }), e => e.failure.state === 'network');
  await assert.rejects(loadCatalog({}, respond(401, {error: 'Geräteanmeldung erforderlich'})), e => e.failure.state === 'auth');
  await assert.rejects(loadCatalog({}, respond(404, {})), e => e.failure.state === 'route');
  await assert.rejects(loadCatalog({kind: 'skill'}, respond(422, {detail: 'x'})), e => e.failure.state === 'query');
  await assert.rejects(loadCatalog({}, respond(200, {schema: 'other'})), /Katalogvertrag/);
  let requested;
  const ok = await loadCatalog({kind: 'bundle'}, async url => { requested = url; return {ok: true, status: 200, json: async () => fixture()}; });
  assert.equal(requested, '/api/capabilities/catalog?kind=bundle');
  assert.equal(ok.items.length, 8);
  assert.equal(catalogFailure(500, null).state, 'error');
});
