// PB-5b (#3989, B-15): text and tone of the two status pills in the header (backend origin, RAM claim).
// Each state is one statement in words; the colored dot comes from data-tone in CSS. No emoji, no inline colors.

const BACKEND_UNVERIFIED_TITLE = 'Backendquelle nicht verifiziert';

export function backendPillModel(state = {}) {
  const verified = state.connection_verified === true && state.schema_verified === true
    && state.instance_verified === true && state.adapter_binding_verified === true;
  if (verified && (state.mode === 'server' || state.mode === 'local')) {
    const title = state.instance_label ? `${state.instance_label} · geprüft ${state.observed_at || ''}`.trim() : 'Backend verifiziert';
    return {text: state.mode === 'server' ? 'Backend Server' : 'Backend lokal', tone: 'ok', title};
  }
  return {text: 'Backend unbekannt', tone: 'unknown', title: BACKEND_UNVERIFIED_TITLE};
}

export function backendPillError() {
  return {text: 'Offline · Backend unbekannt', tone: 'error', title: 'Backend-Metadaten nicht erreichbar; kein Cache belegt'};
}

export function computePillModel(data = {}) {
  const fackel = data?.fackel || {};
  const capacity = fackel.capacity || {};
  const priority = fackel.priority?.value || 'ollama';
  const count = Number.isSafeInteger(capacity.loaded_model_count) ? capacity.loaded_model_count : 0;
  const used = Number.isFinite(capacity.used_gib) ? capacity.used_gib.toFixed(1).replace('.', ',') : null;
  const names = Array.isArray(capacity.loaded_models) && capacity.loaded_models.length ? capacity.loaded_models.join(', ') : '';
  const title = `RAM-Distributor (${String(priority).toUpperCase()}) · Geladene Modelle: ${names || 'keine'}. Klicken, um Modell und RAM sofort freizugeben.`;
  if (fackel.compute_turn?.active) return {text: names ? `Modell aktiv · ${names}` : 'Modell aktiv', tone: 'busy', title};
  if (count > 0) return {text: `${count} Modell${count === 1 ? '' : 'e'} geladen${used ? ' · ' + used + ' GiB' : ''}`, tone: 'idle', title};
  return {text: priority === 'compute' ? 'RAM frei für Compute' : 'Kein Modell im RAM', tone: priority === 'compute' ? 'ok' : 'idle', title};
}

export function computePillError() {
  return {text: 'RAM-Status nicht verfügbar', tone: 'unknown', title: 'Die Belegung konnte nicht gelesen werden.'};
}

export function applyPill(node, model) {
  if (!node || !model) return;
  node.textContent = model.text;
  node.dataset.tone = model.tone;
  if (model.title) node.title = model.title;
}
