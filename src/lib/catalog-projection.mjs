// Client contract for GET /api/capabilities/catalog (schema "bach.catalog.v1", #2016).
// The backend projects existing catalog files at request time; this module only validates the
// response and derives view data. Missing required fields are contract errors, never defaults.
export const CATALOG_SCHEMA = 'bach.catalog.v1';
export const ITEM_TYPES = ['module', 'bundle', 'skill', 'satellite'];
const AVAILABILITY = ['available', 'missing', 'error'];
const GIT_STATES = ['unknown', 'clean', 'dirty'];
const REQUIREMENTS = ['required', 'recommended', 'optional', null];
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const fail = what => { throw new Error('Katalogvertrag verletzt: ' + what); };
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|var|etc|opt|mnt|tmp)\/)/;

function assertNoAbsolutePath(value, where) {
  if (typeof value === 'string') { if (ABSOLUTE_PATH.test(value)) fail('absoluter Pfad in ' + where); return; }
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoAbsolutePath(item, where + '[' + index + ']')); return; }
  if (isObject(value)) for (const [key, item] of Object.entries(value)) assertNoAbsolutePath(item, where + '.' + key);
}

export function catalogQuery(filters = {}) {
  const query = new URLSearchParams();
  if (filters.kind) {
    if (!ITEM_TYPES.includes(filters.kind)) throw new Error('kind ungültig.');
    query.set('kind', filters.kind);
  }
  const host = text(filters.host);
  if (host) {
    if (host.length > 80) throw new Error('host ist zu lang (max. 80).');
    query.set('host', host);
  }
  return query;
}

function sourceRecord(source) {
  if (!isObject(source) || !text(source.id) || !text(source.kind) || !text(source.path_label)) fail('Quelle ohne id/kind/path_label');
  if (!AVAILABILITY.includes(source.availability)) fail('Quelle ' + source.id + ': availability unbekannt');
  return {
    id: source.id, kind: source.kind, pathLabel: source.path_label, host: text(source.host), schema: text(source.schema),
    sourceVersion: text(source.source_version), generatedAt: text(source.generated_at),
    generatedAtBasis: text(source.generated_at_basis), availability: source.availability, error: text(source.error),
  };
}

function gitRecord(git, where) {
  if (!isObject(git) || !GIT_STATES.includes(git.state)) fail(where + ': git.state ungültig');
  return {state: git.state, branch: text(git.branch), lastCommit: text(git.last_commit), observedAt: text(git.observed_at),
    host: text(git.host), source: text(git.source)};
}

function itemRecord(item) {
  if (!isObject(item) || !text(item.id) || !ITEM_TYPES.includes(item.type) || !text(item.name)) fail('Eintrag ohne id/type/name');
  const where = item.type + ' ' + item.id;
  if (!isObject(item.pin)) fail(where + ': pin fehlt');
  if (!isObject(item.measured)) fail(where + ': measured fehlt');
  if (!Array.isArray(item.relations) || !Array.isArray(item.git_hosts) || !Array.isArray(item.aliases) ||
      !Array.isArray(item.provides) || !Array.isArray(item.requires) || !Array.isArray(item.optional)) fail(where + ': Listenfelder fehlen');
  if (!Array.isArray(item.source_ids) || !item.source_ids.length) fail(where + ': source_ids fehlen');
  const relations = item.relations.map(relation => {
    if (!isObject(relation) || !text(relation.kind) || !text(relation.target) || relation.basis !== 'declared' ||
        !REQUIREMENTS.includes(relation.requirement ?? null)) fail(where + ': Relation ungültig');
    return {kind: relation.kind, target: relation.target, targetType: text(relation.target_type) || 'unknown',
      requirement: relation.requirement ?? null, basis: 'declared'};
  });
  return {
    id: item.id, type: item.type, name: item.name, aliases: item.aliases.filter(a => typeof a === 'string'),
    description: text(item.description), version: text(item.version), category: text(item.category),
    status: text(item.status), visibility: text(item.visibility), repository: text(item.repository),
    pin: {commit: text(item.pin.commit), contentHash: text(item.pin.content_hash), sourceVersion: text(item.pin.source_version),
      verified: typeof item.pin.verified === 'boolean' ? item.pin.verified : null},
    provides: item.provides, requires: item.requires, optional: item.optional, relations,
    measured: {
      installed: typeof item.measured.installed === 'boolean' ? item.measured.installed : null,
      runtimeActive: typeof item.measured.runtime_active === 'boolean' ? item.measured.runtime_active : null,
      connectionState: text(item.measured.connection_state) || 'unverified',
      observedAt: text(item.measured.observed_at), host: text(item.measured.host), evidence: text(item.measured.evidence),
    },
    git: gitRecord(item.git, where), gitHosts: item.git_hosts.map(entry => gitRecord(entry, where + ' git_hosts')),
    sourceIds: item.source_ids, pathLabel: text(item.path_label), languages: Array.isArray(item.languages) ? item.languages : null,
  };
}

export function parseCatalog(body) {
  if (!isObject(body) || body.schema !== CATALOG_SCHEMA) fail('schema');
  assertNoAbsolutePath(body, 'Antwort');
  if (!text(body.generated_at)) fail('generated_at fehlt');
  if (!isObject(body.host) || !['measured', 'declared'].includes(body.host.source)) fail('host');
  if (!Array.isArray(body.sources) || !Array.isArray(body.items) || !Array.isArray(body.errors) ||
      !isObject(body.counts) || typeof body.truncated !== 'boolean') fail('Pflichtfelder');
  const sources = body.sources.map(sourceRecord);
  const known = new Set(sources.map(source => source.id));
  const items = body.items.map(itemRecord);
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.type + ':' + item.id)) fail('doppelte id ' + item.id);
    ids.add(item.type + ':' + item.id);
    for (const sourceId of item.sourceIds) if (!known.has(sourceId)) fail(item.id + ': unbekannte Quelle ' + sourceId);
  }
  const counts = {};
  for (const [type, value] of Object.entries(body.counts)) {
    if (!ITEM_TYPES.includes(type)) fail('counts.' + type);
    counts[type] = items.filter(item => item.type === type).length;
    if (value !== counts[type]) fail('counts.' + type + ' stimmt nicht mit den Einträgen überein');
  }
  if (body.count !== items.length) fail('count stimmt nicht mit den Einträgen überein');
  return {
    generatedAt: body.generated_at, host: {id: text(body.host.id), source: body.host.source}, sources, items, counts,
    errors: body.errors.map(error => ({source: text(error?.source), reason: text(error?.reason), item: text(error?.item)})),
    truncated: body.truncated,
  };
}

// Counts for views always come from the validated items, never from separate text.
export const itemsOfType = (catalog, type) => catalog.items.filter(item => item.type === type);

export function gitLabel(git) {
  if (git.state === 'unknown') return 'Git unbekannt';
  return (git.state === 'dirty' ? 'Änderungen offen' : 'Clean') + (git.host ? ' (' + git.host + ')' : '');
}

export function sourceProblems(catalog) {
  return catalog.sources.filter(source => source.availability !== 'available');
}

export function catalogFailure(status, body) {
  const detail = text(body?.detail) || text(body?.error);
  if (status === 401 || status === 403) return {state: 'auth', label: 'Geräteanmeldung fehlt oder ungültig (HTTP ' + status + ')', detail};
  if (status === 404) return {state: 'route', label: 'Katalog-Endpunkt am Backend nicht vorhanden (HTTP 404)', detail};
  if (status === 422) return {state: 'query', label: 'Abfrage abgelehnt (HTTP 422)', detail};
  if (status === 0) return {state: 'network', label: 'Backend nicht erreichbar', detail};
  return {state: 'error', label: 'Fehler (HTTP ' + status + ')', detail};
}

export async function loadCatalog(filters = {}, fetchImpl = fetch) {
  const query = catalogQuery(filters).toString();
  let response;
  try { response = await fetchImpl('/api/capabilities/catalog' + (query ? '?' + query : '')); }
  catch (_) { throw Object.assign(new Error(catalogFailure(0).label), {failure: catalogFailure(0, null)}); }
  let body = null;
  try { body = await response.json(); } catch (_) { /* reported below */ }
  if (!response.ok) { const failure = catalogFailure(response.status, body); throw Object.assign(new Error(failure.label), {failure}); }
  return parseCatalog(body);
}
