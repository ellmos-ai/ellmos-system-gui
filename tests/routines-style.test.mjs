// PB-6 (#3990, B-07): the rows of /routinen are made by a script, so the page's rules must be global.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const page = read('src/pages/routinen.astro');
const ui = read('src/lib/routines-ui.mjs');
const style = (page.match(/<style([^>]*)>([\s\S]*?)<\/style>/) ?? []);

test('the page style is global, so rules reach script-made rows', () => {
  assert.match(style[1] ?? '', /is:global/);
});

test('every routine-* class the script puts on an element has a rule in the page style', () => {
  const code = ui.replace(/^\s*\/\/.*$/gm, '');
  const used = new Set([...code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].flatMap(m => m[2].split(/\s+/)).filter(w => /^(routine-[\w-]+|is-readonly)$/.test(w)));
  assert.ok(used.size >= 10, `found only ${[...used]}`);
  const missing = [...used].filter(name => !new RegExp(`\\.${name}(?![\\w-])`).test(style[2] ?? ''));
  assert.deepEqual(missing, []);
});

test('rows and header share one column definition, so they cannot drift apart', () => {
  assert.match(style[2], /--routine-cols:/);
  assert.equal((style[2].match(/grid-template-columns:var\(--routine-cols\)/g) ?? []).length >= 1, true);
});

test('read-only state is a labelled status, not a disabled-looking button', () => {
  assert.doesNotMatch(ui, /disabled\s*=\s*true/);
  assert.match(ui, /is-readonly/);
  assert.match(style[2], /\.routine-state\.is-readonly\{[^}]*color:var\(--text-muted\)/);
  assert.doesNotMatch(style[2], /\.is-readonly\{[^}]*opacity:\s*(0?\.[0-5])/);
});

test('page text avoids template chrome: no all-caps header row, no eyebrow label', () => {
  assert.doesNotMatch(style[2], /text-transform:\s*uppercase/);
  assert.doesNotMatch(page, /routine-eyebrow/);
});

test('the trigger panel under the list is styled too: global style, buttons with the shared button classes', () => {
  const panel = read('src/components/AgentTriggers.astro');
  assert.match(panel, /<style is:global>/);
  for (const button of panel.match(/<button[^>]*>/g)) assert.match(button, /class="btn btn-sm/, button);
  assert.match(read('src/lib/agent-triggers-ui.mjs'), /button\.className = 'btn btn-sm'/);
});
