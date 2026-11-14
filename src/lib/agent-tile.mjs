// PB-5b (#3989): the one agent tile. Every card on /agenten/running is built here, so every card has the same
// slots (head, status, model, task, error, actions) and the same actions in the same order. An action that is not
// available stays visible, disabled, and says why. No emoji: state is text plus a quiet indicator (CSS, data-tone).
// Only plain DOM calls (createElement, append, setAttribute, addEventListener, dataset, className, textContent) so the
// same code runs in the browser and in the fake DOMs of the tests.

export const TILE_KINDS = Object.freeze(['system-slot', 'system-profile', 'worker', 'worker-running', 'talk', 'interface']);
export const TILE_SLOTS = Object.freeze(['head', 'status', 'model', 'task', 'error', 'actions']);
export const TILE_ACTION_IDS = Object.freeze(['run', 'edit', 'chat', 'assign', 'more']);
export const TILE_MENU_IDS = Object.freeze(['pause', 'stop', 'handoff', 'decompose', 'delete']);

const KIND_LABELS = Object.freeze({
  'system-slot': 'Systemplatz',
  'system-profile': 'Systemprofil',
  worker: 'Hintergrundworker',
  'worker-running': 'Hintergrundworker',
  talk: 'Schnittstelle',
  interface: 'Schnittstelle',
});

const ACTION_DEFAULTS = Object.freeze({
  run: {label: 'Starten', reason: 'Starten und Pausieren ist für diesen Eintrag nicht vorgesehen'},
  edit: {label: 'Bearbeiten', reason: 'Bearbeiten ist für diesen Eintrag nicht verfügbar'},
  chat: {label: 'Chat öffnen', reason: 'Für diesen Eintrag ist kein Chat angebunden'},
  assign: {label: 'Zuweisen', ariaLabel: 'Aufgabe zuweisen', reason: 'Zuweisen setzt einen bestätigten Laufstatus voraus'},
  pause: {label: 'Pausieren', reason: 'Pausieren ist für diesen Eintrag nicht verfügbar'},
  stop: {label: 'Stoppen', reason: 'Stoppen ist für diesen Eintrag nicht verfügbar'},
  handoff: {label: 'Kontext übergeben', reason: 'Die Laufzeit bietet für diesen Eintrag keine Kontextübergabe an'},
  decompose: {label: 'Task zerlegen', reason: 'Die Laufzeit bietet für diesen Eintrag keine Zerlegung an'},
  delete: {label: 'Löschen', reason: 'Löschen ist für diesen Eintrag nicht verfügbar'},
});

const clean = value => typeof value === 'string' ? value.trim() : '';

export function tileModelLines(agent = {}) {
  const lines = [`Modellbindung: ${clean(agent.model) || 'Modell fehlt'}`];
  const resolved = clean(agent.resolved_model);
  // A stored resolved model describes an earlier run; it only counts while the run is confirmed.
  if (agent.runtime_verified === true && agent.running === true && resolved && resolved !== clean(agent.model))
    lines.push(`Läuft mit: ${resolved}`);
  const chain = Array.isArray(agent.model_fallbacks) ? agent.model_fallbacks : [];
  if (chain.length)
    lines.push('Fallbacks: ' + chain.map(item => `${item?.model || '?'}${item?.backend ? ' (' + item.backend + ')' : ''}`).join(' → '));
  return lines;
}

export function tileStatusTone(agent = {}) {
  const status = clean(agent.status).toLowerCase();
  if (status === 'error') return 'error';
  if (['paused', 'stopping', 'expired', 'deleted'].includes(status)) return 'idle';
  if (status === 'running') return agent.runtime_verified === true && agent.running === true ? 'busy' : 'unknown';
  if (status === 'starting') return 'busy';
  if (['idle', 'completed'].includes(status) && agent.runtime_verified === true) return 'ok';
  return 'unknown';
}

function el(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildAction(document, id, spec = {}) {
  const defaults = ACTION_DEFAULTS[id];
  const label = clean(spec.label) || defaults.label;
  const operable = spec.disabled !== true && (typeof spec.onClick === 'function' || typeof spec.href === 'string');
  const tone = spec.tone === 'primary' ? ' btn-primary' : spec.tone === 'danger' ? ' tile-danger' : '';
  let node;
  if (!operable) {
    node = el(document, 'button', 'btn btn-sm is-disabled' + tone, label);
    node.type = 'button';
    const reason = clean(spec.reason) || defaults.reason;
    node.setAttribute('aria-disabled', 'true');
    node.title = reason;
    node.dataset.reason = reason;
    const why = el(document, 'span', 'agent-tile-reason', ' (nicht verfügbar: ' + reason + ')');
    node.append(why);
  } else if (typeof spec.href === 'string' && spec.disabled !== true) {
    node = el(document, 'a', 'btn btn-sm' + tone, label);
    node.href = spec.href;
    if (typeof spec.onClick === 'function') node.addEventListener('click', spec.onClick);
  } else {
    node = el(document, 'button', 'btn btn-sm' + tone, label);
    node.type = 'button';
    node.addEventListener('click', spec.onClick);
  }
  if (spec.role === 'switch') {
    node.setAttribute('role', 'switch');
    node.setAttribute('aria-checked', String(spec.checked === true));
    node.dataset.checked = String(spec.checked === true);
  }
  const ariaLabel = spec.ariaLabel || defaults.ariaLabel;
  if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
  node.dataset.action = id;
  return node;
}

export function createAgentTile(document, spec = {}) {
  const kind = TILE_KINDS.includes(spec.kind) ? spec.kind : 'worker';
  const tile = el(document, 'article', 'core-agent-card agent-tile');
  tile.dataset.tileKind = kind;
  for (const [key, value] of Object.entries(spec.data || {})) if (value !== undefined && value !== null) tile.dataset[key] = String(value);

  const head = el(document, 'header', 'agent-tile-head');
  head.dataset.slot = 'head';
  if (spec.avatarNode) head.append(spec.avatarNode);
  const title = el(document, 'div', 'agent-tile-title');
  title.append(el(document, 'h3', 'agent-tile-name', clean(spec.name) || 'Unbenannt'));
  title.append(el(document, 'small', 'agent-tile-kind', clean(spec.kindLabel) || KIND_LABELS[kind]));
  head.append(title);
  if (spec.symbolNode) head.append(spec.symbolNode);
  tile.append(head);

  const statusSlot = el(document, 'div', 'agent-tile-statusline');
  statusSlot.dataset.slot = 'status';
  const status = spec.status || {};
  const badge = el(document, 'span', 'badge agent-tile-status', clean(status.label) || 'Status unbekannt');
  badge.dataset.tone = clean(status.tone) || 'unknown';
  statusSlot.append(badge);
  if (clean(spec.statusMeta)) statusSlot.append(el(document, 'small', 'agent-tile-statusmeta', clean(spec.statusMeta)));
  tile.append(statusSlot);

  const model = el(document, 'div', 'agent-tile-model');
  model.dataset.slot = 'model';
  const lines = Array.isArray(spec.model) ? spec.model.filter(Boolean) : [];
  if (!lines.length) lines.push('Kein Modell angebunden');
  lines.forEach((line, index) => model.append(el(document, index === 0 ? 'p' : 'small', index === 0 ? 'agent-tile-model-main' : 'agent-tile-model-note', line)));
  tile.append(model);

  const task = el(document, 'p', 'agent-tile-task', clean(spec.task) || 'Keine Aufgabe');
  task.dataset.slot = 'task';
  tile.append(task);

  const errorSlot = el(document, 'div', 'agent-tile-error');
  errorSlot.dataset.slot = 'error';
  errorSlot.setAttribute('role', 'status');
  const errorNodes = Array.isArray(spec.errorNodes) ? spec.errorNodes.filter(Boolean) : [];
  const statusIsError = clean(status.tone) === 'error';
  if (clean(spec.error)) errorSlot.append(el(document, 'p', 'agent-tile-error-text', clean(spec.error)));
  else if (statusIsError && !errorNodes.length)
    errorSlot.append(el(document, 'p', 'agent-tile-error-text', 'Ursache vom Backend nicht gemeldet. Details unter Rückgaben und Abbrüche.'));
  for (const node of errorNodes) errorSlot.append(node);
  errorSlot.hidden = errorSlot.children.length === 0;
  tile.append(errorSlot);

  const extraNodes = Array.isArray(spec.extraNodes) ? spec.extraNodes.filter(Boolean) : [];
  if (extraNodes.length) {
    const extra = el(document, 'div', 'agent-tile-extra');
    extra.dataset.slot = 'extra';
    extra.append(...extraNodes);
    tile.append(extra);
  }

  const footer = el(document, 'footer', 'agent-tile-actions core-actions');
  footer.dataset.slot = 'actions';
  const actions = spec.actions || {};
  for (const id of TILE_ACTION_IDS) {
    if (id !== 'more') { footer.append(buildAction(document, id, actions[id])); continue; }
    const more = el(document, 'details', 'agent-tile-more');
    more.dataset.action = 'more';
    more.append(el(document, 'summary', 'btn btn-sm', 'Mehr'));
    const menu = el(document, 'div', 'agent-tile-menu');
    menu.dataset.menu = 'true';
    for (const menuId of TILE_MENU_IDS) menu.append(buildAction(document, menuId, actions[menuId]));
    more.append(menu);
    footer.append(more);
  }
  tile.append(footer);
  return tile;
}
