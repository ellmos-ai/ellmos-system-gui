import {consumerApiHeaders} from './consumer-api-auth.mjs';

const modes = new Set(['simple_task', 'balanced', 'high_security']);
const tiers = new Set(['standard', 'top']);
const orderings = new Set(['priority_then_created', 'oldest_first']);
const policySources = new Set(['system_default', 'user_override']);
const expiryUnits = new Map([['hours', 3600], ['minutes', 60], ['seconds', 1]]);
const endpoint = '/api/system/worker-policy';
const byId = (id) => document.getElementById(id);

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validPolicyResponse(value) {
  if (!record(value) || value.schema !== 'bach.worker-review-policy-settings.v1'
      || value.availability !== 'available'
      || typeof value.configuration_version !== 'string'
      || !value.configuration_version.trim()
      || !policySources.has(value.policy_source)
      || !record(value.policy) || !record(value.selection)) return false;
  const policy = value.policy;
  return typeof policy.policy_version === 'string' && !!policy.policy_version.trim()
    && modes.has(policy.default_mode)
    && Array.isArray(policy.reviewers)
    && policy.reviewers.every((reviewer) => record(reviewer)
      && typeof reviewer.reviewer_id === 'string' && !!reviewer.reviewer_id.trim()
      && tiers.has(reviewer.tier))
    && (policy.review_expiry_seconds === null
      || (Number.isSafeInteger(policy.review_expiry_seconds) && policy.review_expiry_seconds > 0))
    && typeof policy.github_external_review === 'boolean'
    && typeof policy.allow_review_task_pickup === 'boolean'
    && typeof value.selection.resume_bound_task_first === 'boolean'
    && typeof value.selection.decompose_when_idle === 'boolean'
    && orderings.has(value.selection.normal_task_order);
}

function comparableSettings(policy, selection) {
  return JSON.stringify({
    policy: {
    default_mode: policy.default_mode,
    reviewers: [...policy.reviewers]
      .map(({reviewer_id, tier}) => ({reviewer_id, tier}))
      .sort((a, b) => a.reviewer_id.localeCompare(b.reviewer_id) || a.tier.localeCompare(b.tier)),
    review_expiry_seconds: policy.review_expiry_seconds,
    github_external_review: policy.github_external_review,
    allow_review_task_pickup: policy.allow_review_task_pickup,
    },
    selection: {
      resume_bound_task_first: selection.resume_bound_task_first,
      decompose_when_idle: selection.decompose_when_idle,
      normal_task_order: selection.normal_task_order,
    },
  });
}

function sameSettings(actual, expected) {
  return comparableSettings(actual.policy, actual.selection) === comparableSettings(expected.policy, expected.selection);
}

function reviewerRow(reviewer = {}) {
  const row = document.createElement('div');
  row.className = 'worker-reviewer-row';
  const id = document.createElement('input');
  id.type = 'text';
  id.maxLength = 180;
  id.autocomplete = 'off';
  id.placeholder = 'z. B. ollama/qwen';
  id.value = typeof reviewer.reviewer_id === 'string' ? reviewer.reviewer_id : '';
  id.setAttribute('aria-label', 'Reviewer-ID');
  const tier = document.createElement('select');
  tier.setAttribute('aria-label', 'Reviewer-Stufe');
  for (const [value, label] of [['standard', 'Standard'], ['top', 'Top-Reviewer']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    tier.append(option);
  }
  tier.value = tiers.has(reviewer.tier) ? reviewer.tier : 'standard';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-secondary';
  remove.textContent = 'Entfernen';
  remove.addEventListener('click', () => row.remove());
  row.append(id, tier, remove);
  return row;
}

function showStatus(message, state = 'neutral') {
  const status = byId('worker-policy-status');
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

function setFormEnabled(enabled) {
  const form = byId('worker-policy-form');
  if (form) form.hidden = !enabled;
  const save = byId('worker-policy-save');
  const reset = byId('worker-policy-reset');
  if (save) save.disabled = !enabled;
  if (reset) reset.disabled = !enabled;
}

function setExpiryAvailability(form) {
  const mode = form.elements.namedItem('default_mode').value;
  const expiryMode = form.elements.namedItem('expiry_mode');
  const value = form.elements.namedItem('expiry_value');
  const unit = form.elements.namedItem('expiry_unit');
  const supported = mode === 'balanced';
  expiryMode.disabled = !supported;
  const durationEnabled = supported && expiryMode.value === 'duration';
  value.disabled = !durationEnabled;
  unit.disabled = !durationEnabled;
  const maxByUnit = {hours: 8760, minutes: 525600, seconds: 31536000};
  value.min = '1';
  value.max = String(maxByUnit[unit.value] || maxByUnit.hours);
  if (!supported) {
    expiryMode.value = 'none';
    value.value = '';
    unit.value = 'hours';
  }
}

function renderPolicy(snapshot) {
  const form = byId('worker-policy-form');
  const policy = snapshot.policy;
  form.elements.namedItem('default_mode').value = policy.default_mode;
  form.elements.namedItem('github_external_review').checked = policy.github_external_review;
  form.elements.namedItem('allow_review_task_pickup').checked = policy.allow_review_task_pickup;
  form.elements.namedItem('resume_bound_task_first').checked = snapshot.selection.resume_bound_task_first;
  form.elements.namedItem('decompose_when_idle').checked = snapshot.selection.decompose_when_idle;
  form.elements.namedItem('normal_task_order').value = snapshot.selection.normal_task_order;
  const seconds = policy.review_expiry_seconds;
  const expiryMode = form.elements.namedItem('expiry_mode');
  const expiryValue = form.elements.namedItem('expiry_value');
  const expiryUnit = form.elements.namedItem('expiry_unit');
  if (Number.isSafeInteger(seconds) && seconds > 0) {
    const unit = seconds % 3600 === 0 ? 'hours' : seconds % 60 === 0 ? 'minutes' : 'seconds';
    expiryMode.value = 'duration';
    expiryUnit.value = unit;
    expiryValue.value = String(seconds / expiryUnits.get(unit));
  } else {
    expiryMode.value = 'none';
    expiryUnit.value = 'hours';
    expiryValue.value = '';
  }
  const reviewers = byId('worker-policy-reviewers');
  reviewers.replaceChildren(...policy.reviewers.map(reviewerRow));
  if (!policy.reviewers.length) {
    const empty = document.createElement('p');
    empty.className = 'card-desc';
    empty.textContent = 'Keine Reviewer eingetragen.';
    reviewers.append(empty);
  }
  const version = byId('worker-policy-version');
  const sourceLabel = snapshot.policy_source === 'system_default' ? 'Systemstandard' : 'Benutzerabweichung';
  version.textContent = 'Policy: ' + policy.policy_version + ' · Konfiguration: ' + snapshot.configuration_version + ' · Quelle: ' + sourceLabel;
  setExpiryAvailability(form);
}

function collectPolicy(snapshot) {
  const form = byId('worker-policy-form');
  const mode = form.elements.namedItem('default_mode').value;
  if (!modes.has(mode)) throw new Error('Abschlussmodus ist ungültig.');
  const reviewers = Array.from(byId('worker-policy-reviewers').querySelectorAll('.worker-reviewer-row'))
    .map((row) => ({
      reviewer_id: row.querySelector('input').value.trim(),
      tier: row.querySelector('select').value,
    }))
    .filter((reviewer) => reviewer.reviewer_id);
  const seen = new Set();
  for (const reviewer of reviewers) {
    const key = reviewer.reviewer_id.toLocaleLowerCase();
    if (reviewer.reviewer_id.length > 180 || !tiers.has(reviewer.tier) || seen.has(key))
      throw new Error('Reviewer-IDs müssen gültig und eindeutig sein.');
    seen.add(key);
  }
  if (mode === 'high_security' && !reviewers.some((reviewer) => reviewer.tier === 'top'))
    throw new Error('Hochsicherheit benötigt mindestens einen Top-Reviewer.');
  const expiryMode = form.elements.namedItem('expiry_mode').value;
  let expiry = null;
  if (mode === 'balanced' && expiryMode === 'duration') {
    const value = Number(form.elements.namedItem('expiry_value').value);
    const unit = form.elements.namedItem('expiry_unit').value;
    const maxByUnit = {hours: 8760, minutes: 525600, seconds: 31536000};
    if (!Number.isSafeInteger(value) || value < 1 || !expiryUnits.has(unit) || value > maxByUnit[unit])
      throw new Error('Die Review-Frist muss zwischen 1 Sekunde und einem Jahr liegen.');
    expiry = value * expiryUnits.get(unit);
  } else if (expiryMode !== 'none' && mode === 'balanced') {
    throw new Error('Review-Verfall ist ungültig.');
  }
  return {
    policy: {
      policy_version: snapshot.policy.policy_version,
      default_mode: mode,
      reviewers,
      review_expiry_seconds: expiry,
      github_external_review: form.elements.namedItem('github_external_review').checked,
      allow_review_task_pickup: form.elements.namedItem('allow_review_task_pickup').checked,
    },
    selection: {
      resume_bound_task_first: form.elements.namedItem('resume_bound_task_first').checked,
      decompose_when_idle: form.elements.namedItem('decompose_when_idle').checked,
      normal_task_order: form.elements.namedItem('normal_task_order').value,
    },
  };
}

export function mountWorkerPolicySettings() {
  const form = byId('worker-policy-form');
  const refresh = byId('worker-policy-refresh');
  const addReviewer = byId('worker-policy-add-reviewer');
  const reset = byId('worker-policy-reset');
  if (!form || !refresh || !addReviewer || !reset) return;
  let snapshot = null;
  let busy = false;

  async function load({expectedPolicy = null, expectDefault = false} = {}) {
    if (busy) return;
    busy = true;
    setFormEnabled(false);
    refresh.disabled = true;
    showStatus('Worker-Policy wird gelesen …');
    try {
      const response = await fetch(endpoint, {
        cache: 'no-store', credentials: 'same-origin', redirect: 'error',
        headers: consumerApiHeaders(),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const value = await response.json();
      if (!validPolicyResponse(value)) throw new Error('Policy-Schema oder Laufzeitstatus ist nicht bestätigt.');
      if (expectDefault && value.policy_source !== 'system_default')
        throw new Error('Readback bestätigt den Systemstandard nicht.');
      if (expectedPolicy && !sameSettings(value, expectedPolicy))
        throw new Error('Readback entspricht der gespeicherten Policy nicht.');
      snapshot = value;
      renderPolicy(value);
      setFormEnabled(true);
      showStatus('Backend-Policy gelesen · Änderungen werden erst nach bestätigtem Readback übernommen.', 'available');
    } catch (error) {
      snapshot = null;
      setFormEnabled(false);
      const message = error instanceof Error ? error.message : 'Policy-Quelle nicht verfügbar.';
      showStatus('Worker-Policy nicht verfügbar: ' + message, 'unavailable');
    } finally {
      refresh.disabled = false;
      busy = false;
    }
  }

  form.elements.namedItem('default_mode').addEventListener('change', () => setExpiryAvailability(form));
  form.elements.namedItem('expiry_mode').addEventListener('change', () => setExpiryAvailability(form));
  form.elements.namedItem('expiry_unit').addEventListener('change', () => setExpiryAvailability(form));
  refresh.addEventListener('click', () => load());
  addReviewer.addEventListener('click', () => {
    const empty = byId('worker-policy-reviewers').querySelector('p');
    if (empty) empty.remove();
    byId('worker-policy-reviewers').append(reviewerRow());
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!snapshot || busy) return;
    let policy;
    try {
      policy = collectPolicy(snapshot);
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Eingaben ungültig.', 'error');
      return;
    }
    busy = true;
    setFormEnabled(false);
    showStatus('Worker-Policy wird gespeichert …');
    try {
      const response = await fetch(endpoint, {
        method: 'PUT', credentials: 'same-origin', redirect: 'error',
        headers: consumerApiHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({configuration_version: snapshot.configuration_version, ...policy}),
      });
      if (response.status === 409) throw new Error('Konfiguration wurde parallel geändert. Bitte neu laden.');
      if (!response.ok) throw new Error('Speichern nicht bestätigt (HTTP ' + response.status + ').');
      const ack = await response.json();
      if (!record(ack) || ack.schema !== 'bach.worker-review-policy-settings.v1'
          || ack.updated !== true || ack.worker_started !== false)
        throw new Error('Speicherbestätigung ist unvollständig.');
      showStatus('Gespeichert; unabhängiger Readback läuft …', 'available');
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Speichern nicht bestätigt.', 'error');
    } finally {
      busy = false;
    }
    await load({expectedPolicy: policy});
  });

  reset.addEventListener('click', async () => {
    if (!snapshot || busy) return;
    busy = true;
    setFormEnabled(false);
    showStatus('Systemstandard wird angefordert …');
    try {
      const response = await fetch(endpoint, {
        method: 'PUT', credentials: 'same-origin', redirect: 'error',
        headers: consumerApiHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({configuration_version: snapshot.configuration_version, reset_to_default: true}),
      });
      if (response.status === 409) throw new Error('Konfiguration wurde parallel geändert. Bitte neu laden.');
      if (!response.ok) throw new Error('Zurücksetzen nicht bestätigt (HTTP ' + response.status + ').');
      const ack = await response.json();
      if (!record(ack) || ack.schema !== 'bach.worker-review-policy-settings.v1'
          || ack.updated !== true || ack.worker_started !== false)
        throw new Error('Bestätigung des Systemstandards ist unvollständig.');
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Systemstandard nicht bestätigt.', 'error');
    } finally {
      busy = false;
    }
    await load({expectDefault: true});
  });

  load();
}
