import test from 'node:test';
import assert from 'node:assert/strict';
import {INVENTORIES} from '../src/lib/capability-board-client.mjs';
import {catalogMatches, publicationLabel, safePublicationUrl} from '../src/lib/software-catalog.mjs';

test('application catalog and Ocean source inventory use separate adapters', () => {
  assert.equal(INVENTORIES.software, '/api/capabilities/software');
  assert.equal(INVENTORIES.ocean, '/api/capabilities/ocean');
  assert.equal(catalogMatches('software', {kind:'software', catalog:'software-applications'}), true);
  assert.equal(catalogMatches('ocean', {kind:'ocean', catalog:'ocean-host-sources'}), true);
  assert.equal(catalogMatches('software', {kind:'software', items:[{name:'Repo'}]}), false);
  assert.equal(catalogMatches('software', {kind:'ocean', catalog:'ocean-host-sources'}), false);
});
test('release links reject executable schemes and credentials', () => {
  for (const url of ['javascript:alert(1)', 'file:///tmp/app', 'https://user:secret@example.org', 'https://example.org/?token=secret', 'https://example.org/#secret'])
    assert.equal(safePublicationUrl(url), null);
  assert.equal(safePublicationUrl('https://example.org/app'), 'https://example.org/app');
});
test('publication labels retain the declared evidence boundary', () => {
  assert.equal(publicationLabel({platform:'windows', declared_status:'live'}), 'windows · Veröffentlicht laut Register');
  assert.equal(publicationLabel({type:'web', declared_status:'planned'}), 'web · Geplant');
});

import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('refresh failures clear stale applications and show the actual failure', async () => {
  const source = readFileSync(new URL('../src/lib/capability-board-ui.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  async function refresh()');
  const end = source.indexOf('  const editor =', start);
  let answer = {kind:'software', catalog:'software-applications', items:[{name:'Routinika'}]};
  const nodes = {'board-status':{textContent:''},'board-refresh':{disabled:false}};
  const context = vm.createContext({
    kind:'software', INVENTORIES, catalogMatches,
    byId: id => nodes[id] || null,
    renderItems: () => {},
    requestJson: async () => {if (answer instanceof Error) throw answer; return answer;}
  });
  vm.runInContext('let items=[], inventoryGeneration=0;\n' + source.slice(start,end) +
    '\nglobalThis.refresh=refresh; globalThis.loaded=()=>items;', context);
  await context.refresh();
  assert.equal(context.loaded().length, 1);
  for (const failure of [new Error('API 503'), {kind:'software', items:[{name:'Legacy repository'}]}]) {
    answer = failure;
    await context.refresh();
    assert.equal(context.loaded().length, 0);
    assert.match(nodes['board-status'].textContent, /Quelle nicht geladen:/);
    assert.equal(nodes['board-refresh'].disabled, false);
  }
  assert.match(nodes['board-status'].textContent, /noch nicht getrennt angebunden/);
});
