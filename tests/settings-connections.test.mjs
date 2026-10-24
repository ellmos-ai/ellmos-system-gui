import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeBackendOrigin, setupSettingsTabs } from '../src/lib/settings-connections.mjs';

const verified = {
  schema: 'ellmos-system-gui.backend-origin.v1', mode: 'server', instance_label: 'Test backend',
  connection_verified: true, schema_verified: true, instance_verified: true, adapter_binding_verified: true,
  observed_at: '2026-10-21T12:00:00+00:00',
};

test('backend identification requires the exact schema, all four Boolean observations and a supported mode', () => {
  assert.equal(describeBackendOrigin(verified).verified, true);
  assert.match(describeBackendOrigin(verified).summary, /Server/);
  assert.match(describeBackendOrigin({ ...verified, mode: 'local' }).summary, /Lokal/);
  for (const field of ['connection_verified', 'schema_verified', 'instance_verified', 'adapter_binding_verified']) {
    for (const value of [undefined, null, false, 'true', 1]) {
      const state = describeBackendOrigin({ ...verified, [field]: value });
      assert.equal(state.verified, false, field + ': ' + value);
      assert.equal(state.instance, 'Instanz noch nicht bestätigt');
    }
  }
  for (const data of [null, undefined, [], 'server', {}, { ...verified, schema: 'unknown' }, { ...verified, mode: 'unknown' }]) {
    assert.equal(describeBackendOrigin(data).verified, false);
  }
});

test('unknown identities do not reuse a supplied instance label and missing timestamps stay unknown', () => {
  const unknown = describeBackendOrigin({ ...verified, instance_verified: false });
  assert.doesNotMatch(unknown.instance, /Test backend/);
  assert.match(describeBackendOrigin({ ...verified, observed_at: 'invalid' }).observed, /Noch kein/);
  assert.match(describeBackendOrigin({ ...verified, instance_label: 'a'.repeat(41) }).instance, /noch nicht/);
  assert.match(describeBackendOrigin(verified).observed, /2026-10-21/);
});

function harness(href = 'https://gui.invalid/settings') {
  const keys = ['connections', 'appearance', 'worker-policy', 'ocean-map', 'installer', 'learning', 'core'];
  let focused = null;
  function element(id, key) {
    const classes = new Set();
    return {
      id, dataset: { tab: key }, attributes: {}, listeners: {}, hidden: false,
      classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, listener) { this.listeners[name] = listener; },
      focus() { focused = id; },
    };
  }
  const buttons = keys.map(key => element('settings-tab-' + key, key));
  const panes = keys.map(key => element('pane-' + key, key));
  const history = [];
  const win = {
    location: { href }, listeners: {},
    history: { pushState(_state, _title, url) { history.push(String(url)); win.location.href = String(url); } },
    addEventListener(name, fn) { this.listeners[name] = fn; },
  };
  const doc = {
    querySelectorAll(selector) { return selector === '.tab-btn' ? buttons : panes; },
    getElementById(id) { return [...buttons, ...panes].find(el => el.id === id); },
  };
  setupSettingsTabs(doc, win);
  return { buttons, panes, win, history, focus: () => focused };
}

function assertSelected(h, key) {
  assert.deepEqual(h.buttons.filter(b => b.tabIndex === 0).map(b => b.dataset.tab), [key]);
  assert.deepEqual(h.buttons.filter(b => b.attributes['aria-selected'] === 'true').map(b => b.dataset.tab), [key]);
  assert.deepEqual(h.panes.filter(p => !p.hidden).map(p => p.id), ['pane-' + key]);
}

test('connections is the default and unknown URL tabs do not remove other query parameters', () => {
  for (const href of ['https://gui.invalid/settings', 'https://gui.invalid/settings?tab=unknown&keep=1#details']) {
    const h = harness(href); assertSelected(h, 'connections');
    assert.equal(h.win.location.href, href);
    assert.equal(h.history.length, 0);
  }
});

test('all existing sections can be opened through URL and clicks preserve URL context', () => {
  const h = harness('https://gui.invalid/settings?tab=appearance&keep=1#details');
  assertSelected(h, 'appearance');
  h.buttons.find(b => b.dataset.tab === 'worker-policy').listeners.click();
  assertSelected(h, 'worker-policy');
  const url = new URL(h.win.location.href);
  assert.equal(url.searchParams.get('tab'), 'worker-policy');
  assert.equal(url.searchParams.get('keep'), '1'); assert.equal(url.hash, '#details');
  assert.equal(h.focus(), null);
  h.buttons.find(b => b.dataset.tab === 'worker-policy').listeners.click();
  assert.equal(h.history.length, 1);
});

test('arrow, Home and End keys activate and focus one tab, with wraparound', () => {
  const h = harness();
  function key(index, value) {
    let prevented = false;
    h.buttons[index].listeners.keydown({ key: value, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  key(0, 'ArrowLeft'); assertSelected(h, 'core'); assert.equal(h.focus(), 'settings-tab-core');
  key(6, 'ArrowRight'); assertSelected(h, 'connections');
  key(0, 'End'); assertSelected(h, 'core');
  key(6, 'Home'); assertSelected(h, 'connections');
});

test('Back navigation restores selection without adding history or stealing focus', () => {
  const h = harness(); h.buttons[4].listeners.click();
  h.win.location.href = 'https://gui.invalid/settings'; h.win.listeners.popstate();
  assertSelected(h, 'connections'); assert.equal(h.history.length, 1); assert.equal(h.focus(), null);
});

test('settings keeps its existing routes and places one origin status in the connections panel', () => {
  const page = readFileSync(new URL('../src/pages/settings.astro', import.meta.url), 'utf8');
  for (const key of ['connections', 'ocean-map', 'installer', 'learning', 'appearance', 'worker-policy', 'core']) {
    assert.match(page, new RegExp('id="settings-tab-' + key + '"'));
    assert.match(page, new RegExp('id="pane-' + key + '"'));
  }
  assert.equal((page.match(/id="backend-origin-status"/g) || []).length, 1);
  assert.match(page, /fetch\('\/api\/gui\/backend-origin', \{ cache: 'no-store', signal: controller.signal \}\)/);
  assert.match(page, /window.location.origin/);
  assert.match(page, /href="\/token-dashboard"/);
  assert.match(page, /Betriebssystemzugriffe sind hier nicht geprüft/);
  assert.match(page, /outline: 2px solid var\(--accent\)/);
});
