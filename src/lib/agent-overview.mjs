const ACCESS_LABELS = Object.freeze({
  local: 'Lokal',
  cloud: 'Cloud / API',
  prompt: 'Prompt / CLI',
  unknown: 'Unbekannt',
});

const DEFAULT_PREFERENCES = Object.freeze({
  access: 'all',
  function: 'all',
  start: 'all',
  query: '',
  sort: 'name',
  group: 'none',
  view: 'cards',
});

const ACCESS_VALUES = new Set(['all', 'local', 'cloud', 'prompt', 'unknown']);
const SORT_VALUES = new Set(['name', 'access', 'function', 'start', 'status']);
const GROUP_VALUES = new Set(['none', 'access', 'function', 'start']);
const VIEW_VALUES = new Set(['cards', 'list']);

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAgentOverviewPreferences(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const access = ACCESS_VALUES.has(input.access) ? input.access : DEFAULT_PREFERENCES.access;
  const functionId = cleanText(input.function);
  const start = input.start === 'unknown' ? 'unknown' : 'all';
  const sort = SORT_VALUES.has(input.sort) ? input.sort : DEFAULT_PREFERENCES.sort;
  const group = GROUP_VALUES.has(input.group) ? input.group : DEFAULT_PREFERENCES.group;
  const view = VIEW_VALUES.has(input.view) ? input.view : DEFAULT_PREFERENCES.view;
  return {
    access,
    function: functionId || 'all',
    start,
    query: cleanText(input.query).slice(0, 120),
    sort,
    group,
    view,
  };
}

export function readAgentOverviewPreferences(storage) {
  try {
    const source = storage === undefined ? globalThis.localStorage : storage;
    const raw = source?.getItem('bach.agent-overview.preferences.v1');
    return normalizeAgentOverviewPreferences(raw ? JSON.parse(raw) : {});
  } catch {
    return {...DEFAULT_PREFERENCES};
  }
}

export function writeAgentOverviewPreferences(value, storage) {
  const normalized = normalizeAgentOverviewPreferences(value);
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    target?.setItem('bach.agent-overview.preferences.v1', JSON.stringify(normalized));
  } catch {
    // Browser storage can be disabled; the in-memory controls still work.
  }
  return normalized;
}

function displayedAgentModel(agent) {
  return (isConfirmedAgentRunning(agent) ? cleanText(agent.resolved_model) : '')
    || cleanText(agent.model);
}

export function classifyAgentAccess(agent = {}) {
  const backend = cleanText(agent.backend).toLowerCase();
  const model = displayedAgentModel(agent).toLowerCase();
  if (backend === 'ollama' && model.endsWith(':cloud')) return 'cloud';
  if (['ollama', 'lmstudio'].includes(backend)) return 'local';
  if (['claude', 'codex'].includes(backend)) return 'prompt';
  if (['claude-api', 'ollama-cloud', 'openai', 'openrouter'].includes(backend)) return 'cloud';
  return 'unknown';
}

export function classifyAgentFunction(agent = {}, source = 'worker') {
  const explicit = cleanText(agent.system_function || agent.function || agent.role_id || agent.role);
  if (explicit) return {id: explicit.toLowerCase(), label: explicit};
  if (source === 'worker') return {id: 'background-worker', label: 'Hintergrundworker'};
  return {id: 'unknown', label: 'Funktion unbekannt'};
}

export function classifyActualStartType(_agent = {}) {
  // Current worker/core status contracts expose configured modes, not the actual start cause.
  return 'unknown';
}

export function isConfirmedAgentRunning(agent = {}) {
  return agent.runtime_verified === true && agent.running === true
    && !['starting', 'stopping'].includes(agent.status);
}

export function projectRunningSourceNotice(sources = [], emptyText = 'Kein Agentenlauf aktiv.') {
  const entries = Array.isArray(sources) ? sources : [];
  const hasConfirmedRun = entries.some(source => Number.isSafeInteger(source?.count) && source.count > 0);
  const loading = entries.some(source => source?.state === 'loading');
  const uncertain = entries.length === 0 || entries.some(source =>
    !Number.isSafeInteger(source?.count) || source.count < 0
      || !['available', 'loading'].includes(source?.state));

  if (loading) {
    return {
      hidden: false,
      text: hasConfirmedRun
        ? 'Bestätigte Läufe werden angezeigt; weitere Quellen werden geprüft…'
        : 'Aktive Läufe werden geprüft…',
    };
  }
  if (uncertain) {
    return {
      hidden: false,
      text: hasConfirmedRun
        ? 'Bestätigte Läufe werden angezeigt; weitere Laufzustände sind unvollständig oder nicht verfügbar.'
        : 'Laufstatus derzeit nicht vollständig bestätigt.',
    };
  }
  if (hasConfirmedRun) return {hidden: true, text: ''};
  return {hidden: false, text: emptyText};
}

export function workerActivityLabel(confirmedCount, statusUncertain = false) {
  const count = Number.isSafeInteger(confirmedCount) && confirmedCount >= 0
    ? confirmedCount
    : null;
  if (statusUncertain) {
    return count === null
      ? 'Aktive Workerzahl unbekannt (Running) · weitere Laufzustände unbestätigt'
      : `${count} bestätigt aktiv (Running) · weitere Laufzustände unbestätigt`;
  }
  return count === null ? 'Aktive Workerzahl unbekannt (Running)' : `${count} aktiv (Running)`;
}

export function createAgentOverviewContent(document, agent = {}, {
  source = 'worker',
  statusLabel = 'Status unbekannt',
  avatarNode = null,
  symbolNode = null,
} = {}) {
  const content = document.createElement('div');
  content.className = 'agent-overview-runtime-content';
  const identity = document.createElement('div');
  identity.className = 'agent-overview-runtime-identity';
  if (avatarNode) {
    avatarNode.className = `${cleanText(avatarNode.className)} agent-overview-runtime-avatar`.trim();
    identity.append(avatarNode);
  }
  const title = document.createElement('h3');
  title.className = 'agent-overview-runtime-title';
  title.textContent = cleanText(agent.name || agent.id) || 'Unbenannt';
  identity.append(title);
  if (symbolNode) {
    symbolNode.className = `${cleanText(symbolNode.className)} agent-overview-runtime-symbol`.trim();
    identity.append(symbolNode);
  }
  const status = document.createElement('span');
  status.className = 'badge agent-overview-runtime-status';
  status.textContent = cleanText(statusLabel) || 'Status unbekannt';
  identity.append(status);
  content.append(identity);

  const functionFacet = classifyAgentFunction(agent, source);
  const accessLabel = ACCESS_LABELS[classifyAgentAccess(agent)];
  const model = displayedAgentModel(agent) || 'unbekannt';
  const details = document.createElement('div');
  details.className = 'agent-overview-runtime-meta';
  const fields = [
    ['ID', cleanText(agent.id) || 'unbekannt'],
    ['Zugang / Funktion', `${accessLabel} · ${functionFacet.label}`],
    ['Modell', model],
    ['Tatsächliche Startart', 'unbekannt'],
  ];
  if (Number.isSafeInteger(agent.task_id) && agent.task_id > 0)
    fields.push(['Task', `#${agent.task_id}`]);
  if (agent.runtime_verified === true && cleanText(agent.current_tool))
    fields.push(['Aktuelles Werkzeug', cleanText(agent.current_tool)]);
  if (Number.isSafeInteger(agent.tool_round) && agent.tool_round >= 0)
    fields.push(['Runde', String(agent.tool_round)]);
  if (Number.isSafeInteger(agent.max_tool_rounds) && agent.max_tool_rounds >= 0)
    fields.push(['Rundenbudget', agent.max_tool_rounds === 0 ? 'unbegrenzt' : String(agent.max_tool_rounds)]);
  if (cleanText(agent.current_activity)) fields.push(['Aktivität', cleanText(agent.current_activity)]);
  for (const [label, value] of fields) {
    const item = document.createElement('p');
    item.className = 'agent-overview-runtime-meta-item';
    item.textContent = `${label}: ${value}`;
    details.append(item);
  }
  content.append(details);
  return content;
}

function compareOverviewItems(left, right, sort) {
  const key = (item) => sort === 'access' ? item.accessLabel
    : sort === 'function' ? item.functionLabel
      : sort === 'start' ? item.startLabel
        : sort === 'status' ? item.status : item.name;
  return key(left).localeCompare(key(right), 'de-DE', {sensitivity: 'base'})
    || left.name.localeCompare(right.name, 'de-DE', {sensitivity: 'base'});
}

function groupOverviewItems(items, state) {
  if (state.group === 'none') return [{key:'all', label:'', items:[...items].sort((a,b)=>compareOverviewItems(a,b,state.sort))}];
  const groups = new Map();
  for (const item of items) {
    const key = state.group === 'access' ? item.access
      : state.group === 'function' ? item.function : item.start;
    const label = state.group === 'access' ? item.accessLabel
      : state.group === 'function' ? item.functionLabel : item.startLabel;
    if (!groups.has(key)) groups.set(key, {key, label, items:[]});
    groups.get(key).items.push(item);
  }
  return [...groups.values()]
    .sort((left,right)=>left.label.localeCompare(right.label,'de-DE',{sensitivity:'base'}))
    .map((group)=>({...group, items:group.items.sort((a,b)=>compareOverviewItems(a,b,state.sort))}));
}

export function projectAgentOverview(records, preferences = {}) {
  const state = normalizeAgentOverviewPreferences(preferences);
  const query = state.query.toLocaleLowerCase('de-DE');
  const projected = (Array.isArray(records) ? records : []).map((record) => {
    const agent = record?.agent && typeof record.agent === 'object' ? record.agent : record || {};
    const source = record?.source || 'worker';
    const functionFacet = classifyAgentFunction(agent, source);
    const access = classifyAgentAccess(agent);
    const start = classifyActualStartType(agent);
    return {
      record,
      agent,
      source,
      lane: record?.lane || (isConfirmedAgentRunning(agent) ? 'running' : 'ready'),
      access,
      accessLabel: ACCESS_LABELS[access],
      function: functionFacet.id,
      functionLabel: functionFacet.label,
      start,
      startLabel: 'Unbekannt',
      status: cleanText(agent.status).toLowerCase() || 'unknown',
      name: cleanText(agent.name || agent.id) || 'Unbenannt',
      search: [agent.name, agent.id, agent.backend, agent.model, agent.resolved_model, functionFacet.label]
        .map(cleanText).join(' ').toLocaleLowerCase('de-DE'),
    };
  });

  const items = projected.filter((item) => {
    if (state.access !== 'all' && item.access !== state.access) return false;
    if (state.function !== 'all' && item.function !== state.function) return false;
    if (state.start !== 'all' && item.start !== state.start) return false;
    return !query || item.search.includes(query);
  });

  const groups = groupOverviewItems(items, state);
  const ordered = groups.flatMap((group)=>group.items);
  return {state, items:ordered, groups, total: projected.length, visible: ordered.length};
}

export function decorateAgentOverviewCard(card, agent, {source = 'worker', lane} = {}) {
  if (!card?.dataset) return null;
  const functionFacet = classifyAgentFunction(agent, source);
  const access = classifyAgentAccess(agent);
  const start = classifyActualStartType(agent);
  card.dataset.agentOverviewCard = 'true';
  card.dataset.agentOverviewAccess = access;
  card.dataset.agentOverviewFunction = functionFacet.id;
  card.dataset.agentOverviewFunctionLabel = functionFacet.label;
  card.dataset.agentOverviewStart = start;
  card.dataset.agentOverviewStatus = cleanText(agent.status).toLowerCase() || 'unknown';
  card.dataset.agentOverviewName = cleanText(agent.name || agent.id) || 'Unbenannt';
  card.dataset.agentOverviewSearch = [agent.name, agent.id, agent.backend, agent.model, agent.resolved_model, functionFacet.label]
    .map(cleanText).join(' ').toLocaleLowerCase('de-DE');
  card.dataset.agentOverviewLane = lane || (isConfirmedAgentRunning(agent) ? 'running' : 'ready');
  card.dataset.agentOverviewSource = source;
  return card;
}

export function applyAgentOverviewToContainer(container, state, registeredCards = []) {
  if (!container) return {total: 0, visible: 0};
  const normalized = normalizeAgentOverviewPreferences(state);
  const cards = [...new Set(registeredCards)].filter(Boolean);
  const oldHeadings = [...container.querySelectorAll(':scope > [data-agent-overview-group]')];
  for (const heading of oldHeadings) heading.remove();
  const cardSet = new Set(cards);
  const staticNodes = [...container.children].filter((node) => !cardSet.has(node));
  const records = cards.map((card) => ({
    agent: {
      id: card.dataset.agentOverviewName,
      name: card.dataset.agentOverviewName,
      backend: card.dataset.agentOverviewAccess,
      status: card.dataset.agentOverviewStatus,
    },
    source: card.dataset.agentOverviewSource,
    lane: card.dataset.agentOverviewLane,
    access: card.dataset.agentOverviewAccess,
    accessLabel: ACCESS_LABELS[card.dataset.agentOverviewAccess] || ACCESS_LABELS.unknown,
    function: card.dataset.agentOverviewFunction,
    functionLabel: card.dataset.agentOverviewFunctionLabel,
    start: card.dataset.agentOverviewStart,
    startLabel: 'Unbekannt',
    status: card.dataset.agentOverviewStatus,
    name: card.dataset.agentOverviewName,
    search: card.dataset.agentOverviewSearch,
    card,
  }));
  const query = normalized.query.toLocaleLowerCase('de-DE');
  const visible = records.filter((record) =>
    (normalized.access === 'all' || record.access === normalized.access)
    && (normalized.function === 'all' || record.function === normalized.function)
    && (normalized.start === 'all' || record.start === normalized.start)
    && (!query || record.search.includes(query)));
  container.classList?.toggle('agent-overview-list', normalized.view === 'list');
  container.dataset.agentOverviewView = normalized.view;
  for (const card of cards) card.hidden = !visible.some((item) => item.card === card);

  const visibleGroups = groupOverviewItems(visible, normalized);
  for (const group of visibleGroups) {
    if (normalized.group !== 'none') {
      const heading = container.ownerDocument.createElement('h3');
      heading.className = 'agent-overview-group-heading';
      heading.dataset.agentOverviewGroup = group.key;
      heading.textContent = group.label;
      container.append(heading);
    }
    for (const item of group.items) container.append(item.card);
  }
  for (const item of records) if (!visible.includes(item)) container.append(item.card);
  for (const node of staticNodes) container.append(node);
  return {total: records.length, visible: visible.length};
}

export function createAgentOverviewController(root = globalThis.document, {storage, onRefresh} = {}) {
  const containers = new Map();
  const boundControls = new WeakSet();
  let state = readAgentOverviewPreferences(storage);

  function controls() {
    return typeof root?.querySelectorAll === 'function'
      ? [...root.querySelectorAll('[data-agent-overview-control]')]
      : [];
  }

  function controlFor(key) {
    return controls().find((control) => control.dataset?.agentOverviewControl === key) || null;
  }

  function refreshFunctionOptions() {
    const select = controlFor('function');
    if (!select || typeof select.replaceChildren !== 'function') return;
    const options = new Map();
    for (const cards of containers.values()) for (const card of cards) {
      const id = card.dataset?.agentOverviewFunction;
      const label = card.dataset?.agentOverviewFunctionLabel;
      if (id && label) options.set(id, label);
    }
    const document = root?.createElement ? root : root?.ownerDocument;
    if (typeof document?.createElement !== 'function') return;
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'Alle Funktionen';
    select.replaceChildren(allOption);
    for (const [id, label] of [...options].sort((left, right) => left[1].localeCompare(right[1], 'de-DE'))) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      select.append(option);
    }
    if (state.function !== 'all' && !options.has(state.function)) {
      const missingOption = document.createElement('option');
      missingOption.value = state.function;
      missingOption.textContent = state.function + ' · derzeit nicht beobachtet';
      select.append(missingOption);
    }
    select.value = state.function;
  }

  function refresh() {
    refreshFunctionOptions();
    let total = 0;
    let visible = 0;
    for (const [container, cards] of containers) {
      if (typeof container?.querySelectorAll !== 'function' || !container.dataset
          || !container.classList || !container.ownerDocument) continue;
      const result = applyAgentOverviewToContainer(container, state, cards);
      total += result.total;
      visible += result.visible;
    }
    const projection = {total, visible};
    onRefresh?.(projection);
    return projection;
  }

  function set(key, value) {
    state = normalizeAgentOverviewPreferences({...state, [key]: value});
    writeAgentOverviewPreferences(state, storage);
    return refresh();
  }

  function beginContainer(container) {
    if (container) containers.set(container, []);
    return container;
  }

  function register(container, card, agent, {source = 'worker', lane} = {}) {
    if (!container || !card) return null;
    decorateAgentOverviewCard(card, agent, {source, lane});
    const cards = containers.get(container) || [];
    if (!cards.includes(card)) cards.push(card);
    containers.set(container, cards);
    return card;
  }

  function bind() {
    state = readAgentOverviewPreferences(storage);
    for (const control of controls()) {
      const key = control.dataset?.agentOverviewControl;
      if (!['query','access','function','start','sort','group','view'].includes(key)) continue;
      control.value = state[key];
      if (boundControls.has(control)) continue;
      boundControls.add(control);
      control.addEventListener?.(key === 'query' ? 'input' : 'change', () => set(key, control.value));
    }
    return refresh();
  }

  return Object.freeze({
    beginContainer,
    register,
    bind,
    refresh,
    set,
    get state() { return {...state}; },
    get containers() { return new Map(containers); },
  });
}

export function summarizeAgentActivity(workersData, coreData) {
  if (!workersData || workersData.schema !== 'bach.workers.status.v1'
      || workersData.availability !== 'available' || !Array.isArray(workersData.workers)
      || !coreData || coreData.schema !== 'bach.core-system-agents.v1' || !Array.isArray(coreData.agents)) {
    return {available: false, complete: false, active: [], total: null};
  }
  const records = [
    ...workersData.workers.filter((agent) => agent && agent.system !== true).map((agent) => ({agent, source:'worker'})),
    ...coreData.agents.filter((agent) => agent && typeof agent === 'object').map((agent) => ({agent, source:'core'})),
  ];
  const complete = records.every(({agent}) => agent.runtime_verified === true && typeof agent.running === 'boolean'
    && !['starting', 'stopping'].includes(agent.status));
  const active = records.filter(({agent}) => isConfirmedAgentRunning(agent));
  return {available: true, complete, active, total: records.length};
}

export function agentOverviewAccessLabels() {
  return {...ACCESS_LABELS};
}

export function agentOverviewDefaults() {
  return {...DEFAULT_PREFERENCES};
}
