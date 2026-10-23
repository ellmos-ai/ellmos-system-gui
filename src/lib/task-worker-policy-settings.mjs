import {consumerApiHeaders} from './consumer-api-auth.mjs';

const modes = new Set(['simple_task', 'balanced', 'high_security']);
const nullableBooleans = (value) => value === null || typeof value === 'boolean';
const policySources = new Set(['system_default', 'task_override']);
const byId = (id) => document.getElementById(id);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
async function readTaskWorkerPolicy(taskId, signal) {
  return fetch(`/api/tasks/${encodeURIComponent(taskId)}/worker-policy`, {
    cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal,
    headers: consumerApiHeaders(),
  });
}
async function writeTaskWorkerPolicy(taskId, body, signal) {
  return fetch(`/api/tasks/${encodeURIComponent(taskId)}/worker-policy`, {
    method: 'PUT', credentials: 'same-origin', redirect: 'error',
    headers: consumerApiHeaders({'Content-Type': 'application/json'}), body: JSON.stringify(body), signal,
  });
}

function validOverride(value) {
  return record(value)
    && (value.mode === null || modes.has(value.mode))
    && nullableBooleans(value.github_external_review)
    && nullableBooleans(value.allow_review_task_pickup)
    && typeof value.require_user_review === 'boolean';
}

function validSnapshot(value, taskId) {
  if (!record(value) || value.schema !== 'bach.task-worker-policy-override.v1'
      || value.availability !== 'available' || value.task_id !== taskId
      || typeof value.configuration_version !== 'string' || !value.configuration_version.trim()
      || typeof value.task_version !== 'string' || !value.task_version.trim()
      || !validOverride(value.override) || !record(value.effective)) return false;
  return typeof value.effective.policy_version === 'string' && !!value.effective.policy_version.trim()
    && policySources.has(value.effective.policy_source)
    && modes.has(value.effective.effective_mode) && value.effective.effective_mode !== 'inherit'
    && typeof value.effective.state === 'string' && !!value.effective.state.trim()
    && typeof value.effective.reason === 'string'
    && typeof value.effective.user_review_required === 'boolean'
    && typeof value.effective.github_external_review === 'boolean'
    && typeof value.effective.allow_review_task_pickup === 'boolean';
}

function sameOverride(actual, expected) {
  return actual.mode === expected.mode
    && actual.github_external_review === expected.github_external_review
    && actual.allow_review_task_pickup === expected.allow_review_task_pickup
    && actual.require_user_review === expected.require_user_review;
}

function triStateToNullableBoolean(value) {
  if (value === 'inherit') return null;
  if (value === 'on') return true;
  if (value === 'off') return false;
  throw new Error('Task-Regeln enthalten ungültige Werte.');
}

function nullableBooleanToTriState(value) {
  return value === null ? 'inherit' : value ? 'on' : 'off';
}

function setStatus(message, state = 'neutral') {
  const status = byId('task-worker-policy-status');
  status.textContent = message;
  status.dataset.state = state;
}

function setEnabled(enabled) {
  const form = byId('task-worker-policy-form');
  form.hidden = !enabled;
  for (const control of form.elements) control.disabled = !enabled;
  const refresh = byId('task-worker-policy-refresh');
  if (refresh) refresh.disabled = !enabled;
}

const modeLabels = {simple_task: 'Einfacher Taskmodus', balanced: 'Ausgewogen', high_security: 'Hochsicherheit'};
function globalOrigin(snapshot) {
  return snapshot.global_policy_source === 'user_override' ? 'globale Benutzerregel'
    : snapshot.global_policy_source === 'system_default' ? 'globaler Systemstandard'
    : 'globale Herkunft nicht bestätigt';
}
function fieldOrigin(snapshot, key) {
  return snapshot.override[key] !== null ? 'Task-Abweichung' : globalOrigin(snapshot);
}
function renderPolicyOrigins(snapshot) {
  const target = byId('task-worker-policy-origins');
  target.replaceChildren();
  const effective = snapshot.effective;
  const rows = [
    ['Abschlussmodus', modeLabels[effective.effective_mode] + ' · ' + fieldOrigin(snapshot, 'mode')],
    ['GitHub-Prüfung', (effective.github_external_review ? 'extern über GitHub' : 'intern') + ' · ' + fieldOrigin(snapshot, 'github_external_review')],
    ['Review-Aufgabe als Ersatz', (effective.allow_review_task_pickup ? 'erlaubt' : 'ausgeschlossen') + ' · ' + fieldOrigin(snapshot, 'allow_review_task_pickup')],
    ['Globale Herkunft', globalOrigin(snapshot)],
  ];
  for (const [label, value] of rows) {
    const term = document.createElement('dt'), description = document.createElement('dd');
    term.textContent = label; description.textContent = value; target.append(term, description);
  }
  byId('task-worker-policy-versions').textContent =
    'Regelversion: ' + effective.policy_version + ' · Konfigurationsstand (global und Task): ' +
    snapshot.configuration_version + ' · Taskversion: ' + snapshot.task_version +
    ' · Technischer Auswertungsstand: ' + effective.state + (effective.reason ? ' · ' + effective.reason : '');
}

function renderSnapshot(snapshot) {
  const form = byId('task-worker-policy-form');
  const override = snapshot.override;
  const effective = snapshot.effective;
  form.elements.namedItem('mode').value = override.mode ?? 'inherit';
  form.elements.namedItem('github_external_review').value = nullableBooleanToTriState(override.github_external_review);
  form.elements.namedItem('allow_review_task_pickup').value = nullableBooleanToTriState(override.allow_review_task_pickup);
  const userReview = form.elements.namedItem('user_review_required');
  userReview.checked = override.require_user_review || effective.user_review_required === true;
  userReview.disabled = effective.user_review_required === true;
  userReview.title = effective.user_review_required === true
    ? 'Ein wirksames Nutzerreview kann hier nicht entfernt werden.' : '';
  renderPolicyOrigins(snapshot);
  byId('task-worker-policy-effective').textContent =
    'Nutzerreview ' + (effective.user_review_required ? 'verbindlich erforderlich.' : 'laut Regel nicht erforderlich.') +
    (effective.state === 'not_evaluated'
      ? ' Dies ist die wirksame Konfiguration; die Integrität und Freigabe eines Ergebnisses sind noch nicht ausgewertet.'
      : ' Ein Konfigurationsabruf bestätigt keine Ergebnisannahme.');
}

function collectOverride(snapshot) {
  const form = byId('task-worker-policy-form');
  const next = {
    mode: form.elements.namedItem('mode').value === 'inherit' ? null : form.elements.namedItem('mode').value,
    github_external_review: triStateToNullableBoolean(form.elements.namedItem('github_external_review').value),
    allow_review_task_pickup: triStateToNullableBoolean(form.elements.namedItem('allow_review_task_pickup').value),
    require_user_review: snapshot.effective.user_review_required === true
      ? snapshot.override.require_user_review
      : form.elements.namedItem('user_review_required').checked,
  };
  if (!validOverride(next)) throw new Error('Task-Regeln enthalten ungültige Werte.');
  return next;
}

export function mountTaskWorkerPolicySettings() {
  const form = byId('task-worker-policy-form');
  const refresh = byId('task-worker-policy-refresh');
  if (!form || !refresh) return;
  let taskId = null;
  let snapshot = null;
  let generation = 0;
  let busy = false;
  let controller = null;

  async function load(id = taskId, {expectedOverride = null} = {}) {
    if (!Number.isSafeInteger(id) || id <= 0 || busy) return;
    taskId = id;
    const current = ++generation;
    controller = new AbortController();
    const requestController = controller;
    busy = true;
    snapshot = null;
    setEnabled(false);
    refresh.disabled = true;
    setStatus(`Task #${id}: Worker-Regeln werden geprüft …`);
    try {
      const response = await readTaskWorkerPolicy(id, requestController.signal);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const value = await response.json();
      if (!validSnapshot(value, id)) throw new Error('Policy-Schema, Task-Version oder Laufzeitstatus nicht bestätigt.');
      if (expectedOverride && !sameOverride(value.override, expectedOverride))
        throw new Error('Readback entspricht der gespeicherten Task-Regel nicht.');
      if (current !== generation) return;
      snapshot = value;
      renderSnapshot(value);
      setEnabled(true);
      form.elements.namedItem('user_review_required').disabled = value.effective.user_review_required === true;
      setStatus(`Task #${id}: Regeln gelesen · Schreibzugriff erst nach unabhängigem Readback bestätigt.`, 'available');
      return true;
    } catch (error) {
      if (current !== generation) return;
      setEnabled(false);
      const message = error instanceof Error ? error.message : 'Policy-Quelle nicht verfügbar.';
      setStatus(`Task-Regeln für #${id} nicht verfügbar: ${message}`, 'unavailable');
      return false;
    } finally {
      if (current === generation) {
        refresh.disabled = false;
        busy = false;
        controller = null;
      }
    }
  }

  refresh.addEventListener('click', () => load());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!snapshot || !taskId || busy) return;
    const targetTaskId = taskId;
    const baseSnapshot = snapshot;
    let override;
    try { override = collectOverride(baseSnapshot); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Eingaben ungültig.', 'error'); return; }
    const current = ++generation;
    controller = new AbortController();
    const requestController = controller;
    busy = true;
    setEnabled(false);
    setStatus(`Task #${targetTaskId}: Regeln werden gespeichert …`);
    let saveError = null;
    try {
      const response = await writeTaskWorkerPolicy(targetTaskId, {
          task_id: targetTaskId,
          task_version: baseSnapshot.task_version,
          configuration_version: baseSnapshot.configuration_version,
          override,
      }, requestController.signal);
      if (response.status === 409) throw new Error('Task oder Policy wurde parallel geändert. Bitte neu laden.');
      if (!response.ok) throw new Error('Speichern nicht bestätigt (HTTP ' + response.status + ').');
      const ack = await response.json();
      if (!record(ack) || ack.schema !== 'bach.task-worker-policy-override.v1'
          || ack.updated !== true || ack.worker_started !== false || ack.task_id !== targetTaskId)
        throw new Error('Speicherbestätigung ist unvollständig.');
      setStatus('Gespeichert; unabhängiger Readback läuft …', 'available');
    } catch (error) {
      if (current === generation) saveError = error instanceof Error ? error.message : 'Speichern nicht bestätigt.';
    } finally {
      if (current === generation) {
        busy = false;
        controller = null;
      }
    }
    if (current === generation) {
      const readbackGeneration = generation + 1;
      const readbackOk = await load(targetTaskId, {expectedOverride: saveError ? null : override});
      if (saveError && generation === readbackGeneration) setStatus(saveError + (readbackOk
        ? ' Der anschließende Readback zeigt den aktuellen Stand.'
        : ' Auch der aktuelle Stand konnte nicht bestätigt werden.'), 'error');
    }
  });

  window.addEventListener('bach:task-selected', (event) => {
    const id = Number(event.detail?.id);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    generation += 1;
    controller?.abort();
    controller = null;
    busy = false;
    load(id);
  });
}
