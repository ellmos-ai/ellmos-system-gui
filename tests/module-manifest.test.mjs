import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('the module declares only the shared static distribution capabilities', async () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('ellmos-module.v2.json', root), 'utf8'));
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.schema, 'ellmos.module.v2');
  assert.equal(manifest.id, pkg.name);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.kind, 'ui');
  assert.deepEqual(manifest.provides, ['gui.static.distribution', 'gui.same-origin.client']);
  assert.deepEqual(manifest.requires, []);
  assert.deepEqual(manifest.state, {ownership: 'none', location: 'none'});
  assert.equal(manifest.source_of_truth.repository, 'https://github.com/ellmos-ai/ellmos-system-gui');
});
