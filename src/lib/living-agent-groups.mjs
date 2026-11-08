export const LIVING_AGENT_GROUP_ORDER = Object.freeze(['living', 'paused', 'disabled']);

export const LIVING_AGENT_GROUP_LABELS = Object.freeze({
  living: 'Living',
  paused: 'Pausiert',
  disabled: 'Deaktiviert',
});

export const LIVING_AGENT_GROUP_EMPTY_HINTS = Object.freeze({
  living: 'Keine aktiven Living-Agenten in diesem Bereich.',
  paused: 'Keine pausierten Agenten.',
  disabled: 'Keine deaktivierten Agenten.',
});

export function isAgentPaused(agent) {
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) return false;
  if (agent.pause_info && typeof agent.pause_info === 'object' && agent.pause_info.is_paused === true) {
    return true;
  }
  const status = typeof agent.status === 'string' ? agent.status.trim().toLowerCase() : '';
  return status === 'paused';
}

export function classifyLivingAgentGroup(agent) {
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
    return 'disabled';
  }
  if (agent.enabled === false) {
    return 'disabled';
  }
  const status = typeof agent.status === 'string' ? agent.status.trim().toLowerCase() : '';
  if (status === 'disabled' || status === 'expired' || status === 'deleted' || status === 'inactive') {
    return 'disabled';
  }
  if (isAgentPaused(agent)) {
    return 'paused';
  }
  if (agent.enabled === true) {
    return 'living';
  }
  return 'disabled';
}

export function classifyLivingAgentRecord(agent, source = 'core') {
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
    return 'disabled';
  }
  if (source === 'worker' && typeof agent.enabled !== 'boolean') {
    const status = typeof agent.status === 'string' ? agent.status.trim().toLowerCase() : '';
    const inferredEnabled = !['disabled', 'expired', 'deleted', 'inactive'].includes(status);
    return classifyLivingAgentGroup({ ...agent, enabled: inferredEnabled });
  }
  return classifyLivingAgentGroup(agent);
}

export function groupLivingAgents(items = [], selectAgent = (item) => item) {
  const buckets = new Map(
    LIVING_AGENT_GROUP_ORDER.map((id) => [
      id,
      {
        id,
        label: LIVING_AGENT_GROUP_LABELS[id],
        emptyHint: LIVING_AGENT_GROUP_EMPTY_HINTS[id],
        items: [],
      },
    ]),
  );

  if (Array.isArray(items)) {
    for (const item of items) {
      let agent = null;
      try {
        agent = typeof selectAgent === 'function' ? selectAgent(item) : item;
      } catch (_err) {
        agent = null;
      }
      const groupId = classifyLivingAgentGroup(agent);
      const bucket = buckets.get(groupId) || buckets.get('disabled');
      bucket.items.push(item);
    }
  }

  return LIVING_AGENT_GROUP_ORDER.map((id) => buckets.get(id));
}

export function unwrapLivingGroupSections(container) {
  if (!container || (!Array.isArray(container.children) && !container.children)) return;
  const children = [...(container.children || [])];
  for (const child of children) {
    if (child?.dataset?.livingGroupSection) {
      const grids = typeof child.querySelectorAll === 'function'
        ? [...child.querySelectorAll('[data-living-group-grid]')]
        : [];
      for (const grid of grids) {
        for (const card of [...(grid.children || [])]) {
          container.append(card);
        }
      }
      child.remove?.();
    }
  }
}

export function applyLivingGroupsToContainer(doc, container) {
  if (!doc?.createElement || !container?.children) return null;
  unwrapLivingGroupSections(container);

  const allChildren = [...container.children];
  const cards = allChildren.filter(
    (node) => !node?.dataset?.livingGroupSection && Boolean(node?.dataset?.livingGroup || node?.dataset?.agentTile),
  );
  if (cards.length === 0) return null;

  const staticNodes = allChildren.filter((node) => !cards.includes(node));
  const visibleCards = cards.filter((card) => !card.hidden);
  const hiddenCards = cards.filter((card) => card.hidden);

  const buckets = new Map(LIVING_AGENT_GROUP_ORDER.map((id) => [id, []]));
  for (const card of visibleCards) {
    const key = LIVING_AGENT_GROUP_ORDER.includes(card?.dataset?.livingGroup)
      ? card.dataset.livingGroup
      : 'disabled';
    buckets.get(key).push(card);
  }

  for (const id of LIVING_AGENT_GROUP_ORDER) {
    const label = LIVING_AGENT_GROUP_LABELS[id];
    const groupCards = buckets.get(id) || [];

    const section = doc.createElement('section');
    section.className = 'living-agent-group';
    section.dataset.livingGroupSection = id;
    section.dataset.agentOverviewGroup = `living-${id}`;
    section.setAttribute?.('aria-label', label);

    const header = doc.createElement('div');
    header.className = 'living-agent-group-header';

    const title = doc.createElement('h4');
    title.className = 'living-agent-group-title';
    title.textContent = label;

    const count = doc.createElement('span');
    count.className = 'badge living-agent-group-count';
    count.textContent = String(groupCards.length);

    header.append(title, count);
    section.append(header);

    if (groupCards.length > 0) {
      const grid = doc.createElement('div');
      grid.className = 'living-agent-group-grid';
      grid.dataset.livingGroupGrid = id;
      for (const card of groupCards) {
        grid.append(card);
      }
      section.append(grid);
    } else {
      const empty = doc.createElement('p');
      empty.className = 'living-agent-group-empty text-muted';
      empty.dataset.livingGroupEmpty = id;
      empty.textContent = LIVING_AGENT_GROUP_EMPTY_HINTS[id];
      section.append(empty);
    }

    container.append(section);
  }

  for (const card of hiddenCards) {
    container.append(card);
  }
  for (const node of staticNodes) {
    container.append(node);
  }

  return {
    living: buckets.get('living').length,
    paused: buckets.get('paused').length,
    disabled: buckets.get('disabled').length,
  };
}

export function applyLivingGroupsToContainers(doc, containers = []) {
  const results = [];
  for (const container of containers) {
    if (!container) continue;
    results.push(applyLivingGroupsToContainer(doc, container));
  }
  return results;
}
