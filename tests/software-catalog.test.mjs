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
