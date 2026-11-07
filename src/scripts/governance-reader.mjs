// SPDX-License-Identifier: MIT
// Shared read-only client of the governance pages (Control Room, Regeln, Sperren). Every function works on the elements
// that exist on the page and ignores the rest, so each sub route mounts only the parts it shows.
import {readTab, registryQuery, effectiveQuery, describeFailure, ageLabel, viewState, writerNotice, nextTabIndex, decisionsView, classifyBody, BODY_PROBLEM,
  parseStatus, parseLocks, parseDecisions, parsePolicies, parseRegistry, parseEffective, parseCapabilities} from '../lib/governance-readers.mjs';
import {createGovernanceRequest} from '../lib/governance-request.mjs';

const UNKNOWN = 'unbekannt';
const READERS = {
  locks: {title: 'Locks (Lock-Scan-Cache)', url: () => '/api/governance/locks', parse: parseLocks},
  decisions: {title: 'Entscheidungen (Registry-Zeiger)', url: () => '/api/governance/decisions', parse: parseDecisions},
  policies: {title: 'Policies und Regeln (Registry-Zeiger)', url: () => '/api/governance/policies', parse: parsePolicies},
  registry: {title: 'Policy-Registry', filters: true, parse: parseRegistry,
    url: f => '/api/governance/policy-registry?' + registryQuery(f)},
  effective: {title: 'Wirksame Policy (Einzelauflösung)', filters: true, parse: parseEffective,
    url: f => '/api/governance/effective-policy?' + effectiveQuery(f)},
};
const ENTRY_COLUMNS = [['id', 'id'], ['kind', 'kind'], ['title', 'title'], ['scope', 'scope'], ['version', 'version'],
  ['status', 'status'], ['adoption', 'adoption'], ['privacy', 'privacy'], ['sourceState', 'Quellenprüfung'], ['enforcementVerified', 'Durchsetzung']];
const $ = id => document.getElementById(id);
const el = id => $(id) ?? document.createElement('div'); // absent on this page: writes go nowhere

const show = value => value === null || value === undefined || value === '' ? UNKNOWN : String(value);
const add = (parent, tag, content, attrs = {}) => {
  const node = document.createElement(tag);
  node.textContent = content;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
};

function renderMeta(model) {
  const meta = $('gov-meta');
  meta.replaceChildren();
  const rows = [
    ['Quelle', model.source ? model.source + (model.providerId ? ' (' + model.providerId + ')' : '') : UNKNOWN],
    ['Host', UNKNOWN + ' (liefert die Antwort nicht)'],
    ['Version', show(model.version)],
    ['Schema', show(model.schema)],
    ['Verfügbarkeit', show(model.availability) + (model.error ? ' · ' + model.error : '')],
    ['Stand', show(model.observedAt) + ' (' + ageLabel(model.observedAt) + ')'],
  ];
  if (model.scannedAt !== null) rows.push(['Scan', show(model.scannedAt) + ' (' + ageLabel(model.scannedAt) + ')']);
  if (model.kind !== 'locks') {
    rows.push(['Zugriff laut Antwort', model.readOnly === true ? 'nur lesend (read_only)' : model.readOnly === false ? 'nicht nur lesend (read_only=false)' : UNKNOWN]);
    rows.push(['Registry-Version', show(model.registryVersion)]);
    rows.push(['Durchsetzung', model.enforcementVerified ? 'verifiziert' : 'Durchsetzung nicht verifiziert']);
    rows.push(['Quellenprüfung', model.sourceVerificationComplete ? 'vollständig' : 'nicht vollständig']);
  }
  for (const [name, value] of rows) { add(meta, 'dt', name); add(meta, 'dd', value); }
}

function renderNotices(model) {
  const list = $('gov-notices');
  list.replaceChildren();
  if (model.kind === 'locks') return;
  add(list, 'li', writerNotice(model));
  if (!model.consumersProjected)
    add(list, 'li', 'Geltung je Agent nicht verfügbar: Die Registry-Projektion enthält kein consumers-Feld (#2026).');
  if (model.kind === 'effective') {
    add(list, 'li', 'effective.selected ist eine Einzelauflösung, nicht der gesamte wirksame Regelsatz.');
    const eff = model.effective;
    add(list, 'li', 'Auflösung: status ' + show(eff.status) + ' · Grund ' + show(eff.reason) + ' · Modus ' + show(eff.interactionMode) +
      ' (' + show(eff.interactionSource) + ') · Kandidaten: ' + (eff.candidateIds.length ? eff.candidateIds.join(', ') : 'keine'));
  }
}

function table(columns, rows) {
  const el = document.createElement('table');
  el.className = 'gov-table';
  const head = add(el, 'thead', '').appendChild(document.createElement('tr'));
  for (const [, label] of columns) add(head, 'th', label, {scope: 'col'});
  const body = add(el, 'tbody', '');
  for (const row of rows) {
    const tr = add(body, 'tr', '');
    for (const [key] of columns) {
      const value = row[key];
      add(tr, 'td', typeof value === 'boolean' ? (value ? 'verifiziert' : 'nicht verifiziert') : show(value));
    }
  }
  return el;
}

function renderRows(model) {
  const target = $('gov-rows');
  target.replaceChildren();
  if (model.kind === 'locks') {
    target.appendChild(table([['name', 'Lock'], ['scope', 'Scope'], ['type', 'Typ'], ['status', 'Status']], model.rows));
  } else if (model.kind === 'effective') {
    const selected = model.effective.selected;
    add(target, 'h3', 'Ausgewählte Einzelpolicy (effective.selected)');
    if (selected) target.appendChild(table(ENTRY_COLUMNS, [selected]));
    else add(target, 'p', 'Keine Einzelpolicy ausgewählt.');
    add(target, 'h3', 'Treffer im Scope (entries)');
    target.appendChild(table(ENTRY_COLUMNS, model.rows));
  } else {
    target.appendChild(table(ENTRY_COLUMNS, model.rows));
  }
}

const STATE_TEXT = {
  ok: model => model.rows.length + ' Einträge',
  empty: () => 'Quelle verfügbar, aber leer. Das ist keine Aussage über Freigaben oder Sperren.',
  stale: () => 'Quelle veraltet: Stand nicht belastbar.',
  unavailable: () => 'Quelle nicht verfügbar: Zustand unbekannt.',
};

function rawView(detailsId, preId) {
  let payload = null;
  const details = $(detailsId), pre = $(preId);
  details.addEventListener('toggle', () => {
    if (details.open && payload !== null) pre.textContent = JSON.stringify(payload, null, 2);
  });
  return value => {
    payload = value; details.hidden = value === null; details.open = false;
    pre.textContent = '';
  };
}

const failureText = result => (result.failure?.label || result.label || 'Zustand unbekannt') +
  (result.failure?.detail ? ' · ' + result.failure.detail : '') +
  '. Es werden keine Ersatzdaten angezeigt.';

export {readTab};

// Tab links of one page (real links, Enter navigates); marks the selected one and moves with the arrow keys.
export function mountTablist(tab) {
  const tablist = $('gov-tablist');
  if (!tablist) return;
  for (const link of document.querySelectorAll('#gov-tablist [role="tab"]')) {
    const selected = link.dataset.tab === tab;
    link.setAttribute('aria-selected', String(selected));
    link.tabIndex = selected ? 0 : -1;
    if (selected) link.setAttribute('aria-current', 'page');
  }
  tablist.addEventListener('keydown', event => {
    const links = [...document.querySelectorAll('#gov-tablist [role="tab"]')];
    const next = nextTabIndex(event.key, links.indexOf(document.activeElement), links.length);
    if (next === null) return;
    event.preventDefault();
    links[next].focus();
  });
}

export function mountCapabilities() {
  const setCapRaw = rawView('gov-cap-response', 'gov-cap-json');
  const capRequest = createGovernanceRequest(result => {
    const state = $('gov-cap-state'), meta = $('gov-cap-meta');
    state.dataset.state = result.state; meta.replaceChildren(); setCapRaw(null);
    if (result.state === 'loading') { state.textContent = 'Capabilities werden gelesen …'; return; }
    if (!result.model) { state.textContent = failureText(result); return; }
    state.textContent = 'Capabilities-Antwort geladen; Laufzeit separat ausgewiesen.';
    const {kit, policy, observedAt} = result.model;
    const rows = [
      ['Beobachtet', show(observedAt)],
      ['Kit geprüft', show(kit.verified)],
      ['Kit-Version', show(kit.version)],
      ['Kit-Quellcommit', show(kit.revision)],
      ['Policy-Adapter registriert', show(policy?.adapter_registered)],
      ['Policy-Provider verfügbar', show(policy?.available)],
      ['Policy-Laufzeit verifiziert', show(policy?.runtime_verified)],
      ['Provider-Grundcode', show(policy?.reason_code)],
      ['Provider-Beobachtung', show(policy?.observed_at)],
    ];
    for (const [key, value] of rows) { add(meta, 'dt', key); add(meta, 'dd', value); }
    setCapRaw(result.payload);
  });
  function loadCapabilities() {
    return capRequest.load('/api/gui/capabilities', parseCapabilities,
      (_url, {signal}) => fetch('/api/gui/capabilities', {method:'GET', cache:'no-store', signal}), () => 'ok');
  }
  $('gov-cap-reload')?.addEventListener('click', loadCapabilities);
  loadCapabilities();
}

const STATUS_FAIL = 'Status nicht geladen: ';
export async function loadStatus() {
  const badge = el('governance-status-badge'), lockBadge = el('locks-count-badge'), decisionBadge = el('decisions-count-badge');
  const list = el('locks-list'), meta = el('gov-status-meta'), decisions = el('decisions-list');
  const failed = text => {
    badge.textContent = '● ' + text; lockBadge.textContent = 'Lock-Lage unbekannt';
    decisionBadge.textContent = 'Entscheidungen unbekannt';
    list.textContent = text + '. Es werden keine Ersatzdaten angezeigt.'; meta.textContent = '';
  };
  let response;
  try { response = await fetch('/api/governance/status', {method:'GET', cache:'no-store'}); } catch (_) { failed(STATUS_FAIL + describeFailure(0, null).label); return; }
  let raw = '';
  try { raw = await response.text(); } catch (_) { /* classified as empty below */ }
  const parsed = classifyBody(raw);
  if (!response.ok) { const f = describeFailure(response.status, parsed.value); failed(STATUS_FAIL + f.label + (f.detail ? ' · ' + f.detail : '')); return; }
  if (parsed.kind !== 'ok') { failed(STATUS_FAIL + BODY_PROBLEM[parsed.kind]); return; }
  const body = parsed.value;
  let model;
  try { model = parseStatus(body); } catch (error) { failed(STATUS_FAIL + error.message); return; }
  badge.textContent = model.availability === 'available'
    ? '● Lock-Feed verfügbar; Durchsetzung nicht geprüft' : '● Lock-Lage unbekannt (' + model.availability + ')';
  meta.textContent = 'Quelle: ' + show(model.source) + ' · Stand: ' + show(model.observedAt) + ' (' + ageLabel(model.observedAt) +
    ') · Scan: ' + show(model.scannedAt) + (model.scannedAt ? ' (' + ageLabel(model.scannedAt) + ')' : '') +
    ' · Host: ' + UNKNOWN + ' · Version: ' + UNKNOWN + ' · Zugriff laut Antwort: ' + UNKNOWN + ' (diese Ansicht schreibt nicht)' +
    (model.error ? ' · Fehler: ' + model.error : '') + ' · Durchsetzung ' + (model.enforcementVerified ? 'verifiziert' : 'nicht verifiziert');
  list.replaceChildren();
  if (model.availability === 'available' && model.lockCount !== null) {
    lockBadge.textContent = model.lockCount + ' Locks im Scan';
    for (const lock of model.locks) {
      const row = add(list, 'div', '');
      row.style.cssText = 'padding:0.75rem;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)';
      add(row, 'strong', lock.name);
      const scope = add(row, 'span', 'Scope: ' + show(lock.scope));
      scope.style.cssText = 'display:block;font-size:0.75rem;color:var(--text-muted)';
    }
    if (model.lockCount === 0) list.textContent = 'Keine Locks im letzten Scan. Schreibzugriff separat prüfen.';
  } else {
    lockBadge.textContent = 'Lock-Lage unbekannt';
    list.textContent = 'Kein gültiger, frischer Lock-Scan verfügbar.';
  }
  const label = decisions.querySelector('strong');
  const view = decisionsView(model);
  decisionBadge.textContent = view.label;
  if (label) label.textContent = view.state === 'unknown' ? 'Entscheidungsregister unbekannt'
    : view.state === 'empty' ? 'Keine Registerdateien gefunden' : 'Entscheidungsregister geladen';
}

// Reader panel of one tab (locks, decisions, policies, registry, effective).
export function mountReader(tab) {
  if (!READERS[tab]) return;
  const setReaderRaw = rawView('gov-response', 'gov-response-json');
  const readerRequest = createGovernanceRequest(result => {
    const state = $('gov-state');
    state.dataset.state = result.state;
    $('gov-meta').replaceChildren(); $('gov-notices').replaceChildren(); $('gov-rows').replaceChildren();
    setReaderRaw(null);
    if (result.state === 'loading') { state.textContent = 'Leseanfrage läuft …'; return; }
    if (result.state === 'idle') { state.textContent = ''; return; }
    if (!result.model) { state.textContent = failureText(result); return; }
    state.textContent = STATE_TEXT[result.state](result.model);
    renderMeta(result.model); renderNotices(result.model);
    if (result.state === 'ok' || result.state === 'empty') renderRows(result.model);
    setReaderRaw(result.payload);
  });
  async function load(reader, filters) {
    let url;
    try { url = reader.url(filters); } catch (error) {
      readerRequest.cancel();
      $('gov-state').dataset.state = 'error'; $('gov-state').textContent = error.message; return;
    }
    return readerRequest.load(url, reader.parse,
      (url, {signal}) => fetch(url, {method:'GET', cache:'no-store', signal}));
  }

  const reader = READERS[tab];
  if ($('gov-panel-status')) $('gov-panel-status').hidden = true;
  $('gov-panel-reader').hidden = false;
  $('gov-reader-title').textContent = reader.title;
  const form = $('gov-filters');
  form.hidden = !reader.filters;
  $('gov-kind-label').hidden = tab === 'effective';
  const params = new URLSearchParams(location.search);
  for (const name of ['scope', 'consumer', 'query', 'kind']) if (form.elements[name] && params.get(name)) form.elements[name].value = params.get(name);
  const run = () => load(reader, Object.fromEntries(new FormData(form).entries()));
  form.addEventListener('submit', event => { event.preventDefault(); run(); });
  $('gov-reload').addEventListener('click', run);
  // Effective policy needs a scope first; everything else loads at once.
  if (tab === 'effective' && !form.elements.scope.value) {
    $('gov-state').dataset.state = 'idle';
    $('gov-state').textContent = 'Scope eingeben und laden. Ohne scope wird nichts abgefragt.';
  } else run();
}
