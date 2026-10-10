// Client contract for GET /api/capabilities/catalog (schema "bach.catalog.v1", #2016).
// The backend projects existing catalog files at request time; this module only validates the
// response and derives view data. EVERY contract key must be present (nullable ones as null):
// a missing key is a contract error and is never reinterpreted as null / "unverified".
// Items are keyed by type + id only. `aliases` are NOT unique keys: the alias "homebase-stack" belongs to two different stacks
// (ids "systems/homebase-stack" and "stacks/homebase-stack").
export const CATALOG_SCHEMA = 'bach.catalog.v1';
export const ITEM_TYPES = ['module', 'bundle', 'stack', 'skill', 'satellite'];
const AVAILABILITY = ['available', 'missing', 'error'];
const GIT_STATES = ['unknown', 'clean', 'dirty'];
const TIME_BASIS = ['declared', 'file_mtime', 'no_timezone', 'unparsable', 'absent'];
const OBSERVED_BASIS = ['declared', 'no_timezone', 'unparsable', 'absent'];
const REQUIREMENTS = ['required', 'recommended', 'optional', null];
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = what => { throw new Error('Katalogvertrag verletzt: ' + what); };
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;

// Mirrors catalog_projection.py (_PATH_PATTERNS). The server redacts to "<pfad>"; an embedded absolute path
// that still arrives is a contract violation, anywhere in a string.
// Unicode-aware like Python's \w: [\p{L}\p{N}_] with the u flag. Shared test vectors prove both sides agree.
const W = '\\p{L}\\p{N}_';
const TAIL = '[^\\s"\'<>|,;)]*';
const PATH_PATTERNS = [
  new RegExp('file://[^\\s"\'<>|,;)]+', 'u'),                                       // file:// URLs with a path
  new RegExp('(?<![' + W + '])[A-Za-z]:[\\\\/]' + TAIL, 'u'),                       // C:\x, C:/x (also after ":")
  new RegExp('\\\\\\\\[^\\s"\'<>|,;)]+', 'u'),                                       // \\server\share
  new RegExp('(?<![' + W + '])~[\\\\/]' + TAIL, 'u'),                                // ~/x
  new RegExp('%[A-Za-z_]+%[\\\\/]' + TAIL, 'u'),                                     // %USERPROFILE%\x
  // absolute POSIX path: ONE slash followed by a non-slash that starts a token (text start, whitespace, quote, opening
  // bracket, "=", ":", "," or ";" before it); not part of a word, glob or URL ("//host/..."); "/api/..." routes stay
  new RegExp('(?<![^\\s"\'(=\\[:,;])/(?!api/)(?![\\s/])[^\\s"\'<>|,;)]+', 'u'),
];
export const containsAbsolutePath = value => PATH_PATTERNS.some(pattern => pattern.test(value));

function assertNoAbsolutePath(value, where) {
  if (typeof value === 'string') { if (containsAbsolutePath(value)) fail('absoluter Pfad in ' + where); return; }
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoAbsolutePath(item, where + '[' + index + ']')); return; }
  if (isObject(value)) for (const [key, item] of Object.entries(value)) assertNoAbsolutePath(item, where + '.' + key);
}

function requireKeys(object, keys, where) {
  if (!isObject(object)) fail(where + ' ist kein Objekt');
  for (const key of keys) if (!(key in object)) fail(where + ': Pflichtschlüssel ' + key + ' fehlt');
}
const nullableString = (value, where) => {
  if (value !== null && typeof value !== 'string') fail(where + ' muss String oder null sein');
  return value;
};
// A time value is either null or UTC ISO text ("Z" or "+00:00"): the adapter normalises every offset to UTC, a
// naive time is null (original only in *_raw), and any other offset is a contract violation.
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|\+00:00)$/;
const nullableTime = (value, where) => {
  nullableString(value, where);
  if (value !== null && !UTC_TIME.test(value)) fail(where + ' ist keine UTC-Zeit (Z oder +00:00)');
  return value;
};

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

const SOURCE_KEYS = ['id', 'kind', 'path_label', 'host', 'schema', 'source_version', 'generated_at', 'generated_at_basis',
  'generated_at_raw', 'modified_at', 'availability', 'error'];
function sourceRecord(source) {
  requireKeys(source, SOURCE_KEYS, 'Quelle');
  if (!text(source.id) || !text(source.kind) || !text(source.path_label)) fail('Quelle ohne id/kind/path_label');
  const where = 'Quelle ' + source.id;
  if (!AVAILABILITY.includes(source.availability)) fail(where + ': availability unbekannt');
  if (!TIME_BASIS.includes(source.generated_at_basis)) fail(where + ': generated_at_basis unbekannt');
  for (const key of ['host', 'schema', 'source_version', 'generated_at_raw', 'error']) nullableString(source[key], where + '.' + key);
  nullableTime(source.generated_at, where + '.generated_at');
  nullableTime(source.modified_at, where + '.modified_at');
  if (source.generated_at_basis === 'no_timezone' && (source.generated_at !== null || source.generated_at_raw === null))
    fail(where + ': Zeit ohne Zeitzone darf nicht als UTC ausgegeben werden');
  return {
    id: source.id, kind: source.kind, pathLabel: source.path_label, host: source.host, schema: source.schema,
    sourceVersion: source.source_version, generatedAt: source.generated_at, generatedAtBasis: source.generated_at_basis,
    generatedAtRaw: source.generated_at_raw, modifiedAt: source.modified_at, availability: source.availability, error: source.error,
  };
}

const GIT_KEYS = ['state', 'branch', 'last_commit', 'last_commit_raw', 'observed_at', 'observed_at_basis', 'observed_at_raw', 'host', 'source'];
function gitRecord(git, where) {
  requireKeys(git, GIT_KEYS, where + ' git');
  if (!GIT_STATES.includes(git.state)) fail(where + ': git.state ungültig');
  if (!OBSERVED_BASIS.includes(git.observed_at_basis)) fail(where + ': git.observed_at_basis ungültig');
  for (const key of ['branch', 'last_commit_raw', 'observed_at_raw', 'host', 'source']) nullableString(git[key], where + ' git.' + key);
  nullableTime(git.last_commit, where + ' git.last_commit');
  nullableTime(git.observed_at, where + ' git.observed_at');
  return {state: git.state, branch: git.branch, lastCommit: git.last_commit, lastCommitRaw: git.last_commit_raw,
    observedAt: git.observed_at, observedAtBasis: git.observed_at_basis, observedAtRaw: git.observed_at_raw, host: git.host, source: git.source};
}

const ITEM_KEYS = ['id', 'type', 'aliases', 'name', 'description', 'version', 'category', 'status', 'visibility', 'repository',
  'pin', 'provides', 'requires', 'optional', 'relations', 'measured', 'git', 'git_hosts', 'source_ids'];
const PIN_KEYS = ['commit', 'content_hash', 'source_version', 'verified'];
const MEASURED_KEYS = ['installed', 'runtime_active', 'connection_state', 'observed_at', 'host', 'evidence'];
const RELATION_KEYS = ['kind', 'target', 'target_type', 'requirement', 'basis'];
const nullableBoolean = (value, where) => {
  if (value !== null && typeof value !== 'boolean') fail(where + ' muss Boolean oder null sein');
  return value;
};

function itemRecord(item) {
  requireKeys(item, ITEM_KEYS, 'Eintrag');
  if (!text(item.id) || !ITEM_TYPES.includes(item.type) || !text(item.name)) fail('Eintrag ohne id/type/name');
  const where = item.type + ' ' + item.id;
  for (const key of ['description', 'version', 'category', 'status', 'visibility', 'repository']) nullableString(item[key], where + '.' + key);
  requireKeys(item.pin, PIN_KEYS, where + ' pin');
  for (const key of ['commit', 'content_hash', 'source_version']) nullableString(item.pin[key], where + ' pin.' + key);
  nullableBoolean(item.pin.verified, where + ' pin.verified');
  requireKeys(item.measured, MEASURED_KEYS, where + ' measured');
  nullableBoolean(item.measured.installed, where + ' measured.installed');
  nullableBoolean(item.measured.runtime_active, where + ' measured.runtime_active');
  if (!text(item.measured.connection_state)) fail(where + ': measured.connection_state fehlt');
  for (const key of ['host', 'evidence']) nullableString(item.measured[key], where + ' measured.' + key);
  nullableTime(item.measured.observed_at, where + ' measured.observed_at');
  for (const key of ['aliases', 'provides', 'requires', 'optional', 'relations', 'git_hosts', 'source_ids'])
    if (!Array.isArray(item[key])) fail(where + ': ' + key + ' muss eine Liste sein');
  for (const key of ['aliases', 'provides', 'requires', 'optional', 'source_ids'])
    if (item[key].some(entry => typeof entry !== 'string')) fail(where + ': ' + key + ' enthält Nicht-Strings');
  if (!item.source_ids.length) fail(where + ': source_ids fehlen');
  const relations = item.relations.map(relation => {
    requireKeys(relation, RELATION_KEYS, where + ' Relation');
    if (!text(relation.kind) || !text(relation.target) || !text(relation.target_type) || relation.basis !== 'declared' ||
        !REQUIREMENTS.includes(relation.requirement)) fail(where + ': Relation ungültig');
    return {kind: relation.kind, target: relation.target, targetType: relation.target_type, requirement: relation.requirement, basis: 'declared'};
  });
  return {
    id: item.id, type: item.type, name: item.name, aliases: item.aliases, description: item.description, version: item.version,
    category: item.category, status: item.status, visibility: item.visibility, repository: item.repository,
    pin: {commit: item.pin.commit, contentHash: item.pin.content_hash, sourceVersion: item.pin.source_version, verified: item.pin.verified},
    provides: item.provides, requires: item.requires, optional: item.optional, relations,
    measured: {installed: item.measured.installed, runtimeActive: item.measured.runtime_active,
      connectionState: item.measured.connection_state, observedAt: item.measured.observed_at, host: item.measured.host, evidence: item.measured.evidence},
    git: gitRecord(item.git, where), gitHosts: item.git_hosts.map(entry => gitRecord(entry, where + ' git_hosts')),
    sourceIds: item.source_ids, pathLabel: typeof item.path_label === 'string' ? item.path_label : null,
    languages: Array.isArray(item.languages) ? item.languages : null,
  };
}

export function parseCatalog(body) {
  requireKeys(body, ['schema', 'generated_at', 'host', 'sources', 'items', 'counts', 'count', 'errors', 'truncated', 'redactions'], 'Antwort');
  if (body.schema !== CATALOG_SCHEMA) fail('schema');
  assertNoAbsolutePath(body, 'Antwort');
  if (!text(body.generated_at) || !UTC_TIME.test(body.generated_at)) fail("generated_at fehlt oder ist keine UTC-Zeit");
  requireKeys(body.host, ['id', 'source'], 'host');
  if (!['measured', 'declared'].includes(body.host.source)) fail('host.source');
  nullableString(body.host.id, 'host.id');
  if (!Array.isArray(body.sources) || !Array.isArray(body.items) || !Array.isArray(body.errors) || !isObject(body.counts) ||
      typeof body.truncated !== 'boolean' || !Number.isInteger(body.redactions)) fail('Pflichtfelder');
  const sources = body.sources.map(sourceRecord);
  const known = new Set(sources.map(source => source.id));
  const items = body.items.map(itemRecord);
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.type + ':' + item.id)) fail('doppelte id ' + item.id);
    ids.add(item.type + ':' + item.id);
    for (const sourceId of item.sourceIds) if (!known.has(sourceId)) fail(item.id + ': unbekannte Quelle ' + sourceId);
  }
  for (const type of new Set(items.map(item => item.type)))
    if (!(type in body.counts)) fail('counts.' + type + ' fehlt');
  const counts = {};
  for (const [type, value] of Object.entries(body.counts)) {
    if (!ITEM_TYPES.includes(type)) fail('counts.' + type);
    counts[type] = items.filter(item => item.type === type).length;
    if (value !== counts[type]) fail('counts.' + type + ' stimmt nicht mit den Einträgen überein');
  }
  if (body.count !== items.length) fail('count stimmt nicht mit den Einträgen überein');
  const errors = body.errors.map(error => {
    requireKeys(error, ['source', 'reason', 'item'], 'Fehlereintrag');
    if (!text(error.source) || !text(error.reason)) fail('Fehlereintrag ohne source/reason');
    nullableString(error.item, 'errors.item');
    return {source: error.source, reason: error.reason, item: error.item};
  });
  return {
    generatedAt: body.generated_at, host: {id: body.host.id, source: body.host.source}, sources, items, counts, errors,
    truncated: body.truncated, redactions: body.redactions,
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
