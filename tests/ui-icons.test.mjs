// PB-5b (#3989): the control icons are plain, safe SVG and come as line/emoji pairs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ICON_NAMES, ICON_SOURCES, iconSvgMarkup, iconEmoji, createIconGlyph} from '../src/lib/ui-icons.mjs';

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
const LIBRARIES = {
  feather: {heading: '### Feather (MIT)', text: /The MIT License \(MIT\)[\s\S]*Copyright \(c\) 2013-2023 Cole Bemis/},
  lucide: {heading: '### Lucide (ISC)', text: /ISC License[\s\S]*Copyright \(c\) 2026 Lucide Icons and Contributors/},
};

test('every icon has a source note, and no icon lacks or invents one', () => {
  assert.deepEqual(Object.keys(ICON_SOURCES).sort(), [...ICON_NAMES].sort());
  for (const [name, source] of Object.entries(ICON_SOURCES))
    assert.match(source, /^(own \(agy; |feather:[a-z0-9-]+ \(|lucide:[a-z0-9-]+ \()/, `${name}: ${source}`);
});

test('every foreign source has a license entry with its notice, and the icon is listed under it', () => {
  for (const [name, source] of Object.entries(ICON_SOURCES)) {
    const library = /^(feather|lucide):/.exec(source)?.[1];
    if (!library) continue;
    const {heading, text} = LIBRARIES[library];
    const start = licenses.indexOf(heading);
    assert.ok(start >= 0, `${library}: no heading in THIRD_PARTY_LICENSES.md`);
    const section = licenses.slice(start, licenses.indexOf('\n### ', start + 1) < 0 ? undefined : licenses.indexOf('\n### ', start + 1));
    assert.match(section, text, `${library}: license notice missing`);
    const listed = /Icons here that (?:are|are identical to or derived from)[^:]*:([^.]*)\./s.exec(section)?.[1] ?? '';
    assert.ok(listed.split(/[,\s]+/).includes(name), `${name} (${source}) is not listed under ${library}`);
  }
  assert.match(licenses, /### Own icons[\s\S]*ear, radio, sparkles/);
});

test('the origin statement does not claim more than is known', () => {
  const module = readFileSync(new URL('../src/lib/ui-icons.mjs', import.meta.url), 'utf8');
  assert.match(module, /model that ran is not recorded/);
  assert.match(module, /THIRD_PARTY_LICENSES\.md/);
  assert.doesNotMatch(module, /Drawn by agy \(see PR\)/);
});
