// Agent <-> Skill/Expert assignment (P-1963-P2): the existing API /api/skills-board/hierarchy of the connected system is the
// ONLY store (table hierarchy_assignments). This module holds no data of its own: it validates responses strictly, classifies
// failures into separate states and refuses to write unless the answer provably came from the database.
const URL_PATH = '/api/skills-board/hierarchy';
export const GROUPS = [
  {key: 'experts', label: 'Experten'}, {key: 'skills', label: 'Skills'},
  {key: 'services', label: 'Dienste'}, {key: 'workflows', label: 'Workflows'},
];

export class ApiError extends Error {
  constructor(kind, message, status, detail) { super(message); this.kind = kind; this.status = status ?? 0; this.detail = detail ?? null; }
}
const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = what => { throw new ApiError('contract', 'Antwortvertrag verletzt: ' + what, 0); };

export function failureOf(status, body) {
  const detail = isObject(body) && typeof body.detail === 'string' ? body.detail : null;
  if (status === 0) return {kind: 'network', label: 'Backend nicht erreichbar', detail};
  if (status === 401 || status === 403) return {kind: 'auth', label: 'Geräteanmeldung fehlt oder ungültig (HTTP ' + status + ')', detail};
  if (status === 404 || status === 501) return {kind: 'unavailable', label: 'Zuordnung: Adapter nicht verfügbar (HTTP ' + status + ')', detail};
  if (status === 400 || status === 422) return {kind: 'invalid', label: 'Eingabe abgelehnt (HTTP ' + status + ')', detail};
  if (status === 413) return {kind: 'invalid', label: 'Anfrage zu groß (HTTP 413)', detail};
  if (status === 503) return {kind: 'table-missing', label: 'Zuordnungstabelle nicht verfügbar (HTTP 503)', detail};
  return {kind: 'server', label: 'Serverfehler (HTTP ' + status + ')', detail};
}

const emptyLists = () => Object.fromEntries(GROUPS.map(g => [g.key, []]));

// Strict parse. `writable` is true ONLY for _meta.source === "bach.db": on a database error the server answers 200 with an empty
// structure, and a write built from that would delete assignments that were never loaded.
export function parseHierarchy(body) {
  if (!isObject(body) || !isObject(body.items) || !isObject(body.assignments)) fail('items/assignments fehlen');
  const names = {};
  const items = {};
  for (const key of ['agents', ...GROUPS.map(g => g.key)]) {
    const rows = body.items[key];
    if (!Array.isArray(rows)) fail('items.' + key + ' fehlt');
    const seen = new Set();
    items[key] = rows.map(r => {
      if (!isObject(r) || typeof r.id !== 'string' || !r.id) fail('Eintrag ohne id in ' + key);
      if (seen.has(r.id)) fail('doppelte id ' + r.id + ' in ' + key);
      seen.add(r.id);
      return {id: r.id, name: typeof r.name === 'string' && r.name ? r.name : r.id, description: typeof r.description === 'string' ? r.description : ''};
    });
    names[key] = seen;
  }
  const assignments = {};
  for (const agent of items.agents) {
    const raw = body.assignments[agent.id];
    const lists = emptyLists();
    if (raw !== undefined) {
      if (!isObject(raw)) fail('assignments.' + agent.id);
      for (const {key} of GROUPS) {
        const ids = raw[key] ?? [];
        if (!Array.isArray(ids) || ids.some(i => typeof i !== 'string')) fail('assignments.' + agent.id + '.' + key);
        lists[key] = [...new Set(ids)].filter(id => names[key].has(id));
      }
    }
    assignments[agent.id] = lists;
  }
  const source = isObject(body._meta) && typeof body._meta.source === 'string' ? body._meta.source : null;
  return {items, assignments, source, writable: source === 'bach.db'};
}

const norm = lists => Object.fromEntries(GROUPS.map(({key}) => [key, [...new Set(lists?.[key] ?? [])].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : a < b ? -1 : a > b ? 1 : 0)]));
const cloneLists = lists => Object.fromEntries(GROUPS.map(({key}) => [key, [...(lists?.[key] ?? [])]]));
export {cloneLists};

// Per group: ids added to / removed from the stored state.
export function diffAssignments(base, draft) {
  const result = {};
  for (const {key} of GROUPS) {
    const before = new Set(base?.[key] ?? []), after = new Set(draft?.[key] ?? []);
    result[key] = {added: [...after].filter(i => !before.has(i)), removed: [...before].filter(i => !after.has(i))};
  }
  return result;
}
export const hasChanges = diff => GROUPS.some(({key}) => diff[key].added.length || diff[key].removed.length);

// A PUT names only this agent, but ALL four lists: the server deletes the stored rows of every list that is left out.
export function buildPutBody(agentId, lists) {
  if (typeof agentId !== 'string' || !agentId) throw new ApiError('invalid', 'Agent fehlt', 0);
  return {assignments: {[agentId]: norm(lists)}};
}

export function verifyReadback(agentId, expected, parsed) {
  const want = norm(expected), got = norm(parsed.assignments[agentId]);
  const problems = [];
  for (const {key} of GROUPS) {
    const missing = want[key].filter(i => !got[key].includes(i)), extra = got[key].filter(i => !want[key].includes(i));
    if (missing.length || extra.length) problems.push({group: key, missing, extra});
  }
  return {ok: problems.length === 0, problems};
}

// The page may only be offered when the adapter declares GET and PUT of the route. Unreadable declaration = unknown (the GET decides).
export function declarationState(caps) {
  if (!isObject(caps) || !Array.isArray(caps.endpoints)) return 'unknown';
  const has = method => caps.endpoints.some(e => isObject(e) && e.method === method && e.path === URL_PATH && e.available !== false);
  return has('GET') && has('PUT') ? 'declared' : 'undeclared';
}

export function createHierarchyClient(fetcher = globalThis.fetch) {
  async function request(method, url, body) {
    let response;
    try { response = await fetcher(url, body === undefined ? {method} : {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}); }
    catch { const f = failureOf(0); throw new ApiError(f.kind, f.label, 0); }
    let data = null;
    try { data = await response.json(); } catch { /* reported below */ }
    if (!response.ok) { const f = failureOf(response.status, data); throw new ApiError(f.kind, f.detail ? f.label + ': ' + f.detail : f.label, response.status, f.detail); }
    if (data === null) fail('keine lesbare Antwort');
    return data;
  }
  async function declared() {
    try { return declarationState(await request('GET', '/api/gui/capabilities')); } catch { return 'unknown'; }
  }
  const load = async () => parseHierarchy(await request('GET', URL_PATH));
  return {
    declared,
    load,
    // Confirmed write: fresh read (must be database-backed and unchanged since `baseLists`), PUT, read back and compare.
    async save(agentId, baseLists, draftLists) {
      const fresh = await load();
      if (!fresh.writable) throw new ApiError('readonly', 'Speichern gesperrt: die Quelle meldet nicht die Datenbank (_meta.source ' + (fresh.source ?? 'fehlt') + ')', 0);
      if (!fresh.assignments[agentId]) throw new ApiError('invalid', 'Agent nicht mehr vorhanden', 0);
      if (hasChanges(diffAssignments(baseLists, fresh.assignments[agentId]))) throw new ApiError('conflict', 'Die Zuordnung wurde inzwischen geändert. Bitte neu laden und die Änderung erneut prüfen.', 0);
      const answer = await request('PUT', URL_PATH, buildPutBody(agentId, draftLists));
      if (answer.status !== 'saved' || answer.persisted !== 'hierarchy_assignments') fail('Speicherbeleg');
      const after = await load();
      return {after, verification: verifyReadback(agentId, draftLists, after), summary: {inserted: answer.inserted, updated: answer.updated, deleted: answer.deleted}};
    },
  };
}
