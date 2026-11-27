import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const CHECKED_FILES = [
  '../src/pages/agenten/running.astro',
  '../src/pages/settings.astro',
  '../src/pages/agenten/blueprints.astro',
  '../src/components/Header.astro',
  '../src/lib/agent-tile.mjs',
  '../src/lib/model-tuning.mjs',
  '../src/lib/role-socket-preview.mjs',
  '../src/scripts/blueprint-studio.mjs',
];

const FORBIDDEN_LEGACY_UI_STRINGS = [
  'Aktueller Fackelhalter',
  'Hardware-Fackel',
  'Hauptfackel',
  'Fackelspeicher',
  'Fackelbesitz',
  'Fackel-Priorität',
  'Fackelanteile',
  'Steckplatz einrichten',
  'Steckplatz aktualisieren',
  'Als Steckplatz',
  'Steckplatzkonfiguration',
  'Systemplatz',
  'Anbieter-Sockel',
  'Modell-Sockel',
];

test('GUI views use congruent terminology without legacy Fackel/Steckplatz/Sockel labels', () => {
  for (const rel of CHECKED_FILES) {
    const content = readFileSync(new URL(rel, import.meta.url), 'utf8');
    for (const legacy of FORBIDDEN_LEGACY_UI_STRINGS) {
      assert.equal(
        content.includes(legacy),
        false,
        `${rel} darf den veralteten UI-Begriff "${legacy}" nicht mehr enthalten`,
      );
    }
  }
});

test('Stage 1 RAM-Zuteilung and Stage 2 Modellzeit-Zuteilung appear consistently on running and settings', () => {
  const running = readFileSync(new URL('../src/pages/agenten/running.astro', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/pages/settings.astro', import.meta.url), 'utf8');
  assert.match(running, /RAM-Zuteilung/);
  assert.match(running, /Modellzeit-Zuteilung/);
  assert.match(settings, /RAM-Zuteilung/);
  assert.match(settings, /Modellzeit-Zuteilung/);
});
