// PB-6 (#3990, B-07): Astro scopes a page's <style> to the elements the template rendered. Elements a script creates
// (createElement, innerHTML) carry no scope attribute, so their rules never apply and rows fall apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findScopedStyleTraps, dynamicClasses, scopedClasses, checkTree} from '../scripts/verify-scoped-styles.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const page = (style, script) => `---\n---\n<div class="row"></div>\n${script}\n${style}\n`;
const SCRIPT = `<script>const r = document.createElement('div'); r.className = 'routine-row cell'; list.append(r);</script>`;

test('negative control: a scoped style plus a script-made element of that class is a trap', () => {
  assert.deepEqual(findScopedStyleTraps(page('<style>.routine-row{display:grid}</style>', SCRIPT)), ['routine-row']);
});
test('positive controls: is:global, :global() and a class the script does not make are no trap', () => {
  assert.deepEqual(findScopedStyleTraps(page('<style is:global>.routine-row{display:grid}</style>', SCRIPT)), []);
  assert.deepEqual(findScopedStyleTraps(page('<style>:global(.routine-row){display:grid}</style>', SCRIPT)), []);
  assert.deepEqual(findScopedStyleTraps(page('<style>.row{display:grid}</style>', SCRIPT)), []);
});
test('classes are read from className and class= markup in strings; classList on existing elements is ignored', () => {
  const found = dynamicClasses(`a.className = on ? 'x y' : 'q'; b.classList.add('z'); c.innerHTML = \`<i class="w v">\`;`);
  assert.deepEqual([...found].sort(), ['q', 'v', 'w', 'x', 'y']);
  assert.deepEqual([...scopedClasses('<style>.a .b:hover, :global(.c) .d{} @media(max-width:9px){.e{}}</style>')].sort(), ['a', 'b', 'd', 'e']);
});

test('no new page or component styles script-made elements with a scoped rule, and the known list only shrinks', () => {
  assert.deepEqual(checkTree(root), {unexpected: {}, stale: []});
});

test('generic main.css classes are not findings', () => {
  assert.deepEqual(findScopedStyleTraps(page('<style>.btn{color:red}</style>', `<script>b.className = 'btn';</script>`)), []);
});

test('the build runs the guard', async () => {
  const {readFileSync} = await import('node:fs');
  const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts;
  assert.match(scripts.build, /verify-scoped-styles\.mjs/);
  assert.match(scripts['build:release'], /verify-scoped-styles\.mjs/);
});
