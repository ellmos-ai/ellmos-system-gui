import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  INVENTORY_SOURCES,
  hasAdvertisedReadRoute,
  installerActionState,
  liveReleaseState,
  managementHref,
  normalizeInventory,
  stateLabel,
  triState,
} from '../src/lib/installation-updates-model.mjs';

const capabilities = {
  schema: 'ellmos.gui.capabilities.v1',
  endpoints: [
    {method: 'GET', path: '/api/capabilities/software', available: true},
    {method: 'POST', path: '/api/installer/apply', available: true},
  ],
};

test('only explicitly advertised GET inventory routes are read', () => {
  assert.equal(hasAdvertisedReadRoute(capabilities, '/api/capabilities/software'), true);
  assert.equal(hasAdvertisedReadRoute(capabilities, '/api/capabilities/ocean'), false);
  assert.equal(hasAdvertisedReadRoute(capabilities, '/api/installer/apply'), false);
});

test('installed and runtime evidence preserves unknown as unknown', () => {
  assert.equal(triState(true), true);
  assert.equal(triState(false), false);
  assert.equal(triState(null), null);
  assert.equal(stateLabel(null, 'yes', 'no'), 'Unbekannt');
  assert.equal(stateLabel(false, 'yes', 'no'), 'no');
});

test('software source catalog does not promote catalog presence to installed state', () => {
  const source = INVENTORY_SOURCES.find((entry) => entry.kind === 'software');
  const items = normalizeInventory(source, {
    schema: 'bach.capability-inventory.v1',
    kind: 'software',
    items: [{name: 'Editor', version: '2.1', source_version: 'abc123', installed: null, runtime_active: null, code_present: true}],
  });
  assert.equal(items[0].name, 'Editor');
  assert.equal(items[0].id, '');
  assert.equal(items[0].codePresent, true);
  assert.equal(items[0].catalogAvailable, null);
  assert.equal(items[0].installed, null);
  assert.equal(items[0].runtimeActive, null);
});

test('skills use the current skill-library schema without path or body fields', () => {
  const source = INVENTORY_SOURCES.find((entry) => entry.kind === 'skills');
  const items = normalizeInventory(source, {
    schema: 'bach.skill-library.v1',
    skills: [{id: 'research-helper', name: 'Research Helper', version: '1.2', source_version: 'deadbeef', path: 'C:\\private\\skill.md', content: 'private body'}],
  });
  assert.deepEqual(items[0], {
    id: 'research-helper', name: 'Research Helper', category: '', version: '1.2', sourceVersion: 'deadbeef',
    evidence: '', connectionState: '', installed: null, runtimeActive: null,
    catalogAvailable: null, codePresent: null, enabledInClient: null, publications: [],
  });
});

test('absolute paths in displayed inventory fields are omitted', () => {
  const source = INVENTORY_SOURCES.find((entry) => entry.kind === 'skills');
  const items = normalizeInventory(source, {
    schema: 'bach.skill-library.v1',
    skills: [{id: 'C:\\Users\\User\\private\\skill.md', name: '/srv/private/skill', category: 'Local: ~/secrets/skill.md'}],
  });
  assert.equal(items[0].name, 'Unbenannte Komponente');
  assert.equal(items[0].id, '');
  assert.equal(items[0].category, '');
});

test('target links use validated stable IDs and never infer an ID from a label', () => {
  const source = INVENTORY_SOURCES.find((entry) => entry.kind === 'skills');
  assert.equal(managementHref(source, {id: 'research-helper'}), '/skills?component_id=research-helper&from=betrieb');
  assert.equal(managementHref(source, {id: 'team:reviewer.v2'}), '/skills?component_id=team%3Areviewer.v2&from=betrieb');
  assert.equal(managementHref(source, {id: 'C:\\Users\\User\\skill.md'}), null);
  assert.equal(managementHref(source, {id: 'skill/folder'}), null);
  assert.equal(managementHref(source, {name: 'Research Helper'}), null);
});

test('dynamic catalogue rows receive scoped global styles and component links focus the exact ID', async () => {
  const page = await readFile(new URL('../src/pages/system/installation-updates.astro', import.meta.url), 'utf8');
  const board = await readFile(new URL('../src/lib/capability-board-ui.mjs', import.meta.url), 'utf8');
  for (const className of ['catalog-card', 'catalog-card-head', 'source-badge', 'component-list', 'component-row', 'component-facts', 'fact-chip', 'component-manage-link', 'empty-source']) {
    assert.ok(page.includes(`.catalog-grid :global(.${className})`), `dynamic .${className} needs a scoped global selector`);
  }
  assert.ok(board.includes("get('component_id')"));
  assert.ok(board.includes('element.dataset.id === requestedComponentId'));
});

test('installer actions stay disabled even if an uncontracted route is registered', () => {
  const state = installerActionState(capabilities);
  assert.equal(state.enabled, false);
  assert.equal(state.registeredRoutes, 1);
  assert.match(state.reason, /versionierter GUI-Vertrag/);
});

test('live release state does not infer GitHub updates from package declarations', () => {
  assert.equal(liveReleaseState(capabilities), 'unavailable');
  assert.equal(liveReleaseState({schema: 'other', endpoints: []}), 'unbekannt');
});

test('malformed inventory schemas fail closed', () => {
  const source = INVENTORY_SOURCES.find((entry) => entry.kind === 'ocean');
  assert.throws(() => normalizeInventory(source, {schema: 'wrong', kind: 'ocean', items: []}), /Katalogvertrag/);
  assert.throws(() => normalizeInventory(source, {schema: 'bach.capability-inventory.v1', kind: 'software', items: []}), /Komponentenart/);
});
