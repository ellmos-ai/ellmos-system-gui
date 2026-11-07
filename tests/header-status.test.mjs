// PB-5b (#3989, B-15): the two header status pills say one thing each, in words, with a quiet indicator. No emoji.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {backendPillModel, backendPillError, computePillModel, computePillError, applyPill} from '../src/lib/header-status.mjs';

const verified = {connection_verified: true, schema_verified: true, instance_verified: true, adapter_binding_verified: true};

test('backend pill: verified server and local backends, unverified and offline states', () => {
  const server = backendPillModel({...verified, mode: 'server', instance_label: 'Mac Studio', observed_at: '2026-11-07T08:00:00Z'});
  assert.deepEqual([server.text, server.tone], ['Backend Server', 'ok']);
  assert.match(server.title, /Mac Studio · geprüft 2026-11-07T08:00:00Z/);
  assert.deepEqual([backendPillModel({...verified, mode: 'local'}).text, backendPillModel({...verified, mode: 'local'}).tone], ['Backend lokal', 'ok']);
  const partial = backendPillModel({...verified, instance_verified: false, mode: 'server'});
  assert.deepEqual([partial.text, partial.tone], ['Backend unbekannt', 'unknown']);
  assert.match(partial.title, /nicht verifiziert/);
  assert.deepEqual([backendPillModel({...verified, mode: 'cloud'}).text], ['Backend unbekannt']);
  const offline = backendPillError();
  assert.deepEqual([offline.text, offline.tone], ['Offline · Backend unbekannt', 'error']);
});

test('compute pill: one statement per state, the action stays in the tooltip', () => {
  const cockpit = (over = {}) => ({fackel: {capacity: {loaded_model_count: 1, used_gib: 27.2, loaded_models: ['qwen3.8:27b-mlx']},
    priority: {value: 'ollama'}, compute_turn: {active: false}, ...over}});
  const active = computePillModel(cockpit({compute_turn: {active: true}}));
  assert.deepEqual([active.text, active.tone], ['Modell aktiv · qwen3.8:27b-mlx', 'busy']);
  const loaded = computePillModel(cockpit());
  assert.deepEqual([loaded.text, loaded.tone], ['1 Modell geladen · 27,2 GiB', 'idle']);
  assert.match(loaded.title, /Klicken, um .*freizugeben/);
  const two = computePillModel(cockpit({capacity: {loaded_model_count: 2, used_gib: 31, loaded_models: ['a', 'b']}}));
  assert.equal(two.text, '2 Modelle geladen · 31,0 GiB');
  const empty = computePillModel(cockpit({capacity: {loaded_model_count: 0, loaded_models: []}}));
  assert.deepEqual([empty.text, empty.tone], ['Kein Modell im RAM', 'idle']);
  const free = computePillModel(cockpit({capacity: {loaded_model_count: 0, loaded_models: []}, priority: {value: 'compute'}}));
  assert.deepEqual([free.text, free.tone], ['RAM frei für Compute', 'ok']);
  const none = computePillModel({});
  assert.equal(none.text, 'Kein Modell im RAM');
  const broken = computePillError();
  assert.deepEqual([broken.text, broken.tone], ['RAM-Status nicht verfügbar', 'unknown']);
});

test('no pill text contains an emoji or pictograph', () => {
  const texts = [backendPillError().text, computePillError().text, backendPillModel({}).text, computePillModel({}).text,
    computePillModel({fackel: {compute_turn: {active: true}, capacity: {loaded_models: ['x']}}}).text];
  for (const text of texts) assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, text);
});

test('applyPill writes text, tone and title and nothing else', () => {
  const node = {textContent: '', dataset: {}, title: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }};
  applyPill(node, {text: 'Backend Server', tone: 'ok', title: 'Mac Studio'});
  assert.equal(node.textContent, 'Backend Server');
  assert.equal(node.dataset.tone, 'ok');
  assert.equal(node.title, 'Mac Studio');
});

const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url), 'utf8');

test('the header uses the pill models and no longer writes emoji, inline colors or glow into the pill', () => {
  assert.match(header, /BachHeaderStatus/);
  assert.doesNotMatch(header, /🔥|🧠|🔓|⏳ Gebe RAM/, 'no emoji in the RAM pill states');
  assert.doesNotMatch(header, /getElementById\("header-ram-claim-dot"\)/, 'indicator colors come from data-tone, not from script');
  assert.match(header, /Backend unbekannt/);
  assert.match(header, /fetch\('\/api\/gui\/backend-origin'/);
});
