// PB-22: Visual acceptance and Polaroid briefing generator contract
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POLAROID_SCHEMA,
  VALID_BILDER_MODI,
  generatePolaroidBriefing,
  formatPolaroidMarkdown
} from '../scripts/gui-walkthrough.mjs';

const mockReport = {
  schema: 'ellmos.gui.walkthrough.v1',
  generatedAt: '2026-11-09T08:00:00.000Z',
  base: 'http://127.0.0.1:4321',
  summary: {pages: 2, ok: true},
  pages: [
    {
      path: '/',
      slug: 'index',
      url: 'http://127.0.0.1:4321/',
      status: 200,
      variants: [
        {variant: 'desktop-light', screenshot: 'screenshots/index-desktop-light.png'},
        {variant: 'desktop-dark', screenshot: 'screenshots/index-desktop-dark.png'},
        {variant: 'mobile-light', screenshot: 'screenshots/index-mobile-light.png'},
        {variant: 'mobile-dark', screenshot: 'screenshots/index-mobile-dark.png'}
      ]
    },
    {
      path: '/tasks',
      slug: 'tasks',
      url: 'http://127.0.0.1:4321/tasks',
      status: 200,
      variants: [
        {variant: 'desktop-light', screenshot: 'screenshots/tasks-desktop-light.png'},
        {variant: 'desktop-dark', screenshot: 'screenshots/tasks-desktop-dark.png'},
        {variant: 'mobile-light', screenshot: null},
        {variant: 'mobile-dark', screenshot: 'screenshots/tasks-mobile-dark.png'}
      ]
    }
  ]
};

test('POLAROID_SCHEMA and VALID_BILDER_MODI contract', () => {
  assert.equal(POLAROID_SCHEMA, 'ellmos.gui.polaroid-briefing.v1');
  assert.deepEqual([...VALID_BILDER_MODI].sort(), ['polaroid', 'serie', 'swipe']);
});

test('generatePolaroidBriefing creates briefing with default serie mode', () => {
  const briefing = generatePolaroidBriefing(mockReport);
  assert.equal(briefing.schema, POLAROID_SCHEMA);
  assert.equal(briefing.bilder_modus, 'serie');
  assert.equal(briefing.gesamt_posten, 2);
  assert.equal(briefing.basis_url, 'http://127.0.0.1:4321');

  const [first, second] = briefing.posten;
  assert.equal(first.id, 'index');
  assert.equal(first.pfad, '/');
  assert.equal(first.titel, 'Visuelle Abnahme: /');
  assert.equal(first.status, 200);
  assert.equal(first.bilder_modus, 'serie');
  assert.deepEqual(first.bilder, [
    'screenshots/index-desktop-light.png',
    'screenshots/index-desktop-dark.png',
    'screenshots/index-mobile-light.png',
    'screenshots/index-mobile-dark.png'
  ]);
  assert.deepEqual(first.entscheidung.optionen, ['Abgenommen', 'Nacharbeiten']);

  assert.equal(second.id, 'tasks');
  assert.equal(second.pfad, '/tasks');
  // Filters out null screenshot
  assert.equal(second.bilder.length, 3);
});

test('generatePolaroidBriefing supports polaroid and swipe modes', () => {
  const polaroid = generatePolaroidBriefing(mockReport, {bilder_modus: 'polaroid'});
  assert.equal(polaroid.bilder_modus, 'polaroid');
  assert.equal(polaroid.posten[0].bilder_modus, 'polaroid');

  const swipe = generatePolaroidBriefing(mockReport, {'polaroid-modus': 'swipe'});
  assert.equal(swipe.bilder_modus, 'swipe');
  assert.equal(swipe.posten[0].bilder_modus, 'swipe');
});

test('generatePolaroidBriefing rejects unknown bilder_modus fail-closed', () => {
  assert.throws(() => {
    generatePolaroidBriefing(mockReport, {bilder_modus: 'carousel'});
  }, /Ungültiger bilder_modus "carousel"/);
});

test('formatPolaroidMarkdown generates readable summary', () => {
  const briefing = generatePolaroidBriefing(mockReport);
  const md = formatPolaroidMarkdown(briefing);
  assert.match(md, /# Polaroid-Briefing: Visuelle Abnahme/);
  assert.match(md, /Modus: `serie`/);
  assert.match(md, /### Visuelle Abnahme: \//);
  assert.match(md, /screenshots\/index-desktop-light\.png/);
});
