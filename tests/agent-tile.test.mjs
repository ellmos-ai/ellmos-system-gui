// PB-5b (#3989): one agent tile for every render site of /agenten/running.
// Contract: same slots, same actions in the same order; unavailable actions stay visible, disabled, with a reason.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  TILE_ACTION_IDS, TILE_MENU_IDS, TILE_SLOTS, TILE_KINDS,
  createAgentTile, tileModelLines, tileStatusTone,
} from '../src/lib/agent-tile.mjs';

class Node {
  constructor(tag) { this.tag = tag; this.dataset = {}; this.attributes = {}; this.children = []; this.handlers = {}; this.className = ''; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, handler) { this.handlers[name] = handler; }
}
const doc = {createElement: tag => new Node(tag)};
const all = node => [node, ...node.children.flatMap(all)];
const text = node => all(node).map(n => n.textContent).join(' ');
const find = (node, predicate) => all(node).filter(predicate);

const SPECS = {
  'system-slot': {name: 'Buddha Chat', status: {label: 'Ready · Living', tone: 'ok'}, model: ['Modellbindung: qwen · ollama'],
    actions: {run: {label: 'Pausieren', onClick() {}}, edit: {label: 'Besetzung ändern', onClick() {}},
      chat: {href: '/chat?slot_id=buddha_chat'}, assign: {href: '/tasks?create=1&assign_slot=buddha_chat'}}},
  'system-profile': {name: 'Experte', status: {label: 'Pausiert', tone: 'idle'}, model: ['Modellbindung: qwen · ollama'],
    actions: {run: {label: 'Fortsetzen', tone: 'primary', onClick() {}}, edit: {label: 'Bearbeiten', onClick() {}}, chat: {href: '/chat?slot_id=x'}}},
  worker: {name: 'DeepSeek', status: {label: 'Living · Bereit', tone: 'ok'}, model: ['Modellbindung: deepseek · openrouter'],
    actions: {run: {label: 'Starten', onClick() {}}, edit: {onClick() {}}, delete: {onClick() {}}, pause: {onClick() {}}}},
  'worker-running': {name: 'Reviewer', status: {label: 'Running · bestätigt', tone: 'busy'}, task: 'Task #2217',
    actions: {run: {label: 'Pausieren', onClick() {}}, stop: {onClick() {}}, assign: {href: '/tasks'}}},
  talk: {name: 'ELLMOS-Talk', status: {label: 'Ready · Living', tone: 'ok'},
    actions: {edit: {label: 'Besetzung ändern', href: '#talk-slot'}, chat: {label: 'Funkgerät öffnen', onClick() {}}}},
  interface: {name: 'SmartHome', status: {label: 'Inaktiv', tone: 'idle'}, actions: {edit: {label: 'Besetzen', onClick() {}}}},
};

test('there are exactly the documented kinds, slots and actions', () => {
  assert.deepEqual(TILE_SLOTS, ['head', 'status', 'model', 'task', 'error', 'actions']);
  assert.deepEqual(TILE_ACTION_IDS, ['run', 'edit', 'chat', 'assign', 'more']);
  assert.deepEqual(TILE_MENU_IDS, ['pause', 'stop', 'handoff', 'decompose', 'delete']);
  assert.deepEqual(Object.keys(SPECS).sort(), [...TILE_KINDS].sort());
});

for (const [kind, spec] of Object.entries(SPECS)) {
  test(`${kind}: same slots in the same order`, () => {
    const tile = createAgentTile(doc, {kind, ...spec});
    assert.match(tile.className, /\bcore-agent-card\b/);
    assert.match(tile.className, /\bagent-tile\b/);
    assert.equal(tile.dataset.tileKind, kind);
    const slots = tile.children.map(child => child.dataset.slot).filter(slot => TILE_SLOTS.includes(slot));
    assert.deepEqual(slots, TILE_SLOTS);
  });

  test(`${kind}: same action list, none missing, none extra`, () => {
    const tile = createAgentTile(doc, {kind, ...spec});
    const footer = tile.children.find(child => child.dataset.slot === 'actions');
    assert.deepEqual(footer.children.map(child => child.dataset.action), TILE_ACTION_IDS);
    const menu = find(footer, node => node.dataset.menu === 'true')[0];
    assert.deepEqual(menu.children.filter(c => c.dataset.action).map(c => c.dataset.action), TILE_MENU_IDS);
  });

  test(`${kind}: every unavailable action is disabled with a reason, every available one is operable`, () => {
    const tile = createAgentTile(doc, {kind, ...spec});
    const actions = find(tile, node => node.dataset.action && node.dataset.action !== 'more');
    assert.equal(actions.length, TILE_ACTION_IDS.length - 1 + TILE_MENU_IDS.length);
    for (const action of actions) {
      if (action.attributes['aria-disabled'] === 'true') {
        assert.ok(action.title && action.title.length > 8, `${kind}/${action.dataset.action} has no reason`);
        assert.equal(action.handlers.click, undefined, 'a disabled action cannot be triggered');
        assert.equal(action.href, undefined);
        assert.equal(action.dataset.reason, action.title);
      } else {
        assert.ok(action.handlers.click || action.href, `${kind}/${action.dataset.action} is enabled but not operable`);
      }
    }
  });

  test(`${kind}: no emoji or pictograph in the tile`, () => {
    const tile = createAgentTile(doc, {kind, ...spec});
    assert.doesNotMatch(text(tile), /\p{Extended_Pictographic}/u);
  });
}

test('agent tiles use unambiguous action verbs (Starten, Fortsetzen, Pausieren) instead of An/Aus state labels', () => {
  for (const [kind, spec] of Object.entries(SPECS)) {
    const tile = createAgentTile(doc, {kind, ...spec});
    const run = find(tile, n => n.dataset.action === 'run')[0];
    assert.ok(['Starten', 'Fortsetzen', 'Pausieren'].some(verb => run.textContent.startsWith(verb)), `${kind} run label: ${run.textContent}`);
    assert.doesNotMatch(run.textContent, /^(An|Aus)\b/);
  }
  assert.doesNotMatch(page, /enabled \? 'An' : 'Aus'/);
});

test('the status badge carries the label and a tone; the error slot is empty unless there is something to say', () => {
  const tile = createAgentTile(doc, {kind: 'worker', ...SPECS.worker});
  const status = find(tile, n => n.className.split(' ').includes('agent-tile-status'))[0];
  assert.equal(status.textContent, 'Living · Bereit');
  assert.equal(status.dataset.tone, 'ok');
  const slot = tile.children.find(c => c.dataset.slot === 'error');
  assert.equal(slot.hidden, true);
  assert.equal(slot.children.length, 0);

  const failed = createAgentTile(doc, {kind: 'worker', ...SPECS.worker, status: {label: 'Fehler · Status prüfen', tone: 'error'},
    error: 'Zeitlimit für den Lauf erreicht'});
  const failedSlot = failed.children.find(c => c.dataset.slot === 'error');
  assert.equal(failedSlot.hidden, false);
  assert.match(text(failedSlot), /Zeitlimit für den Lauf erreicht/);
});

test('an error status without a reported reason still says that the reason is missing', () => {
  const tile = createAgentTile(doc, {kind: 'worker', ...SPECS.worker, status: {label: 'Fehler · Status prüfen', tone: 'error'}});
  const slot = tile.children.find(c => c.dataset.slot === 'error');
  assert.equal(slot.hidden, false);
  assert.match(text(slot), /Ursache.*nicht gemeldet/);
});

test('extra nodes and identifiers from the page stay on the tile', () => {
  const marker = new Node('p');
  const tile = createAgentTile(doc, {kind: 'worker-running', ...SPECS['worker-running'], data: {workerId: 'w1', appearanceWorker: 'w1'}, errorNodes: [marker]});
  assert.equal(tile.dataset.workerId, 'w1');
  assert.equal(tile.dataset.appearanceWorker, 'w1');
  assert.ok(all(tile).includes(marker));
  assert.equal(tile.children.find(c => c.dataset.slot === 'error').hidden, false);
});

test('model lines never present a stored resolved model as current', () => {
  const stale = {backend: 'ollama', model: 'A', resolved_model: 'B', runtime_verified: true, running: false};
  assert.deepEqual(tileModelLines(stale), ['Modellbindung: A']);
  assert.deepEqual(tileModelLines({...stale, running: true}), ['Modellbindung: A', 'Läuft mit: B']);
  assert.deepEqual(tileModelLines({backend: '', model: ''}), ['Modellbindung: Modell fehlt']);
  assert.deepEqual(tileModelLines({...stale, running: true, runtime_verified: false}), ['Modellbindung: A']);
});

test('status tones follow the status, never a stored running flag alone', () => {
  assert.equal(tileStatusTone({status: 'error'}), 'error');
  assert.equal(tileStatusTone({status: 'paused'}), 'idle');
  assert.equal(tileStatusTone({status: 'idle', runtime_verified: true, running: false}), 'ok');
  assert.equal(tileStatusTone({status: 'running', runtime_verified: true, running: true}), 'busy');
  assert.equal(tileStatusTone({status: 'running', runtime_verified: false, running: true}), 'unknown');
  assert.equal(tileStatusTone({}), 'unknown');
});

const page = readFileSync(new URL('../src/pages/agenten/running.astro', import.meta.url), 'utf8');

test('running.astro renders every agent tile through one component call', () => {
  assert.equal((page.match(/\.createAgentTile\(/g) || []).length, 1, 'exactly one place builds a tile');
  assert.doesNotMatch(page, /class="core-agent-card"/, 'no template string builds a tile');
  assert.doesNotMatch(page, /coreElement\('article',\s*undefined,\s*'core-agent-card'\)/, 'no DOM code builds a tile by hand');
  const sites = [...page.matchAll(/renderAgentTile\(/g)].length;
  assert.ok(sites >= 6, `definition plus five render sites expected, found ${sites}`);
  for (const source of ["'core'", "'worker'", "'talk'", "'interface'"]) assert.ok(page.includes(`renderAgentTile(`) && page.includes(source));
});
