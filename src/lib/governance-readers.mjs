// Read-only governance views (#2014). Every field name comes from the BACH handlers
// (unified_api.py:1044-1128, governance_registry.py:18-28, policy_registry_adapter.py:68-115).
// Missing values stay null so the page can print "unbekannt"; nothing is simulated.
export const TABS = ['status', 'locks', 'decisions', 'policies', 'registry', 'effective'];
export const KINDS = ['policy', 'rule', 'decision', 'evidence', 'decision-candidate'];
export const LIMITS = {scope: 256, consumer: 256, query: 512};
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

export function readTab(search = '') {
  const tab = new URLSearchParams(search).get('tab');
  return TABS.includes(tab) ? tab : 'status';
}

export function registryQuery(filters = {}) {
  const query = new URLSearchParams();
  for (const key of ['scope', 'consumer', 'query']) {
    const value = text(filters[key]);
    if (value) {
      if (value.length > LIMITS[key]) throw new Error(key + ' ist zu lang (max. ' + LIMITS[key] + ').');
      query.set(key, value);
    }
  }
  if (filters.kind) {
    if (!KINDS.includes(filters.kind)) throw new Error('kind ungültig.');
    query.set('kind', filters.kind);
  }
  return query;
}

export function effectiveQuery(filters = {}) {
  if (!text(filters.scope)) throw new Error('Für die Auflösung ist ein scope erforderlich.');
  return registryQuery({...filters, kind: undefined});
}

// Classifies a failed or malformed response. The auth gate answers 401 for every /api path,
// so a 401 says nothing about the route itself.
export function describeFailure(status, body) {
  const detail = text(body?.detail) || text(body?.error);
  if (status === 401 || status === 403) return {state: 'auth', label: 'Geräteanmeldung fehlt oder ungültig (HTTP ' + status + ')', detail};
  if (status === 404) return {state: 'route', label: 'Endpunkt am Backend nicht vorhanden (HTTP 404)', detail};
  if (status === 409) return {state: 'changed', label: 'Registry änderte sich während des Lesens (HTTP 409)', detail};
  if (status === 503) return {state: 'unavailable', label: 'Quelle nicht verfügbar (HTTP 503)', detail};
  if (status === 0) return {state: 'network', label: 'Backend nicht erreichbar', detail};
  return {state: 'error', label: 'Fehler (HTTP ' + status + ')', detail};
}

export function ageLabel(iso, now = Date.now()) {
  const stamp = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (Number.isNaN(stamp)) return 'unbekannt';
  const seconds = Math.round((now - stamp) / 1000);
  if (seconds < -60) return 'Zeitstempel liegt in der Zukunft';
  if (seconds < 60) return 'vor weniger als 1 Min.';
  if (seconds < 3600) return 'vor ' + Math.round(seconds / 60) + ' Min.';
  if (seconds < 86400) return 'vor ' + Math.round(seconds / 3600) + ' Std.';
  return 'vor ' + Math.round(seconds / 86400) + ' Tagen';
}

function fail(what) { throw new Error('Governance-Vertrag verletzt: ' + what); }

function lockRows(list) {
  if (!Array.isArray(list)) fail('locks ist keine Liste');
  return list.map(item => {
    if (!isObject(item) || !text(item.name)) fail('Lock ohne name');
    return {name: item.name, scope: text(item.scope), type: text(item.type), status: text(item.status)};
  });
}

// GET /api/governance/locks (unified_api.py:1103-1110)
export function parseLocks(body) {
  if (!isObject(body) || !text(body.availability) || !('locks' in body)) fail('/locks');
  return {
    kind: 'locks', availability: body.availability, source: text(body.source), error: text(body.error),
    observedAt: text(body.checked_at), scannedAt: text(body.scanned_at), schema: null, version: null,
    count: Number.isInteger(body.count) ? body.count : null, rows: lockRows(body.locks),
  };
}

// GET /api/governance/status (unified_api.py:1044-1063)
export function parseStatus(body) {
  if (!isObject(body) || !text(body.availability) || !Array.isArray(body.active_locks)) fail('/status');
  return {
    kind: 'status', availability: body.availability, source: text(body.source), error: text(body.error),
    observedAt: text(body.timestamp), scannedAt: text(body.scanned_at), schema: null, version: null,
    lockCount: Number.isInteger(body.lock_count) ? body.lock_count : null, locks: lockRows(body.active_locks),
    decisions: (body.recent_decisions || []).map(registryEntry),
    policies: (body.policies || []).map(registryEntry),
    policiesAvailability: text(body.policies_availability), policiesReason: text(body.policies_reason),
    enforcementVerified: body.enforcement_verified === true,
  };
}

// Entry projection: policy_registry_adapter.py:54-67 (pointer()). "consumers" is NOT projected.
function registryEntry(entry) {
  if (!isObject(entry) || !text(entry.id) || !text(entry.kind)) fail('Registry-Eintrag ohne id/kind');
  const pick = key => entry[key] === undefined || entry[key] === '' ? null : entry[key];
  return {
    id: entry.id, kind: entry.kind, title: text(entry.title) || text(entry.name),
    scope: pick('scope'), version: pick('version'), privacy: pick('privacy'), status: pick('status'),
    adoption: pick('adoption'), priority: pick('priority'), precedence: pick('precedence'),
    validFrom: pick('valid_from'), validUntil: pick('valid_until'),
    supersedes: pick('supersedes'), supersededBy: pick('superseded_by'),
    sourceLabel: text(entry.source?.label), sourceType: text(entry.source?.type),
    sourceState: text(entry.source_state), sourceVerified: entry.source_verified === true,
    sourceSha256: text(entry.source_sha256), enforcementVerified: entry.enforcement_verified === true,
    hasConsumers: Object.prototype.hasOwnProperty.call(entry, 'consumers'),
  };
}

function registryMeta(body, kind, listKey = 'entries') {
  if (!isObject(body) || !text(body.availability) || !Array.isArray(body.entries) || !Array.isArray(body[listKey])) fail('/' + kind);
  const writer = isObject(body.decision_writer) ? body.decision_writer : null;
  return {
    kind, availability: body.availability, source: text(body.source), error: null,
    observedAt: text(body.observed_at), scannedAt: null, schema: text(body.schema),
    version: text(body.provider?.version), providerId: text(body.provider?.id),
    providerCommit: text(body.provider?.source_commit), providerVerified: body.provider?.verified === true,
    registryVersion: text(body.registry_version), readOnly: body.read_only === true,
    enforcementVerified: body.enforcement_verified === true,
    sourceVerificationComplete: body.source_verification_complete === true,
    count: Number.isInteger(body.count) ? body.count : null,
    rows: body[listKey].map(registryEntry),
    writer: writer ? {id: text(writer.id), available: writer.available === true, reason: text(writer.reason)} : null,
    // The registry projection carries no consumers; per-agent validity is not derivable (#2026).
    consumersProjected: body.entries.some(entry => isObject(entry) && 'consumers' in entry),
  };
}

// GET /api/governance/decisions and /policies spread the registry result (unified_api.py:1113-1128).
// The list keys "decisions"/"policies" carry the handler's own selection; "entries" holds the unfiltered registry.
export const parseDecisions = body => registryMeta(body, 'decisions', 'decisions');
export const parsePolicies = body => registryMeta(body, 'policies', 'policies');
// GET /api/governance/policy-registry (governance_registry.py:18-22)
export const parseRegistry = body => registryMeta(body, 'registry');

// GET /api/governance/effective-policy (governance_registry.py:25-28; adapter lines 98-108).
// effective.selected is a single resolution, never the complete effective rule set.
export function parseEffective(body) {
  const meta = registryMeta(body, 'effective');
  const eff = body.effective;
  if (!isObject(eff)) fail('effective fehlt');
  return {
    ...meta,
    effective: {
      status: text(eff.status), reason: text(eff.reason),
      selected: eff.selected ? registryEntry(eff.selected) : null,
      candidateIds: Array.isArray(eff.candidate_ids) ? eff.candidate_ids.filter(id => typeof id === 'string') : [],
      interactionMode: text(eff.interaction_mode), interactionSource: text(eff.interaction_source),
      governanceBinding: eff.governance_binding ?? null, externalEffectGates: eff.external_effect_gates ?? null,
    },
  };
}

// Display state shared by all tabs: empty vs unknown vs ok are distinguishable.
export function viewState(model) {
  if (model.availability !== 'available') return model.availability === 'stale' ? 'stale' : 'unavailable';
  const rows = model.kind === 'status' ? model.locks : model.rows;
  return rows.length ? 'ok' : 'empty';
}

export function writerNotice(model) {
  if (!model.writer) return 'Writer-Status unbekannt (Antwort enthält kein decision_writer).';
  return model.writer.available
    ? 'Writer gemeldet (' + (model.writer.id || 'unbekannt') + '); diese Ansicht schreibt nicht.'
    : 'Writer nicht angebunden (' + (model.writer.id || 'decision-clicker') + '): ' + (model.writer.reason || 'Grund unbekannt');
}
