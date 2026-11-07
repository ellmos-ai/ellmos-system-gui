// PB-5b (#3989): the control icons are plain, safe SVG and come as line/emoji pairs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ICON_NAMES, ICON_SOURCES, iconSvgMarkup, iconEmoji, createIconGlyph} from '../src/lib/ui-icons.mjs';
import {SHELL_ICON_SOURCES} from '../src/lib/shell-icon-sources.mjs';

test('every icon is outline-only SVG made of plain shapes and has an emoji twin', () => {
  assert.ok(ICON_NAMES.length >= 20);
  for (const name of ICON_NAMES) {
    const svg = iconSvgMarkup(name);
    assert.match(svg, /^<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"/, name);
    const tags = new Set([...svg.matchAll(/<([a-z]+)/g)].map(m => m[1]));
    for (const tag of tags) assert.ok(['svg', 'path', 'circle', 'rect', 'polyline', 'polygon', 'line'].includes(tag), `${name}: <${tag}>`);
    assert.doesNotMatch(svg, /script|on\w+=|href|style=|fill="(?!none)/i, name);
    assert.ok(iconEmoji(name), name + ' has no emoji twin');
  }
  assert.equal(iconSvgMarkup('does-not-exist'), '');
});

test('the glyph pair holds the line icon and the emoji, the shell CSS shows one of them', () => {
  const made = [];
  const document = {createElement: tag => { const node = {tag, children: [], attributes: {}, className: '', textContent: '', innerHTML: '',
    append(...c) { this.children.push(...c); }, setAttribute(k, v) { this.attributes[k] = v; }}; made.push(node); return node; }};
  const pair = createIconGlyph(document, 'refresh');
  assert.equal(pair.attributes['aria-hidden'], 'true');
  assert.deepEqual(pair.children.map(c => c.className), ['icon-glyph icon-glyph-line', 'icon-glyph icon-glyph-emoji']);
  assert.match(pair.children[0].innerHTML, /<svg/);
  assert.equal(pair.children[1].textContent, '🔄');
  assert.equal(createIconGlyph(document, 'nope'), null);
});

// ---- Origin and license: every icon names its source, every foreign source has a license entry ----
const licenses = readFileSync(new URL('../THIRD_PARTY_LICENSES.md', import.meta.url), 'utf8');
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const LIBRARIES = {
  feather: {heading: '### Feather (MIT)', text: /The MIT License \(MIT\)[\s\S]*Copyright \(c\) 2013-2023 Cole Bemis/},
  lucide: {heading: '### Lucide (ISC)', text: /ISC License[\s\S]*Copyright \(c\) 2026 Lucide Icons and Contributors/},
};
const SOURCE_FORMAT = /^(own \(|(feather|lucide):[a-z0-9-]+ \((identical geometry|derived|similar, attributed as precaution))/;

// the names listed in one "<label> (...): a, b, c." line of a license section
function listed(section, label) {
  const line = new RegExp('^' + label + ' \\([^)]*\\): (.*)\\.$', 'm').exec(section)?.[1];
  assert.ok(line, `no "${label}" line in the section`);
  return line.split(/,\s*/);
}
function section(heading) {
  const start = licenses.indexOf(heading);
  assert.ok(start >= 0, `no ${heading} in THIRD_PARTY_LICENSES.md`);
  const next = licenses.indexOf('\n### ', start + 1);
  return licenses.slice(start, next < 0 ? undefined : next);
}

function checkRegistry(sources, label) {
  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, SOURCE_FORMAT, `${name}: ${source}`);
    const library = /^(feather|lucide):/.exec(source)?.[1];
    const part = library ? section(LIBRARIES[library].heading) : section('### Own icons');
    if (library) assert.match(part, LIBRARIES[library].text, `${library}: license notice missing`);
    assert.ok(listed(part, label).includes(name), `${name} (${source}) is not listed under ${library ?? 'Own icons'} in THIRD_PARTY_LICENSES.md`);
  }
}

test('every control icon has a source note and a license entry', () => {
  assert.deepEqual(Object.keys(ICON_SOURCES).sort(), [...ICON_NAMES].sort());
  checkRegistry(ICON_SOURCES, 'Control icons');
});

test('every shell icon (Header, header glyphs, theme buttons, domain pins) has a source note and a license entry', () => {
  const header = read('src/components/Header.astro');
  const pins = read('src/lib/domain-pins.mjs');
  const block = header.slice(header.indexOf('const LINE_ICON_SVGS'), header.indexOf('function lineIconSvg'));
  const keys = [...block.matchAll(/^\s*(?:"([^"]+)"|(\w+)):\s*'/gm)].map(m => 'header:' + (m[1] ?? m[2]));
  const pinBlock = pins.slice(pins.indexOf('const DOMAIN_SVG_PATHS'), pins.indexOf('export function createDomainIconElement'));
  keys.push(...[...pinBlock.matchAll(/^\s*(\w+):'/gm)].map(m => 'domain-pins:' + m[1]));
  keys.push(...[...header.matchAll(/class="theme-btn" data-theme="(\w+)"/g)].map(m => 'header-theme:' + m[1]));
  // the three inline glyphs of the header quick actions (calendar, contacts, help)
  assert.equal([...header.matchAll(/<span class="icon-glyph icon-glyph-line" aria-hidden="true"><svg viewBox/g)].length, 3 + 4, 'a new inline icon needs a source entry');
  keys.push('header-inline:calendar', 'header-inline:users', 'header-inline:help-inline');
  assert.ok(keys.length >= 59, `found only ${keys.length} shell icons`);
  assert.deepEqual(Object.keys(SHELL_ICON_SOURCES).sort(), [...new Set(keys)].sort());
  checkRegistry(SHELL_ICON_SOURCES, 'Shell icons');
});

test('the origin statements do not claim more than is known', () => {
  for (const file of ['src/lib/ui-icons.mjs', 'src/lib/shell-icon-sources.mjs']) {
    const text = read(file);
    assert.match(text, /THIRD_PARTY_LICENSES\.md/, file);
    assert.doesNotMatch(text, /Drawn by agy \(see PR\)/, file);
  }
  assert.match(read('src/lib/ui-icons.mjs'), /model that ran is not recorded/);
  assert.match(read('src/lib/shell-icon-sources.mjs'), /origin was never\s+\/\/ recorded/);
});
