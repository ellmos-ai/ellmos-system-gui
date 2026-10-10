import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCatalog, containsAbsolutePath} from '../src/lib/catalog-projection.mjs';
import {VIEWS, viewFromSearch, parseAuthored, statusClass, isPublic, safeRepoUrl, moduleOrg, capabilityLinks, schaltplanModel,
  gesamtModel, satelliteModel, satelliteRows} from '../src/lib/ocean-system.mjs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const body = () => JSON.parse(read('./fixtures/catalog-projection.v1.json'));
const catalog = (mutate = () => {}) => { const b = body(); mutate(b); return parseCatalog(b); };
const authoredRaw = () => JSON.parse(read('../src/data/schaltplan-authored.json'));
const authored = () => parseAuthored(authoredRaw());

test('the authored data is declared, bilingual, path-free and references only known areas', () => {
  const data = authored();
  assert.equal(data._meta.basis, 'declared');
  assert.equal(data.areas.length, 11);
  assert.equal(data.edges.length, 8);
  assert.equal(containsAbsolutePath(read('../src/data/schaltplan-authored.json')), false);
  assert.match(data._meta.source_sha256, /^[a-f0-9]{64}$/);
});

test('invalid authored data fails loudly', () => {
  const broken = mutate => () => { const d = authoredRaw(); mutate(d); parseAuthored(d); };
  assert.throws(broken(d => { d._meta.basis = 'measured'; }), /declared/);
  assert.throws(broken(d => { d.edges[0].to = 'nope'; }), /unbekannten Bereich/);
  assert.throws(broken(d => { d.areas[1].id = d.areas[0].id; }), /Bereich/);
});

test('the view comes from ?view= and falls back to the Schaltplan', () => {
  assert.deepEqual(VIEWS.map(v => v.id), ['schaltplan', 'gesamtschaltplan', 'satelliten']);
  assert.equal(viewFromSearch('?tab=ocean&view=satelliten'), 'satelliten');
  assert.equal(viewFromSearch('?tab=ocean&view=zzz'), 'schaltplan');
  assert.equal(viewFromSearch(''), 'schaltplan');
});

test('status never rounds unknown up to "ok"; visibility is exact', () => {
  assert.equal(statusClass('active'), 'ok');
  assert.equal(statusClass('development'), 'dev');
  assert.equal(statusClass('planned'), 'plan');
  assert.equal(statusClass(null), 'unknown');
  const c = catalog();
  assert.equal(isPublic(c.items.find(i => i.id === 'alpha-core')), true);
  assert.equal(isPublic(c.items.find(i => i.id === 'beta-tool')), false);
  assert.equal(isPublic(c.items.find(i => i.id === 'example-org/sat-known')), false); // null visibility
});

test('repository links only for public items over https; org only from declared data', () => {
  const c = catalog();
  assert.equal(safeRepoUrl(c.items.find(i => i.id === 'alpha-core')), 'https://github.com/example-org/alpha-core');
  assert.equal(safeRepoUrl(c.items.find(i => i.id === 'beta-tool')), null);
  assert.equal(safeRepoUrl({repository: 'javascript:alert(1)', visibility: 'public'}), null);
  assert.equal(moduleOrg(c.items.find(i => i.id === 'alpha-core')), 'example-org');
  assert.equal(moduleOrg({org: null, repository: null}), null);
});

test('satellite org, provenance and upstream come through the contract (null when absent)', () => {
  const c = catalog();
  const known = c.items.find(i => i.id === 'example-org/sat-known');
  assert.deepEqual([known.org, known.provenance, known.upstream], ['example-org', 'EIGENENTWICKLUNG', 'example-org/sat-known']);
  const unknown = c.items.find(i => i.id === 'example-org/sat-unknown');
  assert.deepEqual([unknown.org, unknown.provenance, unknown.upstream], ['example-org', null, null]);
  assert.equal(c.items.find(i => i.id === 'alpha-core').org, null);
});

test('Schaltplan: zones follow the authored areas, modules come from the catalog, counts from counts', () => {
  const model = schaltplanModel(catalog(), authored());
  assert.equal(model.zones.length, 11);
  assert.deepEqual(model.zones.find(z => z.id === 'runtime').modules.map(m => m.id), ['alpha-core']);
  assert.deepEqual(model.zones.find(z => z.id === 'tools').modules.map(m => m.id), ['beta-tool']);
  assert.equal(model.total, 2);
  assert.equal(model.hits, 2);
  assert.equal(model.unassigned, null);
  assert.ok(model.emptyZones.includes('memory'));
  assert.equal(model.edges.length, 8);
});

test('Schaltplan: filters change the hit count, never the total; unknown categories stay visible', () => {
  const c = catalog();
  const searched = schaltplanModel(c, authored(), {query: 'alpha'});
  assert.equal(searched.total, 2);
  assert.equal(searched.hits, 1);
  assert.equal(searched.zones.find(z => z.id === 'tools').modules[0].hit, false);
  assert.equal(schaltplanModel(c, authored(), {publicOnly: true}).hits, 1);
  const odd = catalog(b => { b.items.find(i => i.id === 'beta-tool').category = 'erfunden'; });
  const model = schaltplanModel(odd, authored());
  assert.deepEqual(model.unassigned.modules.map(m => m.id), ['beta-tool']);
});

test('capability links are declared: providers/consumers resolved, missing providers visible', () => {
  const c = catalog();
  const alpha = c.items.find(i => i.id === 'alpha-core');
  const links = capabilityLinks(c, alpha);
  assert.deepEqual(links.requires.map(r => [r.capability, r.requirement, r.providers]), [['beta.api', 'required', []], ['gamma.hint', 'optional', []]]);
  assert.deepEqual(links.provides, [{capability: 'alpha.store', consumers: []}]);
  const wired = catalog(b => { b.items.find(i => i.id === 'beta-tool').provides = ['beta.api']; });
  const beta = wired.items.find(i => i.id === 'beta-tool');
  assert.deepEqual(capabilityLinks(wired, wired.items.find(i => i.id === 'alpha-core')).requires[0].providers, ['beta-tool']);
  assert.deepEqual(capabilityLinks(wired, beta).provides[0].consumers, ['Alpha Core']);
});

test('Gesamtschaltplan: total is fixed while filtering; no tier is invented', () => {
  const c = catalog();
  const all = gesamtModel(c, authored());
  assert.equal(all.total, 4); // 2 modules + 2 satellites from counts
  assert.equal(all.hits, 4);
  assert.match(all.tierNote, /keine Repo-Tiers/);
  const byOrg = gesamtModel(c, authored(), {org: 'example-org'});
  assert.equal(byOrg.total, 4);
  assert.equal(byOrg.hits, 4);
  const none = gesamtModel(c, authored(), {org: 'nobody'});
  assert.equal(none.total, 4);
  assert.equal(none.hits, 0);
  assert.deepEqual(all.orgs, [['example-org', 4]]);
  assert.equal(all.wiring.length, 1);
  assert.equal(all.wiring[0].links.length, 2);
  assert.ok(all.other.some(e => e.id === 'example-org/sat-known')); // category not an authored area
});

test('Satelliten: git unknown is visible and counted, KPI stays, hits are separate', () => {
  const c = catalog();
  const rows = satelliteRows(c);
  assert.equal(rows.find(r => r.id === 'example-org/sat-unknown').git, 'Git unbekannt');
  assert.match(rows.find(r => r.id === 'example-org/sat-known').git, /Änderungen offen \(TEST-HOST\)/);
  const model = satelliteModel(c);
  assert.equal(model.total, c.counts.satellite);
  assert.deepEqual(model.gitStates, [['dirty', 1], ['unknown', 1]]);
  const filtered = satelliteModel(c, {gitState: 'unknown'});
  assert.equal(filtered.total, 2);
  assert.equal(filtered.hits, 1);
  assert.equal(satelliteModel(c, {domain: 'x'}).hits, 1);
  assert.equal(satelliteModel(c, {query: 'zzz'}).hits, 0);
  assert.deepEqual(satelliteModel(c, {org: 'example-org'}).orgs, [['example-org', 2]]);
});

test('empty catalogs render honest zeros', () => {
  const empty = catalog(b => { b.items = []; b.counts = {}; b.count = 0; b.errors = []; });
  assert.equal(satelliteModel(empty).total, 0);
  assert.equal(gesamtModel(empty, authored()).total, 0);
  assert.equal(schaltplanModel(empty, authored()).total, 0);
});

test('UI sources never use innerHTML or inline handlers', () => {
  for (const file of ['../src/lib/ocean-system-ui.mjs', '../src/components/OceanSystem.astro', '../src/pages/system/ocean.astro']) {
    assert.doesNotMatch(read(file), /innerHTML|outerHTML|insertAdjacentHTML|set:html|<iframe|document\.write|\son[a-z]+\s*=/, file);
  }
});
