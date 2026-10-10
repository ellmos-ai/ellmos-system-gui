import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCatalog} from '../src/lib/catalog-projection.mjs';
import {bundleCards, stackCards, skillRows, filterRows, countsLine, sourceRows, catalogNotes, resolveTarget, libraryCandidate,
  resolveLibraryIds, measuredSummary, gitSnapshot} from '../src/lib/catalog-views.mjs';

// Same byte-identical handler response the catalog-projection tests pin (SHA there); views are derived from it only.
const raw = () => JSON.parse(readFileSync(new URL('./fixtures/catalog-projection.v1.json', import.meta.url), 'utf8'));
const catalog = (mutate = () => {}) => { const body = raw(); mutate(body); return parseCatalog(body); };
const card = (cards, id) => cards.find(c => c.id === id);
const group = (c, requirement) => c.declared.groups.find(g => g.requirement === requirement);

test('bundle cards group declared members by requirement; unmarked members stay visibly unmarked', () => {
  const one = card(bundleCards(catalog()), 'bundle-one');
  assert.deepEqual(one.declared.groups.map(g => g.label), ['Erforderlich', 'Optional', 'Anforderung nicht deklariert']);
  assert.deepEqual(group(one, 'required').entries.map(e => e.name), ['Alpha Core']);
  assert.deepEqual(group(one, 'optional').entries.map(e => e.name), ['note']);
  assert.deepEqual(group(one, null).entries.map(e => e.name), ['beta-tool']);
  assert.equal(one.declared.total, 3);
  assert.ok(group(one, 'required').entries[0].resolved);
  assert.equal(group(one, 'required').entries[0].version, '1.0.0');
});

test('a bundle whose manifest is missing is shown with its error and no invented members', () => {
  const lost = card(bundleCards(catalog()), 'bundle-lost');
  assert.equal(lost.declared.empty, true);
  assert.equal(lost.version, null);
  assert.ok(lost.problems.some(p => p.includes('manifest_FileNotFoundError')));
});

test('unresolvable targets are flagged as not in the catalog instead of being dropped', () => {
  const stack = card(stackCards(catalog()), 'stacks/homebase-stack');
  const members = stack.declared.groups.flatMap(g => g.entries);
  const other = members.find(e => e.target === 'other-stack');
  assert.equal(other.resolved, false);
  assert.equal(other.typeLabel, 'Stack');
  const library = members.find(e => e.target === 'skills');
  assert.equal(library.resolved, false);
  assert.equal(library.typeLabel, 'Skill-Bibliothek');
});

test('stacks with the same alias stay two cards keyed by id (aliases are not unique)', () => {
  const stacks = stackCards(catalog());
  assert.deepEqual(stacks.map(s => s.id), ['systems/homebase-stack', 'stacks/homebase-stack']);
  assert.equal(new Set(stacks.map(s => s.key)).size, 2);
});

test('relations resolve by type + id, with or without the "<type>:" prefix', () => {
  const c = catalog();
  const bundle = c.items.find(i => i.id === 'bundle-one');
  assert.equal(resolveTarget(c, bundle.relations[0]).id, 'alpha-core');
  assert.equal(resolveTarget(c, {target: 'alpha-core', targetType: 'bundle'}), null);
});

test('declared and measured are separate; nothing measured says so', () => {
  const one = card(bundleCards(catalog()), 'bundle-one');
  assert.equal(one.measured.measured, false);
  assert.match(one.measured.text, /^Nicht gemessen/);
  assert.equal(one.measured.kind, 'unmeasured');
  assert.equal(one.git.known, false);
  assert.match(one.git.text, /^Git-Snapshot: unbekannt \(kein Hostbeleg\)/);
  const body = raw();
  const item = body.items.find(i => i.id === 'bundle-one');
  Object.assign(item.measured, {installed: true, runtime_active: false, connection_state: 'connected', host: 'TEST-HOST', observed_at: '2026-01-01T00:00:00Z', evidence: 'probe'});
  const m = measuredSummary(parseCatalog(body).items.find(i => i.id === 'bundle-one'));
  assert.equal(m.measured, true);
  assert.equal(m.kind, 'measured');
  assert.match(m.text, /installiert · läuft nicht · Zustand: connected · Host TEST-HOST · beobachtet 2026-01-01T00:00:00Z · Beleg: probe/);
});

test('counts come only from the projection counts', () => {
  const c = catalog();
  assert.deepEqual(countsLine(c).map(e => [e.type, e.count]), [['bundle', 3], ['stack', 2], ['skill', 2]]);
  assert.deepEqual(countsLine(c).map(e => e.count), [c.counts.bundle, c.counts.stack, c.counts.skill]);
  const empty = catalog(b => { b.items = b.items.filter(i => i.type !== 'skill'); b.counts.skill = 0; b.count = b.items.length; b.errors = []; });
  assert.equal(countsLine(empty)[2].count, 0);
  assert.equal(skillRows(empty).length, 0);
});

test('skill rows carry version and a library candidate from the catalog PATH, never from the display name', () => {
  const rows = skillRows(catalog());
  const note = rows.find(r => r.id === 'skill:assist:note');
  assert.equal(note.version, '1.0.0');
  assert.equal(note.candidate, 'note');
  assert.deepEqual(note.languages, ['de', 'en']);
  assert.equal(rows.find(r => r.id === 'tool:util:abs').version, null);
  assert.equal(libraryCandidate({pathLabel: 'skills/assist/note/SKILL.md'}), 'note');
  assert.equal(libraryCandidate({pathLabel: 'SKILL.md'}), null);
  assert.equal(libraryCandidate({pathLabel: null}), null);
  assert.equal(libraryCandidate({pathLabel: 'skills/x/a b/SKILL.md'}), null);
  const renamed = catalog(b => { b.items.find(x => x.id === 'skill:assist:note').name = 'Anzeigename Ganz Anders'; });
  assert.equal(skillRows(renamed).find(r => r.id === 'skill:assist:note').candidate, 'note');
});

test('library ids resolve only unambiguously and only when the library knows them', () => {
  const rows = [{key: 'a', candidate: 'note'}, {key: 'b', candidate: 'dup'}, {key: 'c', candidate: 'dup'}, {key: 'd', candidate: null}, {key: 'e', candidate: 'ghost'}];
  const resolved = resolveLibraryIds(rows, new Set(['note', 'dup']));
  assert.deepEqual(resolved.get('a'), {id: 'note', reason: null});
  assert.match(resolved.get('b').reason, /Mehrdeutig/);
  assert.equal(resolved.get('c').id, null);
  assert.match(resolved.get('d').reason, /Kein Bibliothekspfad/);
  assert.match(resolved.get('e').reason, /Nicht in der Skill-Bibliothek/);
});

test('a state other than "unverified" without measured fields is an unevidenced claim, not "not measured"', () => {
  const body = raw();
  body.items.find(i => i.id === 'bundle-one').measured.connection_state = 'connected';
  const m = measuredSummary(parseCatalog(body).items.find(i => i.id === 'bundle-one'));
  assert.equal(m.kind, 'unevidenced');
  assert.equal(m.measured, false);
  assert.match(m.text, /"connected" gemeldet, ohne Messwerte, Beleg und Beobachtungszeit \(nicht belegt\)/);
  assert.doesNotMatch(m.text, /^Nicht gemessen/);
  const timeless = raw();
  Object.assign(timeless.items.find(i => i.id === 'bundle-one').measured, {installed: true, connection_state: 'connected'});
  assert.match(measuredSummary(parseCatalog(timeless).items.find(i => i.id === 'bundle-one')).text, /Beobachtungszeit unbekannt \(undatiert\)/);
});

test('the host git snapshot is separate, names host and source, and is undated without an observation time', () => {
  const body = raw();
  const bundle = body.items.find(i => i.id === 'bundle-one');
  Object.assign(bundle.git, {state: 'clean', host: 'TEST-HOST', source: 'repos_manifest:slot-a'});
  const undated = gitSnapshot(parseCatalog(body).items.find(i => i.id === 'bundle-one').git);
  assert.equal(undated.known, true);
  assert.equal(undated.dated, false);
  assert.match(undated.text, /Host TEST-HOST, Quelle repos_manifest:slot-a\): Clean · beobachtet unbekannt \(undatiert\)/);
  Object.assign(bundle.git, {observed_at: '2026-01-02T03:04:05Z', observed_at_basis: 'declared'});
  const dated = gitSnapshot(parseCatalog(body).items.find(i => i.id === 'bundle-one').git);
  assert.equal(dated.dated, true);
  assert.match(dated.text, /beobachtet 2026-01-02T03:04:05Z/);
  const card = bundleCards(parseCatalog(body)).find(c => c.id === 'bundle-one');
  assert.doesNotMatch(card.measured.text, /Clean/);
});

test('the skill search filters rows but never changes the counts', () => {
  const c = catalog();
  const rows = skillRows(c);
  assert.equal(filterRows(rows, 'NOTE').length, 1);
  assert.equal(filterRows(rows, 'zzz').length, 0);
  assert.equal(filterRows(rows, '  ').length, 2);
  assert.equal(c.counts.skill, 2);
});

test('missing and failed sources, errors and truncation stay visible', () => {
  const c = catalog(b => {
    b.sources[3].availability = 'missing';
    b.sources[3].error = 'nicht gefunden';
    b.truncated = true;
  });
  const rows = sourceRows(c);
  const bad = rows.find(r => r.id === 'bundles_catalog');
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 'fehlt');
  assert.equal(bad.error, 'nicht gefunden');
  assert.ok(catalogNotes(c).some(n => n.includes('gekürzt')));
  assert.ok(catalogNotes(c).some(n => n.includes('deklariert')));
  const bundle = card(bundleCards(c), 'bundle-one');
  assert.ok(bundle.problems.some(p => p.includes('bundles_catalog') && p.includes('fehlt')));
  assert.equal(c.errors.length, 3);
});

test('the UI module never writes catalog text through innerHTML or inline handlers', () => {
  const ui = readFileSync(new URL('../src/lib/catalog-views-ui.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\son[a-z]+\s*=/);
  const view = readFileSync(new URL('../src/components/CatalogViews.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(view, /set:html|<iframe|\son[a-z]+\s*=/);
});
