// PB-5b (#3989): the control icons are plain, safe SVG and come as line/emoji pairs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ICON_NAMES, iconSvgMarkup, iconEmoji, createIconGlyph} from '../src/lib/ui-icons.mjs';

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
