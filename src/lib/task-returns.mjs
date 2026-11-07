// SPDX-License-Identifier: MIT
// PB-4 (#3988): show aborts where people look. A "return" is a worker giving a task back without a result.
// Data: GET /api/task-returns?ids=…, GET /api/task-returns/timeline, worker.precondition_wait, provider terminal_reason.
// Read only. Reasons are mapped to plain sentences with a next step; the raw code stays in the title and detail.

export const WINDOWS = [
  {hours: 24, label: '24 Stunden'},
  {hours: 168, label: '7 Tage'},
  {hours: 720, label: '30 Tage'},
];
const MAX_IDS = 200;
const TIMELINE_LIMIT = 200;
const isInt = value => Number.isSafeInteger(value) && value >= 0;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const HOST = {
  twin_status_unknown: ['Sperrstatus des BACH-Zwillings unbekannt',
    'Auf dem Mac sind OneDrive-Platzhalterdateien (REPO.pointer.json) nicht heruntergeladen. Im Finder „Immer auf diesem Gerät behalten“ wählen. Der Worker wartet und prüft selbst erneut.'],
  canonical_twin_unconfirmed: ['Hauptordner von BACH nicht bestätigt',
    'Der Sperrscanner konnte den kanonischen BACH-Ordner nicht zuordnen. Zwillingsindex und Pointer-Dateien prüfen.'],
  lock_scanner_unavailable: ['Sperrscanner nicht verfügbar',
    'Der Scanner fehlt oder ist nicht konfiguriert. Pfad der Lock-Werkzeuge auf dem Host prüfen.'],
  lock_scan_failed: ['Sperrscan fehlgeschlagen', 'Der Scan lieferte keine lesbare Ausgabe. Log des Dienstes prüfen.'],
  lock_scan_incomplete: ['Sperrscan unvollständig',
    'Nicht alle Unterordner konnten gelesen werden. Solange gilt der Bereich als gesperrt.'],
  project_lock: ['Projektsperre blockiert den Arbeitsbereich',
    'Eine fremde oder unbekannte LOCK-Datei liegt im Projekt. Mit dem Besitzer klären oder nach Ablauf entfernen lassen.'],
};
const FIXED = {
  task_scope_unavailable: ['task', 'Arbeitsumgebung der Aufgabe nicht bereit',
    'Für diese Aufgabe konnte kein Arbeitsbaum angelegt werden. Aufgabe prüfen oder einem Agenten mit Schreibrechten geben.'],
  worker_returned_open: ['task', 'Worker hat die Aufgabe unerledigt zurückgegeben',
    'Der Worker hat aufgehört, ohne ein Ergebnis abzugeben. Den Verlauf der Aufgabe lesen.'],
  write_grant_denied: ['task', 'Schreibfreigabe fehlt',
    'Der Worker durfte nichts schreiben. Schreibrechte des Workers prüfen oder die Aufgabe einem anderen Agenten geben.'],
  followup_without_progress: ['task', 'Folgeaufgabe ohne Fortschritt abgelehnt',
    'Der Worker wollte eine Rest-Aufgabe anlegen, ohne etwas erreicht zu haben. Die Aufgabe selbst klären.'],
  quota_exceeded: ['provider', 'Anbieter-Kontingent erschöpft', 'Kontingent abwarten oder dem Worker ein anderes Modell geben.'],
  cloud_call_retry_exhausted: ['provider', 'Cloud-Aufruf nach mehreren Versuchen aufgegeben',
    'Anbieter und Netzwerkverbindung des Workers prüfen.'],
};
const REPEATED = 'repeated_return:';
const HOST_PREFIX = 'host_precondition:';

/** @returns {{code:string,title:string,hint:string,scope:'host'|'task'|'provider'|'unknown'}} */
export function describeReason(code) {
  const raw = typeof code === 'string' ? code.trim() : '';
  if (!raw) return {code: '', title: 'Ohne Angabe', hint: 'Der Worker hat keinen Grund genannt.', scope: 'unknown'};
  if (raw.startsWith(REPEATED)) {
    const inner = describeReason(raw.slice(REPEATED.length));
    return {code: raw, scope: 'task', title: 'Nach wiederholter Rückgabe blockiert',
      hint: `Die Aufgabe wurde mehrfach aus demselben Grund zurückgegeben (${inner.title}) und deshalb gestoppt. Die Auflöser-Aufgabe nennt die Belege. ${inner.hint}`};
  }
  if (raw.startsWith(HOST_PREFIX)) {
    const entry = HOST[raw.slice(HOST_PREFIX.length)];
    return {code: raw, scope: 'host', title: entry ? entry[0] : `Voraussetzung des Hosts fehlt (${raw.slice(HOST_PREFIX.length)})`,
      hint: entry ? entry[1] : 'Der Host erfüllt eine Voraussetzung nicht. Das betrifft alle Aufgaben, nicht nur diese.'};
  }
  if (raw.startsWith('capability_missing:'))
    return {code: raw, scope: 'task', title: `Dem Worker fehlt eine Berechtigung (${raw.slice(19)})`,
      hint: 'Aufgabe von einem Worker bearbeiten lassen, der dieses Werkzeug nutzen darf.'};
  if (raw.startsWith('model_failure:'))
    return {code: raw, scope: 'provider', title: `Modellaufruf fehlgeschlagen (${raw.slice(14)})`,
      hint: 'Anbieter, Modell und Kontingent des Workers prüfen.'};
  const fixed = FIXED[raw] || FIXED[raw.split(':')[0]];
  if (fixed) return {code: raw, scope: fixed[0], title: fixed[1], hint: fixed[2]};
  return {code: raw, scope: 'unknown', title: 'Unbekannter Grund', hint: `Der Grund „${raw}“ ist hier nicht beschrieben. Den Rohcode an den Betrieb weitergeben.`};
}

const TERMINAL = {
  worker_stop: 'Vom Nutzer oder System gestoppt',
  total_deadline: 'Zeitlimit für den Lauf erreicht',
  httpx_read_timeout: 'Anbieter hat zu lange nicht geantwortet',
  provider_error: 'Anbieter meldete einen Fehler',
  backend_error: 'Backend meldete einen Fehler',
  backend_returned: 'Backend hat die Aufgabe zurückgegeben',
  runtime_cancelled: 'Lauf wurde abgebrochen',
  dispatch_rejected: 'Aufruf wurde nicht zugelassen',
};
/** Plain sentence for the terminal reason of a provider request; '' when nothing went wrong. */
export function terminalReasonText(code) {
  if (typeof code !== 'string' || !code || code === 'response_completed') return '';
  return TERMINAL[code] || `Abbruchgrund: ${code}`;
}

const validSummary = s => isObject(s) && s.available === true && isInt(s.return_count) && typeof s.flapping === 'boolean'
  && (s.last_return_reason === null || typeof s.last_return_reason === 'string');

/** Badge model for a task, or null when there is nothing to warn about (fewer than two returns, no kernel data). */
export function returnBadge(summary, task = {}) {
  if (!validSummary(summary)) return null;
  const blocked = String(task?.status || '').toLowerCase() === 'blocked';
  const count = summary.return_count;
  if (count < 2 && !summary.flapping && !(blocked && count >= 1)) return null;
  const level = summary.flapping || blocked ? 'critical' : 'warn';
  const label = `${count}× zurückgegeben${summary.flapping ? ' · wechselt hin und her' : blocked ? ' · blockiert' : ''}`;
  return {level, label, count, flapping: summary.flapping, blocked, reason: describeReason(summary.last_return_reason),
    lastAt: summary.last_return_at || null, identical: isInt(summary.consecutive_identical) ? summary.consecutive_identical : null};
}

/** Worker that takes no new lease until a host precondition holds (BACH precondition_wait). */
export function waitingModel(worker, now = Date.now()) {
  const wait = worker?.precondition_wait;
  if (!isObject(wait) || wait.state !== 'waiting_precondition' || typeof wait.code !== 'string' || !isInt(wait.attempt)) return null;
  const reason = describeReason(HOST_PREFIX + wait.code);
  const due = Date.parse(wait.next_check_at);
  const minutes = Math.round((due - now) / 60000);
  const next = !Number.isFinite(due) ? 'Zeitpunkt unbekannt' : due <= now ? 'Prüfung fällig'
    : minutes < 1 ? 'nächste Prüfung in unter 1 min' : `nächste Prüfung in ${minutes} min`;
  return {headline: `Wartet auf Voraussetzung: ${reason.title}`, detail: `Versuch ${wait.attempt} · ${next}`, hint: reason.hint, code: wait.code};
}

async function readJson(fetchImpl, url, what) {
  let response;
  try { response = await fetchImpl(url, {redirect: 'error'}); } catch { throw new Error(`${what} nicht verfügbar.`); }
  if (!response.ok) throw new Error(`${what} nicht verfügbar (HTTP ${response.status}).`);
  try { return await response.json(); } catch { throw new Error(`${what} nicht lesbar.`); }
}

/** @returns {{byId: Map<number, object>, error: string|null}} summaries for the given task ids (batches of 200). */
export async function loadTaskReturns(ids, fetchImpl = fetch) {
  const byId = new Map();
  const unique = [...new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0))];
  let error = null;
  for (let i = 0; i < unique.length; i += MAX_IDS) {
    try {
      const data = await readJson(fetchImpl, '/api/task-returns?ids=' + unique.slice(i, i + MAX_IDS).join(','), 'Rückgabezähler');
      if (!isObject(data?.tasks)) throw new Error('Rückgabezähler nicht bestätigt.');
      for (const [id, summary] of Object.entries(data.tasks)) if (validSummary(summary)) byId.set(Number(id), summary);
    } catch (failure) { error = failure.message; }
  }
  return {byId, error};
}

const validEvent = e => isObject(e) && Number.isSafeInteger(e.task_id) && e.task_id > 0 && typeof e.at === 'string'
  && typeof e.worker === 'string' && typeof e.reason === 'string' && typeof e.task_title === 'string';

export async function loadReturnTimeline({hours = 24, taskId = null} = {}, fetchImpl = fetch) {
  if (!WINDOWS.some(w => w.hours === hours)) throw new Error('Ungültiges Zeitfenster.');
  const query = `hours=${hours}&limit=${TIMELINE_LIMIT}` + (taskId ? `&task_id=${Number(taskId)}` : '');
  const data = await readJson(fetchImpl, '/api/task-returns/timeline?' + query, 'Zeitleiste');
  if (data?.schema !== 'bach.task-return-timeline.v1' || data.hours !== hours || !isInt(data.total)
      || typeof data.truncated !== 'boolean' || !Array.isArray(data.events) || !data.events.every(validEvent)
      || !isObject(data.by_reason)) throw new Error('Zeitleiste nicht bestätigt.');
  return data;
}

export const filterEvents = (events, {worker = '', reason = ''} = {}) =>
  events.filter(e => (!worker || e.worker === worker) && (!reason || e.reason === reason));
export const optionsOf = (events, key) => [...new Set(events.map(e => e[key]).filter(Boolean))].sort();

const workerKey = value => String(value || '').split('@')[0];

/** Problem marker for a worker session whose worker gave tasks back in the window; null for everything else. */
export function sessionReturnMarker(row, events, hours) {
  if (row?.source !== 'worker' || typeof row.chat_id !== 'string' || !row.chat_id) return null;
  const mine = events.filter(e => workerKey(e.worker) === row.chat_id);
  if (!mine.length) return null;
  const tally = new Map();
  for (const e of mine) tally.set(e.reason, (tally.get(e.reason) || 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const windowLabel = (WINDOWS.find(w => w.hours === hours) || WINDOWS[0]).label;
  return {count: mine.length, worker: mine[0].worker, reason: describeReason(top),
    label: `${mine.length} ${mine.length === 1 ? 'Rückgabe' : 'Rückgaben'} in ${windowLabel}`};
}

// ── DOM ───────────────────────────────────────────────────────────────────────────────────────
const el = (doc, tag, text, className) => {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
};
const stamp = value => {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date.toLocaleString('de-DE') : 'Zeit unbekannt';
};

/** Warning badge; the title carries reason, next step and raw code for hover and screen readers. */
export function renderBadge(doc, badge) {
  const node = el(doc, 'span', `⚠ ${badge.label}`, `badge return-badge ${badge.level === 'critical' ? 'badge-error' : 'badge-warning'}`);
  node.dataset.returnBadge = badge.level;
  node.title = `${badge.reason.title}. ${badge.reason.hint} (${badge.reason.code || 'kein Code'})`;
  return node;
}

/** Dashed box for a worker that takes no new lease until a host precondition holds. */
export function renderWaiting(doc, model) {
  const box = el(doc, 'div', undefined, 'worker-wait');
  box.dataset.workerWait = model.code;
  box.append(el(doc, 'p', model.headline, 'wait-headline'), el(doc, 'p', model.detail), el(doc, 'p', model.hint, 'wait-hint'));
  return box;
}

/** Detail block for one task: what happened last, what to do, raw values. */
export function renderReasonBlock(doc, container, badge, summary) {
  container.replaceChildren();
  if (!badge) { container.append(el(doc, 'p', 'Keine auffälligen Rückgaben.', 'muted')); return; }
  const box = el(doc, 'div', undefined, `return-block return-${badge.level}`);
  box.append(el(doc, 'p', badge.label, 'return-headline'));
  box.append(el(doc, 'p', badge.reason.title, 'return-reason'));
  box.append(el(doc, 'p', badge.reason.hint, 'return-hint'));
  if (badge.reason.scope === 'host')
    box.append(el(doc, 'p', 'Der Fehler liegt am Host, nicht an dieser Aufgabe. Sie wird deshalb nicht blockiert.', 'return-hint'));
  const facts = el(doc, 'dl', undefined, 'return-facts');
  for (const [name, value] of [['Zuletzt', badge.lastAt ? stamp(badge.lastAt) : 'unbekannt'],
    ['Gleiche Rückgaben in Folge', badge.identical ?? 'unbekannt'], ['Rohcode', badge.reason.code || 'keiner']]) {
    const term = el(doc, 'dt', name), def = el(doc, 'dd');
    def.append(name === 'Rohcode' ? el(doc, 'code', value) : doc.createTextNode(String(value)));
    facts.append(term, def);
  }
  box.append(facts);
  container.append(box);
}

/**
 * Timeline of returns. Root markup is in ReturnTimeline.astro:
 * [data-rt-window] [data-rt-worker] [data-rt-reason] selects, [data-rt-refresh], [data-rt-status], [data-rt-summary], [data-rt-body].
 * Optional root.dataset.taskId limits it to one task; "return-timeline:set" changes task and worker filter.
 */
export function mountReturnTimeline(root, {fetchImpl = fetch} = {}) {
  const doc = root.ownerDocument;
  const q = name => root.querySelector(`[data-rt-${name}]`);
  const windowSelect = q('window'), workerSelect = q('worker'), reasonSelect = q('reason');
  const status = q('status'), summary = q('summary'), body = q('body');
  let events = [], hours = 24, taskId = root.dataset.taskId ? Number(root.dataset.taskId) : null, generation = 0;
  windowSelect.replaceChildren(...WINDOWS.map(w => Object.assign(el(doc, 'option', w.label), {value: String(w.hours)})));

  function fill(select, values, all) {
    const current = select.value;
    select.replaceChildren(Object.assign(el(doc, 'option', all), {value: ''}),
      ...values.map(v => Object.assign(el(doc, 'option', select === reasonSelect ? describeReason(v).title : v), {value: v})));
    select.value = values.includes(current) ? current : '';
  }
  function render(data) {
    const shown = filterEvents(events, {worker: workerSelect.value, reason: reasonSelect.value});
    body.replaceChildren();
    for (const e of shown) {
      const row = el(doc, 'tr'), why = describeReason(e.reason);
      const link = el(doc, 'a', `#${e.task_id} ${e.task_title || ''}`.trim());
      link.href = '/tasks?task=' + e.task_id;
      const taskCell = el(doc, 'td'); taskCell.append(link);
      const reasonCell = el(doc, 'td'); reasonCell.append(el(doc, 'span', why.title), el(doc, 'code', e.reason || '—', 'return-code'));
      reasonCell.title = why.hint;
      const cells = [el(doc, 'td', stamp(e.at)), taskCell, el(doc, 'td', e.worker || 'unbekannt'), reasonCell];
      ['Zeit', 'Aufgabe', 'Worker', 'Grund'].forEach((label, i) => { cells[i].dataset.label = label; });
      row.append(...cells);
      row.dataset.scope = why.scope;
      body.append(row);
    }
    if (!shown.length) {
      const cell = el(doc, 'td', events.length ? 'Kein Eintrag passt zu den Filtern.' : 'Keine Rückgaben in diesem Zeitraum.');
      const row = el(doc, 'tr');
      cell.colSpan = 4; row.append(cell); body.append(row);
    }
    const label = WINDOWS.find(w => w.hours === hours).label;
    summary.textContent = `${data.total} ${data.total === 1 ? 'Rückgabe' : 'Rückgaben'} in ${label}`
      + (data.truncated ? ` · die neuesten ${events.length} werden gezeigt` : '')
      + (shown.length !== events.length ? ` · ${shown.length} nach Filter` : '');
  }
  async function refresh() {
    const mine = ++generation;
    hours = Number(windowSelect.value) || 24;
    status.textContent = 'Zeitleiste wird geladen …';
    status.dataset.error = 'false';
    try {
      const data = await loadReturnTimeline({hours, taskId}, fetchImpl);
      if (mine !== generation) return;
      events = data.events;
      fill(workerSelect, optionsOf(events, 'worker'), 'Alle Worker');
      fill(reasonSelect, optionsOf(events, 'reason'), 'Alle Gründe');
      status.textContent = `Stand ${new Date().toLocaleTimeString('de-DE')}`;
      render(data);
      root.__lastTimeline = data;
      root.dispatchEvent(new CustomEvent('return-timeline:loaded', {bubbles: true, detail: {total: data.total, hours, taskId}}));
    } catch (failure) {
      if (mine !== generation) return;
      events = []; body.replaceChildren(); summary.textContent = '';
      status.textContent = failure.message; status.dataset.error = 'true';
    }
  }
  const rerender = () => root.__lastTimeline && render(root.__lastTimeline);
  windowSelect.addEventListener('change', refresh);
  workerSelect.addEventListener('change', rerender);
  reasonSelect.addEventListener('change', rerender);
  q('refresh')?.addEventListener('click', refresh);
  root.addEventListener('return-timeline:set', event => {
    if ('taskId' in event.detail) taskId = event.detail.taskId ? Number(event.detail.taskId) : null;
    refresh().then(() => {
      if (event.detail.worker && optionsOf(events, 'worker').includes(event.detail.worker)) { workerSelect.value = event.detail.worker; rerender(); }
    });
  });
  if (!root.hasAttribute('data-lazy')) refresh();
  return {refresh};
}
