import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseCatalog, catalogQuery, itemsOfType, gitLabel, sourceProblems, catalogFailure, loadCatalog,
  containsAbsolutePath, ITEM_TYPES} from '../src/lib/catalog-projection.mjs';

// tests/fixtures/catalog-projection.v1.json is the byte-identical copy of BACH
// system/tests/fixtures/catalog_projection_v1.json, written by the Python handler test (observe() over synthetic
// sources, BACH_WRITE_CATALOG_FIXTURE, LF). It is a handler response, not hand-written.
const raw = readFileSync(new URL('./fixtures/catalog-projection.v1.json', import.meta.url));
const fixture = () => JSON.parse(raw.toString('utf8'));
const PINNED_SHA256 = 'b1e9aef1cabfa675e368442ef2a51dc2a5d917d64b8ef880da1547f6999fefc9';
const broken = mutate => { const body = fixture(); mutate(body); return () => parseCatalog(body); };
const item = (body, id) => body.items.find(i => i.id === id);

test('the fixture is the pinned handler output', () => {
  assert.equal(createHash('sha256').update(raw).digest('hex'), PINNED_SHA256);
});

test('a real handler response parses; counts come from the items and include stacks', () => {
  const catalog = parseCatalog(fixture());
  assert.equal(catalog.items.length, 11);
  assert.deepEqual(catalog.counts, {module: 2, bundle: 3, stack: 2, skill: 2, satellite: 2});
  for (const type of ITEM_TYPES) assert.equal(itemsOfType(catalog, type).length, catalog.counts[type]);
  assert.deepEqual(itemsOfType(catalog, 'stack').map(s => s.id), ['systems/homebase-stack', 'stacks/homebase-stack']);
  assert.equal(catalog.host.source, 'declared');
  assert.ok(catalog.redactions >= 3);
});

test('git stays unknown without a host record and host values come from file content', () => {
  const catalog = parseCatalog(fixture());
  const unknown = catalog.items.find(i => i.id === 'example-org/sat-unknown');
  assert.equal(unknown.git.state, 'unknown');
  assert.equal(gitLabel(unknown.git), 'Git unbekannt');
  const known = catalog.items.find(i => i.id === 'example-org/sat-known');
  assert.equal(gitLabel(known.git), 'Änderungen offen (TEST-HOST)');
  assert.equal(known.git.observedAt, null);
  assert.equal(known.git.observedAtBasis, 'absent');
  const module = catalog.items.find(i => i.id === 'alpha-core');
  assert.equal(module.git.state, 'unknown');
  assert.deepEqual(module.gitHosts.map(g => [g.host, g.state, g.observedAt]), [['MANIFEST-HOST', 'clean', '2026-10-10T07:00:00+00:00']]);
});

test('times: a value without time zone is null with its raw text, never UTC', () => {
  const catalog = parseCatalog(fixture());
  const satellite = catalog.sources.find(s => s.id === 'satellite_catalog');
  assert.equal(satellite.generatedAt, null);
  assert.equal(satellite.generatedAtBasis, 'no_timezone');
  assert.equal(satellite.generatedAtRaw, '2026-10-10T08:00:00');
  assert.throws(broken(b => { b.sources.find(s => s.id === 'satellite_catalog').generated_at = '2026-10-10T08:00:00'; }), /Zeitzone|UTC/);
  assert.throws(broken(b => { item(b, 'example-org/sat-known').git.last_commit = '2026-10-01T00:00:00'; }), /UTC-\/Offset-Zeit/);
  assert.throws(broken(b => { b.generated_at = '2026-10-10T08:00:00'; }), /generated_at/);
  assert.throws(broken(b => { b.sources[0].generated_at_basis = 'no_timezone'; b.sources[0].generated_at = '2026-10-10T08:00:00+00:00'; b.sources[0].generated_at_raw = 'x'; }), /Zeitzone/);
});

test('every fixture value that is naive stays out of UTC-typed fields', () => {
  const body = fixture();
  const naive = /^\d{4}-\d{2}-\d{2}T[\d:.]+$/;
  const walk = (node, path) => {
    if (typeof node === 'string' && naive.test(node)) assert.ok(/_raw$/.test(path), 'naive time outside a *_raw field: ' + path);
    else if (Array.isArray(node)) node.forEach((x, i) => walk(x, path + '[' + i + ']'));
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, k);
  };
  walk(body, '');
});

test('architecture relations are declared and measurement is unverified', () => {
  const catalog = parseCatalog(fixture());
  const module = catalog.items.find(i => i.id === 'alpha-core');
  assert.ok(module.relations.every(r => r.basis === 'declared'));
  assert.equal(module.measured.installed, null);
  assert.equal(module.measured.connectionState, 'unverified');
  const bundle = catalog.items.find(i => i.id === 'bundle-one');
  assert.deepEqual(bundle.relations.map(r => r.requirement), ['required', 'optional', null]);
  const stack = catalog.items.find(i => i.id === 'stacks/homebase-stack');
  assert.deepEqual(stack.relations.map(r => r.targetType), ['bundle', 'module', 'skill-library', 'stack']);
});

test('unavailable sources and server errors are visible', () => {
  const body = fixture();
  body.sources[0].availability = 'missing';
  body.sources[0].error = 'file_missing';
  const catalog = parseCatalog(body);
  assert.equal(sourceProblems(catalog).length, 1);
  assert.ok(catalog.errors.some(e => e.reason === 'unsafe_id' && e.item === '../escape'));
});

test('every required top-level key is mandatory', () => {
  for (const key of ['schema', 'generated_at', 'host', 'sources', 'items', 'counts', 'count', 'errors', 'truncated', 'redactions'])
    assert.throws(broken(b => { delete b[key]; }), /Katalogvertrag/, key);
  assert.throws(broken(b => { delete b.host.id; }), /host/);
  assert.throws(broken(b => { b.schema = 'bach.catalog.v0'; }), /schema/);
});

test('every required key of sources, items, pin, measured, git and relations is mandatory (no null/"unverified" defaults)', () => {
  const sourceKeys = ['id', 'kind', 'path_label', 'host', 'schema', 'source_version', 'generated_at', 'generated_at_basis', 'generated_at_raw', 'modified_at', 'availability', 'error'];
  for (const key of sourceKeys) assert.throws(broken(b => { delete b.sources[0][key]; }), /Pflichtschlüssel|Quelle/, 'source.' + key);
  const itemKeys = ['id', 'type', 'aliases', 'name', 'description', 'version', 'category', 'status', 'visibility', 'repository', 'pin', 'provides', 'requires', 'optional', 'relations', 'measured', 'git', 'git_hosts', 'source_ids'];
  for (const key of itemKeys) assert.throws(broken(b => { delete b.items[0][key]; }), /Pflichtschlüssel|Eintrag/, 'item.' + key);
  for (const key of ['commit', 'content_hash', 'source_version', 'verified']) assert.throws(broken(b => { delete b.items[0].pin[key]; }), /pin/, 'pin.' + key);
  for (const key of ['installed', 'runtime_active', 'connection_state', 'observed_at', 'host', 'evidence'])
    assert.throws(broken(b => { delete b.items[0].measured[key]; }), /measured/, 'measured.' + key);
  for (const key of ['state', 'branch', 'last_commit', 'last_commit_raw', 'observed_at', 'observed_at_basis', 'observed_at_raw', 'host', 'source'])
    assert.throws(broken(b => { delete b.items[0].git[key]; }), /git/, 'git.' + key);
  for (const key of ['kind', 'target', 'target_type', 'requirement', 'basis'])
    assert.throws(broken(b => { delete item(b, 'bundle-one').relations[0][key]; }), /Relation/, 'relation.' + key);
  for (const key of ['source', 'reason', 'item']) assert.throws(broken(b => { delete b.errors[0][key]; }), /Fehlereintrag/, 'error.' + key);
  assert.throws(broken(b => { delete item(b, 'alpha-core').git_hosts[0].host; }), /git/);
});

test('counts must list every present type and match the items', () => {
  assert.throws(broken(b => { delete b.counts.stack; }), /counts\.stack fehlt/);
  assert.throws(broken(b => { b.counts.module = 99; }), /counts\.module/);
  assert.throws(broken(b => { b.counts.plugin = 0; }), /counts\.plugin/);
  assert.throws(broken(b => { b.count = 1; }), /count stimmt/);
  assert.throws(broken(b => { b.items.push(structuredClone(b.items[0])); b.count += 1; b.counts[b.items[0].type] += 1; }), /doppelte id/);
  assert.throws(broken(b => { b.items[0].source_ids = ['ghost']; }), /unbekannte Quelle/);
  assert.throws(broken(b => { b.sources[0].availability = 'ok'; }), /availability/);
  assert.throws(broken(b => { b.items[0].git.state = 'maybe'; }), /git\.state/);
  assert.throws(broken(b => { item(b, 'bundle-one').relations[0].basis = 'measured'; }), /Relation/);
  assert.throws(broken(b => { b.items[0].type = 'plugin'; }), /Eintrag/);
});

test('absolute paths are detected anywhere in a string, including embedded ones', () => {
  const leaks = [String.raw`C:\Users\someone\repo`, '/Users/someone/repo', String.raw`\\server\share`, '/root/x', '/usr/local/bin',
    'text before /root/x and after', String.raw`see C:\Temp\x in text`, 'at ~/notes/y here', 'D:/x/y', '(/home/u/f)', 'p=/opt/app/z',
    String.raw`%USERPROFILE%\x\y`, 'two segments /srv/data/x'];
  for (const leaked of leaks) {
    assert.ok(containsAbsolutePath(leaked), leaked);
    const body = fixture();
    body.items[0].description = leaked;
    assert.throws(() => parseCatalog(body), /absoluter Pfad/, leaked);
    const nested = fixture();
    nested.errors.push({source: 'x', reason: 'y', item: leaked});
    assert.throws(() => parseCatalog(nested), /absoluter Pfad/, 'errors.item ' + leaked);
  }
  for (const fine of ['https://github.com/o/r', 'and/or', '/api/capabilities/catalog', 'CI/CD pipeline', 'a-b/c', '<pfad>', 'relative/dir/file.json'])
    assert.equal(containsAbsolutePath(fine), false, fine);
});

test('query building mirrors the route parameters', () => {
  assert.equal(catalogQuery({kind: 'stack', host: ' H '}).toString(), 'kind=stack&host=H');
  assert.equal(catalogQuery({}).toString(), '');
  assert.throws(() => catalogQuery({kind: 'plugin'}), /kind/);
  assert.throws(() => catalogQuery({host: 'x'.repeat(81)}), /host/);
});

test('the host parameter does not filter: the same items carry different git views', () => {
  // semantics documented in the contract (catalog_projection.py): host selects the git record only.
  const catalog = parseCatalog(fixture());
  assert.equal(catalogQuery({host: 'OTHER'}).has('kind'), false);
  assert.equal(catalog.items.length, catalog.counts.module + catalog.counts.bundle + catalog.counts.stack + catalog.counts.skill + catalog.counts.satellite);
});

test('loadCatalog separates network, auth, route and contract failures (no mock fallback)', async () => {
  const respond = (status, body) => async () => ({ok: status >= 200 && status < 300, status, json: async () => body});
  await assert.rejects(loadCatalog({}, async () => { throw new TypeError('offline'); }), e => e.failure.state === 'network');
  await assert.rejects(loadCatalog({}, respond(401, {error: 'Geräteanmeldung erforderlich'})), e => e.failure.state === 'auth');
  await assert.rejects(loadCatalog({}, respond(404, {})), e => e.failure.state === 'route');
  await assert.rejects(loadCatalog({kind: 'skill'}, respond(422, {detail: 'x'})), e => e.failure.state === 'query');
  await assert.rejects(loadCatalog({}, respond(200, {schema: 'other'})), /Katalogvertrag/);
  await assert.rejects(loadCatalog({}, respond(200, null)), /Katalogvertrag/);
  let requested;
  const ok = await loadCatalog({kind: 'stack'}, async url => { requested = url; return {ok: true, status: 200, json: async () => fixture()}; });
  assert.equal(requested, '/api/capabilities/catalog?kind=stack');
  assert.equal(ok.items.length, 11);
  assert.equal(catalogFailure(500, null).state, 'error');
});
