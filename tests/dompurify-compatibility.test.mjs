import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const projectRequire = createRequire(new URL('../package.json', import.meta.url));
const mermaidRequire = createRequire(projectRequire.resolve('mermaid'));

test('Mermaid resolves the patched DOMPurify within its existing declared range', () => {
  assert.equal(manifest.dependencies.mermaid, '11.17.2');
  assert.equal(manifest.dependencies.dompurify, undefined);
  assert.equal(manifest.overrides?.dompurify, undefined);
  assert.equal(manifest.overrides?.mermaid?.dompurify, undefined);
  assert.equal(lock.packages['node_modules/mermaid'].dependencies.dompurify, '^3.3.3');
  const installed = JSON.parse(readFileSync(resolve(dirname(mermaidRequire.resolve('dompurify')), '../package.json'), 'utf8'));
  assert.equal(installed.version, '3.4.17');
  assert.equal(lock.packages['node_modules/dompurify'].version, installed.version);
});

test('the patched sanitizer has an exact registry tarball and integrity pin', () => {
  const sanitizer = lock.packages['node_modules/dompurify'];
  assert.equal(sanitizer.resolved, 'https://registry.npmjs.org/dompurify/-/dompurify-3.4.17.tgz');
  assert.equal(sanitizer.integrity, 'sha512-B/pSlYVHQ58kqISD/yDjuJ1yfzI34m1gF4lAod2bwSRhiN4K5Cl3H8Af7hqB2PmTL911tdEudnnXn5FnhRoz0w==');
  assert.equal(manifest.overrides?.mermaid?.katex, '0.18.7');
  assert.equal(lock.packages['node_modules/katex'].version, '0.18.7');
});

test('the application retains strict string/SVG rendering and theme behavior', () => {
  const source = read('src/pages/memory.astro');
  assert.match(source, /securityLevel: 'strict'/);
  assert.match(source, /const themeName = isLight \? 'default' : 'dark'/);
  assert.match(source, /theme: themeName/);
  assert.match(source, /htmlLabels: false/);
  assert.doesNotMatch(source, /IN_PLACE|SAFE_FOR_TEMPLATES|PARSER_MEDIA_TYPE|addHook|attachShadow/);
});
