import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LIVING_AGENT_GROUP_ORDER,
  LIVING_AGENT_GROUP_LABELS,
  isAgentPaused,
  classifyLivingAgentGroup,
  classifyLivingAgentRecord,
  groupLivingAgents,
  applyLivingGroupsToContainer,
  unwrapLivingGroupSections,
} from '../src/lib/living-agent-groups.mjs';

test('LIVING_AGENT_GROUP_ORDER enforces exact order: living, paused, disabled', () => {
  assert.deepEqual(LIVING_AGENT_GROUP_ORDER, ['living', 'paused', 'disabled']);
  assert.deepEqual(
    LIVING_AGENT_GROUP_ORDER.map((id) => LIVING_AGENT_GROUP_LABELS[id]),
    ['Living', 'Pausiert', 'Deaktiviert'],
  );
});

test('classifyLivingAgentGroup: enabled + not paused -> living', () => {
  assert.equal(classifyLivingAgentGroup({ enabled: true, status: 'idle' }), 'living');
  assert.equal(classifyLivingAgentGroup({ enabled: true, status: 'ready' }), 'living');
  assert.equal(classifyLivingAgentGroup({ enabled: true, status: 'completed' }), 'living');
  assert.equal(
    classifyLivingAgentGroup({ enabled: true, status: 'idle', pause_info: { is_paused: false } }),
    'living',
  );
});

test('classifyLivingAgentGroup: pause_info.is_paused or status "paused" -> paused', () => {
  assert.equal(
    classifyLivingAgentGroup({ enabled: true, status: 'idle', pause_info: { is_paused: true } }),
    'paused',
  );
  assert.equal(classifyLivingAgentGroup({ enabled: true, status: 'paused' }), 'paused');
  assert.equal(classifyLivingAgentGroup({ enabled: true, status: 'PAUSED' }), 'paused');
  assert.equal(classifyLivingAgentGroup({ pause_info: { is_paused: true } }), 'paused');
  assert.equal(classifyLivingAgentGroup({ status: 'paused' }), 'paused');
  assert.equal(isAgentPaused({ pause_info: { is_paused: true } }), true);
  assert.equal(isAgentPaused({ status: 'paused' }), true);
  assert.equal(isAgentPaused({ status: 'idle' }), false);
});

test('classifyLivingAgentGroup: enabled false/missing -> disabled', () => {
  assert.equal(classifyLivingAgentGroup({ enabled: false }), 'disabled');
  assert.equal(classifyLivingAgentGroup({ enabled: false, status: 'idle' }), 'disabled');
  assert.equal(classifyLivingAgentGroup({ enabled: false, status: 'paused' }), 'disabled');
  assert.equal(
    classifyLivingAgentGroup({ enabled: false, pause_info: { is_paused: true } }),
    'disabled',
  );
  assert.equal(classifyLivingAgentGroup({}), 'disabled');
  assert.equal(classifyLivingAgentGroup({ status: 'idle' }), 'disabled');
  assert.equal(classifyLivingAgentGroup({ enabled: true, status: 'disabled' }), 'disabled');
  assert.equal(classifyLivingAgentGroup({ enabled: true, status: 'expired' }), 'disabled');
  assert.equal(classifyLivingAgentGroup({ enabled: true, status: 'deleted' }), 'disabled');
});

test('classifyLivingAgentGroup: unknown/missing/non-object fields do not throw', () => {
  for (const input of [
    undefined,
    null,
    false,
    true,
    0,
    42,
    'agent',
    [],
    { enabled: 'yes', status: 123, pause_info: 'none' },
    { enabled: null, status: null, pause_info: null },
  ]) {
    assert.doesNotThrow(() => classifyLivingAgentGroup(input));
    assert.equal(classifyLivingAgentGroup(input), 'disabled');
  }
});

test('classifyLivingAgentRecord handles worker records without explicit enabled boolean', () => {
  assert.equal(classifyLivingAgentRecord({ id: 'w1', status: 'idle' }, 'worker'), 'living');
  assert.equal(classifyLivingAgentRecord({ id: 'w2', status: 'paused' }, 'worker'), 'paused');
  assert.equal(
    classifyLivingAgentRecord({ id: 'w3', status: 'idle', pause_info: { is_paused: true } }, 'worker'),
    'paused',
  );
  assert.equal(classifyLivingAgentRecord({ id: 'w4', status: 'expired' }, 'worker'), 'disabled');
  assert.equal(
    classifyLivingAgentRecord({ id: 'w5', status: 'idle', enabled: false }, 'worker'),
    'disabled',
  );
});

test('groupLivingAgents separates agents into Living, Pausiert, Deaktiviert in order', () => {
  const agents = [
    { id: 'disabled-1', enabled: false, status: 'idle' },
    { id: 'paused-1', enabled: true, status: 'paused' },
    { id: 'living-1', enabled: true, status: 'idle' },
    { id: 'paused-2', enabled: true, status: 'ready', pause_info: { is_paused: true } },
    { id: 'disabled-2' },
    { id: 'living-2', enabled: true, status: 'ready' },
  ];
  const groups = groupLivingAgents(agents);
  assert.deepEqual(
    groups.map((g) => ({ id: g.id, label: g.label, ids: g.items.map((a) => a.id) })),
    [
      { id: 'living', label: 'Living', ids: ['living-1', 'living-2'] },
      { id: 'paused', label: 'Pausiert', ids: ['paused-1', 'paused-2'] },
      { id: 'disabled', label: 'Deaktiviert', ids: ['disabled-1', 'disabled-2'] },
    ],
  );
});

function createFakeDoc() {
  function makeNode(tag) {
    return {
      tag,
      className: '',
      textContent: '',
      hidden: false,
      dataset: {},
      attributes: {},
      children: [],
      parentNode: null,
      setAttribute(k, v) {
        this.attributes[k] = String(v);
      },
      append(...nodes) {
        for (const node of nodes) {
          if (!node) continue;
          if (node.parentNode && Array.isArray(node.parentNode.children)) {
            const idx = node.parentNode.children.indexOf(node);
            if (idx >= 0) node.parentNode.children.splice(idx, 1);
          }
          node.parentNode = this;
          this.children.push(node);
        }
      },
      remove() {
        if (this.parentNode && Array.isArray(this.parentNode.children)) {
          const idx = this.parentNode.children.indexOf(this);
          if (idx >= 0) this.parentNode.children.splice(idx, 1);
        }
        this.parentNode = null;
      },
      querySelectorAll(selector) {
        if (selector === '[data-living-group-grid]') {
          return this.children.filter((c) => Boolean(c?.dataset?.livingGroupGrid));
        }
        return [];
      },
    };
  }
  return {
    createElement(tag) {
      return makeNode(tag);
    },
  };
}

test('applyLivingGroupsToContainer renders labelled sections and leaves empty groups out', () => {
  const doc = createFakeDoc();
  const container = doc.createElement('div');

  const cardLiving = doc.createElement('article');
  cardLiving.dataset.agentTile = 'core';
  cardLiving.dataset.livingGroup = 'living';

  const cardDisabled = doc.createElement('article');
  cardDisabled.dataset.agentTile = 'core';
  cardDisabled.dataset.livingGroup = 'disabled';

  const addButton = doc.createElement('button');
  addButton.className = 'btn core-slot-add';

  container.append(cardDisabled, cardLiving, addButton);

  const summary = applyLivingGroupsToContainer(doc, container);
  assert.deepEqual(summary, { living: 1, paused: 0, disabled: 1 });

  const sections = container.children.filter((c) => c.dataset?.livingGroupSection);
  assert.deepEqual(
    sections.map((s) => s.dataset.livingGroupSection),
    ['living', 'disabled'], // the paused group is empty and not rendered
  );
  assert.deepEqual(
    sections.map((s) => s.attributes['aria-label']),
    ['Living', 'Deaktiviert'],
  );

  // Static button stays at the end of container
  assert.equal(container.children.at(-1), addButton);

  // Unwrapping restores cards as direct children
  unwrapLivingGroupSections(container);
  assert.ok(container.children.includes(cardLiving));
  assert.ok(container.children.includes(cardDisabled));
});

test('running.astro wires LivingAgentGroups into ready containers and coreAgentLabel', () => {
  const runningSource = readFileSync(
    new URL('../src/pages/agenten/running.astro', import.meta.url),
    'utf8',
  );
  assert.match(runningSource, /import \* as LivingAgentGroups from '\.\.\/\.\.\/lib\/living-agent-groups\.mjs'/);
  assert.match(runningSource, /window\.BachLivingAgentGroups=LivingAgentGroups/);
  assert.match(runningSource, /if \(agent\.enabled !== true\) return 'Deaktiviert';/);
  assert.match(runningSource, /classifyLivingAgentRecord/);
  assert.match(runningSource, /applyLivingGroupsToContainers/);
});
