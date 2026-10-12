import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages/memory.astro', import.meta.url), 'utf8');
const mapOpening = source.match(/<details\b[^>]*\bid="memory-process-map"[^>]*>/)?.[0];

test('memory map starts collapsed and keeps its native disclosure summary', () => {
  assert.ok(mapOpening, 'the memory map details element remains present');
  assert.doesNotMatch(mapOpening, /\sopen(?=\s|=|>)/i);

  const mapOpeningAt = source.indexOf(mapOpening);
  const mapContent = source.slice(mapOpeningAt + mapOpening.length);
  const summary = mapContent.match(/^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/);
  assert.ok(summary, 'the native summary remains inside the map');
  assert.match(summary[1], /Map: Soll-Modell · ein- und ausklappen/);
});

test('all eight memory inspector tabs and their panels remain present', () => {
  const inspectors = ['ctx', 'ze', 'sensors', 'guards', 'auth', 'start', 'learn', 'ltm'];
  for (const inspector of inspectors) {
    assert.ok(source.includes('id="tab-btn-' + inspector + '"'), 'missing tab button: ' + inspector);
    assert.ok(source.includes('id="panel-' + inspector + '"'), 'missing inspector panel: ' + inspector);
  }
});
