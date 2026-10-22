const POLICY_SCHEMA = 'bach.worker-selection.v1';
const VERSION = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const POLICY_LISTS = ['categories', 'priorities', 'tags', 'exclude_tags'];
const OWNERSHIP_MODES = new Set(['explicit_pickup_filter', 'bach_or_own_worker_role']);
const MAX_REMEMBERED_OPEN_WORKERS = 128;
const rememberedOpenWorkers = new Set();

function validText(value, max = 192) {
  return typeof value === 'string' && value.length <= max && !value.includes('\0');
}

function policySnapshot(raw, workerId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.ok !== true || raw.id !== workerId
      || !VERSION.test(raw.configuration_version || '') || !raw.configuration
      || typeof raw.configuration !== 'object' || Array.isArray(raw.configuration)) return null;

  const policy = raw.selection_policy;
  const pickup = policy?.pickup_filter;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
      || policy.schema !== POLICY_SCHEMA || typeof policy.require_assigned_slot !== 'boolean'
      || !pickup || typeof pickup !== 'object' || Array.isArray(pickup)
      || typeof pickup.enabled !== 'boolean' || !OWNERSHIP_MODES.has(policy.unrouted_ownership)
      || !POLICY_LISTS.every(key => Array.isArray(pickup[key]) && pickup[key].length <= 64
        && pickup[key].every(value => validText(value, 100)))) return null;

  const {backend, model, task_id: taskId} = raw.configuration;
  if ((backend != null && !validText(backend)) || (model != null && !validText(model))) return null;
  let pinnedTask = null;
  if (taskId != null && taskId !== '' && taskId !== 0 && taskId !== '0') {
    if (Number.isSafeInteger(taskId) && taskId > 0) pinnedTask = taskId;
    else if (typeof taskId === 'string' && /^\d{1,16}$/.test(taskId) && Number(taskId) > 0
        && Number.isSafeInteger(Number(taskId))) pinnedTask = Number(taskId);
    else return null;
  }

  return {
    version: raw.configuration_version,
    policy,
    backend: typeof backend === 'string' ? backend : '',
    model: typeof model === 'string' ? model : '',
    pinnedTask,
  };
}

function element(document, tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function appendRule(list, label, value) {
  const item = element(list.ownerDocument, 'li');
  const strong = element(list.ownerDocument, 'strong', label);
  item.append(strong, list.ownerDocument.createTextNode(' '), list.ownerDocument.createTextNode(value));
  list.append(item);
}

function listLabel(values, emptyLabel) {
  return values.length ? values.join(', ') : emptyLabel;
}

function rememberWorkerOpenState(workerId, open) {
  if (typeof workerId !== 'string' || !SAFE_ID.test(workerId)) return;
  rememberedOpenWorkers.delete(workerId);
  if (open !== true) return;
  rememberedOpenWorkers.add(workerId);
  while (rememberedOpenWorkers.size > MAX_REMEMBERED_OPEN_WORKERS) {
    rememberedOpenWorkers.delete(rememberedOpenWorkers.values().next().value);
  }
}

export function rememberOpenStates(document) {
  if (!document || typeof document.querySelectorAll !== 'function') return;
  for (const details of document.querySelectorAll('.worker-selection-policy[data-worker-id]')) {
    rememberWorkerOpenState(details.dataset.workerId, details.open);
  }
}

function renderSnapshot(document, container, snapshot) {
  const {policy, backend, model, pinnedTask, version} = snapshot;
  const source = element(document, 'p', 'Quelle: native BACH-Worker-Konfiguration · ');
  source.append(document.createTextNode('GET /api/system/workers/{id}/configuration · '),
    element(document, 'code', policy.schema));
  container.append(source);

  const revision = element(document, 'p', 'Worker-Konfigurationsversion: ');
  revision.append(element(document, 'code', version));
  container.append(revision);

  const order = element(document, 'ol');
  order.append(element(document, 'li', pinnedTask
    ? `Die fest gebundene Task #${pinnedTask} wird zuerst versucht.`
    : 'Es ist keine feste Task-ID gebunden; der Worker nutzt die normale Kandidatenqueue.'));
  order.append(element(document, 'li', 'Danach liefert die kanonische Task-API offene Tasks in nativer Reihenfolge: Priorität P1 bis P4, danach übrige Prioritäten; innerhalb derselben Stufe zuerst die neueste Task und bei Gleichstand die höhere ID.'));
  order.append(element(document, 'li', 'Der native Worker prüft Modell, Slot, Zuständigkeit und aktive Auswahlfilter. Die Lease-Akquisition prüft anschließend aktuellen Status, Abhängigkeiten, Taskversion und Lease.'));
  order.append(element(document, 'li', 'Bei ungebundener Suche prüft der lokale native Reviewpfad Review-Tasks erst nach allen normalen Kandidaten. Ein fester Task-Pin wird zuvor versucht.'));
  const orderHeading = element(document, 'p', 'Tatsächliche Auswahlreihenfolge');
  orderHeading.className = 'worker-selection-policy-heading';
  container.append(orderHeading, order);

  const requirements = element(document, 'ul');
  appendRule(requirements, 'Slotpflicht:', policy.require_assigned_slot
    ? 'aktiv; eine Task muss ausdrücklich diesem Worker-Slot zugewiesen sein.'
    : 'aus; es gibt keine allgemeine Slotbarriere.');
  appendRule(requirements, 'Modellbindung:', backend && model
    ? `${backend} / ${model}; eine abweichende Task-Anforderung wird vom nativen Selector ausgeschlossen.`
    : 'im aktuellen Snapshot nicht bestätigt.');
  appendRule(requirements, 'Zuständigkeit für nicht zugewiesene Tasks:',
    policy.unrouted_ownership === 'explicit_pickup_filter'
      ? 'der aktive Pickup-Filter entscheidet; explizite Zuweisungen werden zusätzlich geprüft.'
      : 'BACH oder die eigene Worker-Rolle; explizite Zuweisungen werden zusätzlich geprüft.');
  container.append(element(document, 'p', 'Harte Regeln aus der nativen Auswahlpolicy'));
  container.append(requirements);

  const pickup = policy.pickup_filter;
  if (!pickup.enabled) {
    container.append(element(document, 'p', 'Der Pickup-Filter ist ausgeschaltet. Modell-, Slot-, Zuständigkeits-, Status-, Abhängigkeits- und Lease-Prüfungen bleiben bestehen.'));
  } else {
    const filters = element(document, 'ul');
    appendRule(filters, 'Zulässige Kategorien:', pickup.categories.length
      ? `eine von ${pickup.categories.join(', ')}` : 'alle');
    appendRule(filters, 'Zulässige Prioritäten:', pickup.priorities.length
      ? `eine von ${pickup.priorities.join(', ')}` : 'alle');
    appendRule(filters, 'Mindestens einer dieser Tags:', listLabel(pickup.tags, 'keine Einschränkung'));
    appendRule(filters, 'Ausgeschlossen, falls mindestens einer vorkommt:', listLabel(pickup.exclude_tags, 'keine'));
    container.append(element(document, 'p', 'Aktiver Pickup-Filter (gleichzeitig angewandte Kriterien)'));
    container.append(filters);
    container.append(element(document, 'small', 'Bei einer expliziten Slotroute kann der native Selector Kategorien und Prioritäten übersteuern; für externe Profile kann die Kategorie entfallen. Tag-, Modell- und Slotregeln werden separat geprüft.'));
  }

  container.append(element(document, 'small', 'Dies ist der gerade gelesene Policy-Snapshot, keine Kandidatenvorschau und kein Task-Claim. Die letzte konkrete Auswahl bleibt im separaten Queue-Beleg.'));
}

async function loadPolicy(document, workerId, status) {
  status.textContent = 'Native Worker-Policy wird gelesen …';
  try {
    const response = await fetch(`/api/system/workers/${encodeURIComponent(workerId)}/configuration`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: {Accept: 'application/json'},
    });
    if (!response.ok) throw new Error('unavailable');
    const snapshot = policySnapshot(await response.json(), workerId);
    if (!snapshot) throw new Error('unconfirmed');
    status.replaceChildren();
    renderSnapshot(document, status, snapshot);
  } catch (_error) {
    status.textContent = 'Native Auswahlpolicy nicht bestätigt. Die Auswahlreihenfolge und Kandidatenvorschau sind für dieses Backend nicht verfügbar.';
  }
}

export function appendSelectionPolicy(document, card, workerId) {
  if (!document || !card || typeof workerId !== 'string' || !SAFE_ID.test(workerId)) return;
  const existing = card.querySelector('.worker-selection-policy');
  if (existing) {
    rememberWorkerOpenState(existing.dataset.workerId, existing.open);
    if (existing.dataset.workerId === workerId) return;
    existing.remove();
  }

  const details = element(document, 'details');
  details.className = 'worker-selection-policy';
  details.dataset.workerId = workerId;
  const content = element(document, 'div');
  content.className = 'worker-selection-policy-content';
  const summary = element(document, 'summary', 'Auswahlreihenfolge und Policyherkunft');
  details.append(summary, content);
  details.addEventListener('toggle', () => {
    if (!document.contains(details)) return;
    rememberWorkerOpenState(workerId, details.open);
    if (details.open && content.dataset.loading !== 'true') {
      content.dataset.loading = 'true';
      loadPolicy(document, workerId, content).finally(() => {
        content.dataset.loading = 'false';
      });
    }
  });
  card.append(details);
  if (rememberedOpenWorkers.has(workerId)) details.open = true;
}

if (typeof window !== 'undefined') {
  window.BachWorkerSelectionPolicy = {appendSelectionPolicy, rememberOpenStates};
}
