import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCatalog, containsAbsolutePath} from '../src/lib/catalog-projection.mjs';
import {VIEWS, viewFromSearch, STATUS_LABEL, statusClass, isPublic, safeRepoUrl, moduleOrg, capabilityLinks, schaltplanModel,
  gesamtModel, satelliteModel, satelliteRows} from '../src/lib/ocean-system.mjs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const body = () => JSON.parse(read('./fixtures/catalog-projection.v1.json'));
const catalog = (mutate = () => {}) => { const b = body(); mutate(b); return parseCatalog(b); };

test('the architecture comes from the projection: declared, bilingual, path-free', () => {
  const arch = catalog().architecture;
  assert.equal(arch.basis, 'declared');
  assert.equal(arch.available, true);
  assert.equal(arch.sourceId, 'schaltplan_authored');
  assert.deepEqual(arch.areas.map(a => a.id), ['runtime', 'tools', 'memory']);
  assert.equal(arch.edges.length, 2);
  assert.equal(containsAbsolutePath(JSON.stringify(arch)), false);
  const source = catalog().sources.find(x => x.id === 'schaltplan_authored');
  assert.equal(source.availability, 'available');
  assert.match(source.sourceVersion, /^[a-f0-9]{64}$/); // pin of the curated file
});

test('a malformed architecture is a contract error, never silently reinterpreted', () => {
  const broken = mutate => () => { const b = body(); mutate(b); parseCatalog(b); };
  assert.throws(broken(b => { b.architecture.basis = 'measured'; }), /declared/);
  assert.throws(broken(b => { b.architecture.edges[0].to = 'nope'; }), /unbekannten Bereich/);
  assert.throws(broken(b => { b.architecture.areas[1].id = b.architecture.areas[0].id; }), /Bereich/);
  assert.throws(broken(b => { b.architecture = null; }), /architecture/);   // present but not an object
  assert.throws(broken(b => { delete b.architecture.areas; }), /Pflichtschlüssel areas/);
  assert.throws(broken(b => { b.architecture.available = false; }), /nicht verfügbar, aber mit Inhalt/);
  assert.throws(broken(b => { b.architecture.areas[0].desc = {de: 'x'}; }), /Bereich\.desc/);
});

test('an unavailable architecture leaves every module unassigned and wires nothing', () => {
  const none = catalog(b => { b.architecture = {basis: 'declared', source_id: 'schaltplan_authored', available: false, areas: [], edges: [], layers: [], icons: {}, ui: {}, edges_note: null}; });
  const model = schaltplanModel(none);
  assert.equal(model.zones.length, 0);
  assert.equal(model.edges.length, 0);
  assert.equal(model.architecture.available, false);
  assert.deepEqual(model.unassigned.modules.map(m => m.id).sort(), ['alpha-core', 'beta-tool']);
  assert.equal(model.total, 2);
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
  const model = schaltplanModel(catalog());
  assert.equal(model.zones.length, 3);
  assert.deepEqual(model.zones.find(z => z.id === 'runtime').modules.map(m => m.id), ['alpha-core']);
  assert.deepEqual(model.zones.find(z => z.id === 'tools').modules.map(m => m.id), ['beta-tool']);
  assert.equal(model.total, 2);
  assert.equal(model.hits, 2);
  assert.equal(model.unassigned, null);
  assert.ok(model.emptyZones.includes('memory'));
  assert.equal(model.edges.length, 2);
});

test('Schaltplan: filters change the hit count, never the total; unknown categories stay visible', () => {
  const c = catalog();
  const searched = schaltplanModel(c, {query: 'alpha'});
  assert.equal(searched.total, 2);
  assert.equal(searched.hits, 1);
  assert.equal(searched.zones.find(z => z.id === 'tools').modules[0].hit, false);
  assert.equal(schaltplanModel(c, {publicOnly: true}).hits, 1);
  const odd = catalog(b => { b.items.find(i => i.id === 'beta-tool').category = 'erfunden'; });
  const model = schaltplanModel(odd);
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
  const all = gesamtModel(c);
  assert.equal(all.total, 4); // 2 modules + 2 satellites from counts
  assert.equal(all.hits, 4);
  assert.match(all.tierNote, /keine Repo-Tiers/);
  const byOrg = gesamtModel(c, {org: 'example-org'});
  assert.equal(byOrg.total, 4);
  assert.equal(byOrg.hits, 4);
  const none = gesamtModel(c, {org: 'nobody'});
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
  assert.equal(rows.find(r => r.id === 'example-org/sat-unknown').git.known, false);
  assert.match(rows.find(r => r.id === 'example-org/sat-unknown').git.text, /unbekannt \(kein Hostbeleg\)/);
  const known = rows.find(r => r.id === 'example-org/sat-known').git;
  assert.match(known.text, /Host TEST-HOST, Quelle .*Änderungen offen · beobachtet unbekannt \(undatiert\)/);
  assert.equal(known.dated, false);
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

test('module cards carry the host git snapshot as its own record (source, host, observation time)', () => {
  const dated = catalog(b => {
    const git = b.items.find(i => i.id === 'alpha-core').git;
    Object.assign(git, {state: 'clean', host: 'TEST-HOST', source: 'repos_manifest:slot-a', observed_at: '2026-01-02T03:04:05Z', observed_at_basis: 'declared'});
  });
  const card = schaltplanModel(dated).zones.find(z => z.id === 'runtime').modules[0];
  assert.equal(card.git.dated, true);
  assert.match(card.git.text, /Host TEST-HOST, Quelle repos_manifest:slot-a\): Clean · beobachtet 2026-01-02T03:04:05Z/);
  const undated = schaltplanModel(catalog(b => Object.assign(b.items.find(i => i.id === 'alpha-core').git, {state: 'clean', host: 'H'}))).zones.find(z => z.id === 'runtime').modules[0];
  assert.match(undated.git.text, /unbekannt \(undatiert\)/);
  assert.equal(undated.git.dated, false);
});

test('empty catalogs render honest zeros', () => {
  const empty = catalog(b => { b.items = []; b.counts = {}; b.count = 0; b.errors = []; });
  assert.equal(satelliteModel(empty).total, 0);
  assert.equal(gesamtModel(empty).total, 0);
  assert.equal(schaltplanModel(empty).total, 0);
});

test('UI sources never use innerHTML or inline handlers', () => {
  for (const file of ['../src/lib/ocean-system-ui.mjs', '../src/components/OceanSystem.astro', '../src/pages/system/ocean.astro']) {
    assert.doesNotMatch(read(file), /innerHTML|outerHTML|insertAdjacentHTML|set:html|<iframe|document\.write|\son[a-z]+\s*=/, file);
  }
});

test('a response WITHOUT architecture (adapter without #310) still renders the whole catalog', () => {
  const c = catalog(b => { delete b.architecture; });
  assert.equal(c.items.length, 11);
  assert.equal(c.architecture.available, false);
  assert.equal(c.architecture.adapterSupport, false);
  assert.equal(Object.isFrozen(c.architecture), true);
  const model = schaltplanModel(c);
  assert.equal(model.architecture.adapterSupport, false);
  assert.deepEqual(model.unassigned.modules.map(m => m.id).sort(), ['alpha-core', 'beta-tool']);
  assert.equal(gesamtModel(c).total, 4);
  assert.equal(satelliteModel(c).total, 2);
  assert.equal(catalog().architecture.adapterSupport, true);
});

test('Gesamtschaltplan shows provided capabilities with their consumers, not only a count', () => {
  const wired = catalog(b => { b.items.find(i => i.id === 'beta-tool').requires = ['alpha.store']; });
  const model = gesamtModel(wired);
  const alpha = model.provisions.find(p => p.module === 'Alpha Core');
  assert.deepEqual(alpha.capabilities, [{capability: 'alpha.store', consumers: ['beta-tool']}]);
  const lonely = gesamtModel(catalog()).provisions.find(p => p.module === 'Alpha Core');
  assert.deepEqual(lonely.capabilities, [{capability: 'alpha.store', consumers: []}]);
  assert.deepEqual(gesamtModel(catalog()).provisions.map(p => p.module), ['Alpha Core']); // modules without provides are not listed
});

test('the catalog status is labelled as declared and never reads as a runtime state', () => {
  for (const label of Object.values(STATUS_LABEL)) assert.match(label, /Katalogstatus/);
  assert.match(STATUS_LABEL.ok, /deklariert/);
  assert.doesNotMatch(Object.values(STATUS_LABEL).join(' '), /im Einsatz|läuft/);
  const card = schaltplanModel(catalog()).zones.find(z => z.id === 'runtime').modules[0];
  assert.equal(card.status, 'ok');
  assert.equal(card.measured.measured, false);          // "active" in the catalog without measured values
  assert.equal(card.measured.kind, 'unmeasured');
  const measured = catalog(b => Object.assign(b.items.find(i => i.id === 'alpha-core').measured, {installed: true, runtime_active: true, connection_state: 'connected', observed_at: '2026-01-01T00:00:00Z', evidence: 'probe'}));
  assert.equal(schaltplanModel(measured).zones.find(z => z.id === 'runtime').modules[0].measured.kind, 'measured');
});

test('filtered-out modules keep their text colour (no opacity on text) and the status marks are not green', () => {
  const css = readFileSync(new URL('../src/components/OceanSystem.astro', import.meta.url), 'utf8');
  const dim = /\.os-mod\.dim\)\s*\{([^}]*)\}/.exec(css)[1];
  assert.doesNotMatch(dim, /opacity/);
  assert.doesNotMatch(css, /var\(--success\)|var\(--warning\)/);
});
