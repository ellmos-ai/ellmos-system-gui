import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BOAT_MODE_KEY, normalizeBoatMode, recordBoatClick} from '../src/lib/header-boat.mjs';

test('unknown or invalid mode values fall back to "on"', () => {
  assert.equal(BOAT_MODE_KEY, 'bach-boat-mode');
  for (const unknown of [undefined, null, '', '   ', 'auto', 'sunk', 'true', 0, 1, {}, [], NaN])
    assert.equal(normalizeBoatMode(unknown), 'on', String(unknown));
  assert.equal(normalizeBoatMode('off'), 'off');
  assert.equal(normalizeBoatMode(' LOGO '), 'logo');
});

test('three clicks within two seconds sink the boat, slower clicks do not', () => {
  let state = {timestamps: [], sunk: false};
  for (const t of [1000, 1800]) {
    state = recordBoatClick(state.timestamps, t);
    assert.equal(state.sunk, false);
  }
  assert.equal(recordBoatClick(state.timestamps, 3000).sunk, true); // exactly 2000 ms after the first click

  state = {timestamps: [], sunk: false};
  for (const t of [0, 1500, 3100]) state = recordBoatClick(state.timestamps, t);
  assert.equal(state.sunk, false);
  assert.deepEqual(state.timestamps, [1500, 3100]);
});

test('header and settings use the shared logic and keep the boat reachable by keyboard', () => {
  const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/pages/settings.astro', import.meta.url), 'utf8');
  assert.match(header, /initializeHeaderBoat\(\)/);
  assert.match(header, /<button[^>]*id="header-paper-boat-btn"/);
  assert.match(header, /id="header-boat-restore-btn"/);
  assert.match(header, /prefers-reduced-motion/);
  assert.match(settings, /id="boat-mode-select"/);
  for (const value of ['on', 'off', 'logo']) assert.match(settings, new RegExp(`<option value="${value}"`));
});
