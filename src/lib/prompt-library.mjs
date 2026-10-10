// Prompt library client (P-1963-P3): the existing BACH APIs /api/prompt-library* are the ONLY store (tables
// prompt_templates / prompt_versions, same data as `bach prompt`). This module holds no data of its own: it validates the
// responses strictly, classifies failures into separate states and keeps all ids as integers taken from the API,
// never from display names.
export const DRAFT_KEY = 'bach.chat.draft.v1';   // same key and payload as static/js/prompt-chat-draft.js (BachChatDraft)
export const MAX_DRAFT_LENGTH = 200000;
const BASE = '/api/prompt-library';

export class ApiError extends Error {
  constructor(kind, message, status, detail) { super(message); this.kind = kind; this.status = status ?? 0; this.detail = detail ?? null; }
}

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = what => { throw new ApiError('contract', 'Antwortvertrag verletzt: ' + what, 0); };
const nullableText = (v, where) => { if (v !== null && v !== undefined && typeof v !== 'string') fail(where); return v ?? null; };
const requireId = (v, where) => { if (!Number.isInteger(v) || v < 1) fail(where + ' ist keine positive Ganzzahl'); return v; };

export function failureOf(status, body) {
  const detail = isObject(body) && typeof body.detail === 'string' ? body.detail : null;
  if (status === 0) return {kind: 'network', label: 'Backend nicht erreichbar', detail};
  if (status === 401 || status === 403) return {kind: 'auth', label: 'Geräteanmeldung fehlt oder ungültig (HTTP ' + status + ')', detail};
  if (status === 404) return {kind: 'notfound', label: 'Nicht gefunden (HTTP 404)', detail};
  if (status === 409) return {kind: 'conflict', label: 'Konflikt (HTTP 409)', detail};
  if (status === 400 || status === 422) return {kind: 'invalid', label: 'Eingabe abgelehnt (HTTP ' + status + ')', detail};
  if (status === 503) return {kind: 'unavailable', label: 'Prompt-Bibliothek nicht verfügbar (HTTP 503)', detail};
  return {kind: 'server', label: 'Serverfehler (HTTP ' + status + ')', detail};
}

export function parsePromptList(body) {
  if (!isObject(body) || !Array.isArray(body.prompts) || !Array.isArray(body.categories)) fail('prompts/categories fehlen');
  const prompts = body.prompts.map(p => {
    if (!isObject(p) || typeof p.name !== 'string' || !p.name) fail('Prompt ohne Name');
    return {id: requireId(p.id, 'prompt.id'), name: p.name, category: nullableText(p.category, 'category'), purpose: nullableText(p.purpose, 'purpose'),
      tags: nullableText(p.tags, 'tags'), createdAt: nullableText(p.created_at, 'created_at'), updatedAt: nullableText(p.updated_at, 'updated_at')};
  });
  if (new Set(prompts.map(p => p.id)).size !== prompts.length) fail('doppelte Prompt-ID');
  if (body.categories.some(c => typeof c !== 'string')) fail('Kategorie ist kein Text');
  return {prompts, categories: body.categories};
}

export function parsePromptDetail(body) {
  if (!isObject(body) || !isObject(body.prompt) || !Array.isArray(body.versions)) fail('prompt/versions fehlen');
  const p = body.prompt;
  if (typeof p.name !== 'string' || typeof p.text !== 'string') fail('Prompt ohne Name oder Text');
  const versions = body.versions.map(v => {
    if (!isObject(v) || typeof v.text !== 'string') fail('Version ohne Text');
    if (!Number.isInteger(v.version_number) || v.version_number < 1) fail('version_number');
    return {id: v.id ?? null, versionNumber: v.version_number, text: v.text, tags: nullableText(v.tags, 'version.tags'), createdAt: nullableText(v.created_at, 'created_at')};
  });
  return {prompt: {id: requireId(p.id, 'prompt.id'), name: p.name, text: p.text, category: nullableText(p.category, 'category'),
    purpose: nullableText(p.purpose, 'purpose'), tags: nullableText(p.tags, 'tags'), createdAt: nullableText(p.created_at, 'created_at'), updatedAt: nullableText(p.updated_at, 'updated_at')}, versions};
}

export const emptyToNull = value => { const t = String(value ?? '').trim(); return t || null; };

export function createPromptClient(fetcher = globalThis.fetch) {
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
  const idPath = id => { if (!Number.isInteger(id) || id < 1) throw new ApiError('invalid', 'Ungültige Prompt-ID', 0); return BASE + '/' + id; };
  return {
    async list({q, category} = {}) {
      const params = new URLSearchParams();
      if (q && q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      const query = params.toString();
      return parsePromptList(await request('GET', BASE + (query ? '?' + query : '')));
    },
    async get(id) { return parsePromptDetail(await request('GET', idPath(id))); },
    async create({name, text, category, purpose, tags}) {
      const clean = String(name ?? '').trim();
      if (!clean || !String(text ?? '').trim()) throw new ApiError('invalid', 'Name und Text sind Pflicht', 0);
      const data = await request('POST', BASE, {name: clean, text, category: emptyToNull(category), purpose: emptyToNull(purpose), tags: emptyToNull(tags)});
      return requireId(data.id, 'id der Neuanlage');
    },
    async update(id, {text, tags}) {
      if (!String(text ?? '').trim()) throw new ApiError('invalid', 'Text ist Pflicht', 0);
      const data = await request('PUT', idPath(id), {text, tags: emptyToNull(tags)});
      if (!Number.isInteger(data.archived_version)) fail('archived_version fehlt');
      return {archivedVersion: data.archived_version};
    },
    async remove(id) { await request('DELETE', idPath(id)); },
    async importPromptBoard() {
      const d = await request('POST', BASE + '/import-promptboard');
      for (const key of ['imported', 'skipped', 'invalid']) if (!Number.isInteger(d[key])) fail('Import: ' + key);
      return {imported: d.imported, skipped: d.skipped, invalid: d.invalid, source: typeof d.source === 'string' ? d.source : null};
    },
  };
}

// Same contract as BachChatDraft (sessionStorage, key bach.chat.draft.v1): the legacy /chat page consumes it.
export function storeChatDraft(text, storage = globalThis.sessionStorage) {
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('Chat-Entwurf muss ein nicht leerer Text sein');
  if (text.length > MAX_DRAFT_LENGTH) throw new RangeError('Chat-Entwurf ist zu groß');
  storage.setItem(DRAFT_KEY, JSON.stringify({text, createdAt: Date.now()}));
}

// "Latest wins": a slow older list response must never overwrite a newer one.
export function createLatest() {
  let current = 0;
  return {next: () => ++current, isCurrent: token => token === current};
}

export function createDebouncer(fn, ms, timers = globalThis) {
  let handle = null;
  return {call(...args) { timers.clearTimeout(handle); handle = timers.setTimeout(() => fn(...args), ms); }, cancel() { timers.clearTimeout(handle); handle = null; }};
}

// The list state is exactly one of: loading, error, empty (nothing stored), nofilter-hit (filter active), list.
export function listState({loading, error, prompts, filtered}) {
  if (loading) return 'loading';
  if (error) return 'error:' + error.kind;
  if (!prompts.length) return filtered ? 'no-match' : 'empty';
  return 'list';
}
