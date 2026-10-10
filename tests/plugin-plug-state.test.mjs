import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {plugState, plugSummary, plugSummaryText, plugAccessibleText, observedLabel, PLUG_STATES} from '../src/lib/plugin-plug-state.mjs';

// Antwort des echten Handlers GET /api/capabilities/plugins/inventory (siehe _origin im Fixture).
const fixture = JSON.parse(readFileSync(new URL('./fixtures/plugin-inventory-handler.json', import.meta.url), 'utf8'));
const items = fixture.response.items;
const byName = name => items.find(item => item.name === name);

test('real inventory: only a native Claude or Codex flag yields plugged or unplugged', () => {
  assert.equal(plugState(byName('alpha-tools')).state, 'plugged');
  assert.equal(plugState(byName('beta-tools')).state, 'unplugged');
  assert.equal(plugState(byName('omega')).state, 'plugged');
  assert.equal(plugState(byName('sigma')).state, 'unplugged');
});

test('real inventory: missing flag, non-boolean source value and clients without native source are unknown', () => {
  for (const name of ['gamma-tools', 'delta-tools', 'epsilon-tools', 'ghost-tools@demo-market', 'tau']) {
    assert.equal(plugState(byName(name)).state, 'unknown', name);
    assert.equal(byName(name).enabled_in_client, null, name);
  }
  for (const name of ['gem-one', 'lib-plugin']) {
    const info = plugState(byName(name));
    assert.equal(info.state, 'unknown', name);
    assert.match(info.reason, /keine native Aktivierungsquelle/);
    assert.equal(info.source, 'keine native Quelle');
  }
});

test('a boolean from a client without native source is not trusted', () => {
  assert.equal(plugState({consumer: 'Gemini', enabled_in_client: true}).state, 'unknown');
  assert.equal(plugState({consumer: 'Host-Bibliothek', enabled_in_client: false}).state, 'unknown');
  assert.equal(plugState({enabled_in_client: true}).state, 'unknown');
});

test('invalid values are an error, never silently a state', () => {
  for (const flag of ['yes', 1, 0, 'true', {}, [], NaN]) {
    assert.equal(plugState({consumer: 'Claude', enabled_in_client: flag}).state, 'error', String(flag));
  }
  for (const bad of [null, undefined, 'x', 7, []]) assert.equal(plugState(bad).state, 'error');
});

test('the BACH socket flag is never read as activation', () => {
  const item = {consumer: 'Claude', enabled_in_client: null, is_plugged: true, cable_status: 'connected', led_color: 'var(--success)'};
  assert.equal(plugState(item).state, 'unknown');
  assert.equal(plugState({consumer: 'Claude', enabled_in_client: false, is_plugged: true}).state, 'unplugged');
});

test('every state carries a text headline, the source, the host note and the runtime caveat', () => {
  for (const state of PLUG_STATES) assert.ok(state);
  const seen = new Set();
  for (const item of items) {
    const info = plugState(item);
    seen.add(info.state);
    assert.ok(info.headline.length > 8 && info.reason && info.source && info.host);
    assert.match(info.runtime, /Laufzeit/);
  }
  assert.deepEqual([...seen].sort(), ['plugged', 'unknown', 'unplugged']);
  assert.match(plugState(byName('alpha-tools')).scope, /Benutzer-Scope/);
  assert.equal(plugState(byName('gem-one')).scope, null);
});

test('runtime is only reported when the client measured it', () => {
  assert.match(plugState({consumer: 'Claude', enabled_in_client: true}).runtime, /nicht gemessen/);
  assert.match(plugState({consumer: 'Claude', enabled_in_client: true, runtime_active: true}).runtime, /bestätigt aktiv/);
  assert.match(plugState({consumer: 'Claude', enabled_in_client: true, runtime_active: false}).runtime, /nicht aktiv gemeldet/);
});

test('summary and accessible text', () => {
  assert.deepEqual(plugSummary(items), {plugged: 2, unplugged: 2, unknown: 7, error: 0});
  assert.equal(plugSummaryText(items), 'Eingesteckt: 2 · Ausgesteckt: 2 · Unbekannt: 7');
  assert.match(plugSummaryText([{consumer: 'Claude', enabled_in_client: 3}]), /Nicht lesbar: 1/);
  assert.deepEqual(plugSummary(null), {plugged: 0, unplugged: 0, unknown: 0, error: 0});
  const text = plugAccessibleText('alpha-tools', plugState(byName('alpha-tools')), new Date('2026-10-10T12:00:00Z'));
  assert.match(text, /^alpha-tools Eingesteckt \(laut Client-Konfiguration\)\./);
  assert.match(text, /Quelle: Claude-Code-Einstellungen/);
  assert.match(text, /Host nicht angegeben/);
  assert.match(observedLabel('nonsense'), /unbekannt/);
  assert.match(observedLabel(new Date('2026-10-10T12:00:00Z')), /Stand der Antwort nicht angegeben/);
});

test('the fixture comes from the handler and carries no local environment marker', () => {
  assert.equal(fixture.response.schema, 'bach.capability-inventory.v1');
  assert.equal(fixture.response.kind, 'plugins');
  const raw = readFileSync(new URL('./fixtures/plugin-inventory-handler.json', import.meta.url), 'utf8');
  for (const banned of ['AppData', 'C:\\\\Users', 'OneDrive\\\\Desktop']) assert.ok(!raw.includes(banned), banned);
});

// Minimal DOM, enough for the cable element (no jsdom in this repo).
function fakeDocument() {
  const make = tag => ({tag, children: [], attributes: {}, dataset: {}, className: '', textContent: '',
    setAttribute(key, value) { this.attributes[key] = String(value); }, append(...nodes) { this.children.push(...nodes); }});
  return {createElement: make, createElementNS: (_ns, tag) => make(tag)};
}

test('the cable element exposes the state as text, aria-label and a hidden graphic', async () => {
  globalThis.document = fakeDocument();
  const {plugCableElement} = await import('../src/lib/plugin-plug-ui.mjs');
  const walk = (node, found = []) => { found.push(node); for (const child of node.children || []) walk(child, found); return found; };
  for (const [name, expected] of [['alpha-tools', 'plugged'], ['beta-tools', 'unplugged'], ['gamma-tools', 'unknown'], ['gem-one', 'unknown']]) {
    const element = plugCableElement(byName(name), new Date('2026-10-10T12:00:00Z'));
    assert.equal(element.dataset.state, expected);
    assert.match(element.attributes['aria-label'], new RegExp('^' + name));
    assert.ok(element.title.length > 10);
    const nodes = walk(element);
    const graphic = nodes.find(n => n.tag === 'svg');
    assert.equal(graphic.attributes['aria-hidden'], 'true');
    assert.ok(nodes.some(n => n.tag === 'strong' && n.textContent === plugState(byName(name)).headline));
    assert.ok(nodes.some(n => n.tag === 'details'), 'evidence is keyboard reachable via details/summary');
    assert.ok(nodes.some(n => n.tag === 'summary'));
    assert.ok(!nodes.some(n => n.tag === 'button' || n.tag === 'input'), 'read-only: no switch or button');
  }
  const broken = plugCableElement({consumer: 'Claude', enabled_in_client: 'yes', name: 'x'});
  assert.equal(broken.dataset.state, 'error');
  delete globalThis.document;
});
