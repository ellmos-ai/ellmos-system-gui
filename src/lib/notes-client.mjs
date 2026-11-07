// Notizen-Vertrag (PB-11, #3994): BACH system/hub/_services/notes_adapter.py, Routen GET/POST /api/notes,
// POST /api/notes/{id}/archive|unarchive. Die GUI kennt nur das llm-note-Vokabular (note/logbook).
export const KIND_TO_TYPE = Object.freeze({gedanken: 'note', logbuch: 'logbook'});
export const LIST_LIMIT = 200;

// state: {kind: 'all'|'gedanken'|'logbuch', search, includeArchived}
export function listQuery(state = {}) {
  const query = new URLSearchParams({limit: String(LIST_LIMIT)});
  if (KIND_TO_TYPE[state.kind]) query.set('entry_type', KIND_TO_TYPE[state.kind]);
  const search = String(state.search || '').trim();
  if (search) query.set('search', search);
  if (state.includeArchived) query.set('include_archived', 'true');
  return query;
}

export function createBody({kind, tag, title, body}) {
  const cleanTitle = String(title || '').trim();
  const content = String(body || '').trim();
  if (!cleanTitle || !content) throw new Error('Titel und Inhalt werden benötigt.');
  return {
    entry_type: KIND_TO_TYPE[kind] || 'note',
    category: String(tag || '').trim() || 'note',
    title: cleanTitle,
    content,
    source: 'web',
  };
}

export function readNotes(data) {
  if (!data || !Array.isArray(data.entries) || !data.stats || typeof data.stats !== 'object')
    throw new Error('Die Notizen-Antwort ist ungültig.');
  return {entries: data.entries, stats: data.stats, categories: Array.isArray(data.categories) ? data.categories : []};
}

// Ehrlicher Fehlertext: nie eine leere Liste vortäuschen.
export function describeFailure(status, body) {
  if (!status) return 'Notizen nicht erreichbar (keine Verbindung zum Backend).';
  const reason = (body && (body.detail || body.reason_code || body.error)) || 'ohne Begründung';
  return `Notizen nicht verfügbar (HTTP ${status}: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}).`;
}

async function call(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (_error) {
    throw new Error(describeFailure(0, null));
  }
  let data = null;
  try { data = await response.json(); } catch (_error) { /* leerer oder kein JSON-Body */ }
  if (!response.ok) throw new Error(describeFailure(response.status, data));
  return data;
}

const JSON_HEADERS = {'Content-Type': 'application/json'};

export async function loadNotes(state) {
  return readNotes(await call('/api/notes?' + listQuery(state).toString()));
}

export async function createNote(input) {
  return call('/api/notes', {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(createBody(input))});
}

export async function archiveNote(id, reason) {
  return call('/api/notes/' + encodeURIComponent(id) + '/archive',
    {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({reason: reason || 'archiviert'})});
}

export async function unarchiveNote(id) {
  return call('/api/notes/' + encodeURIComponent(id) + '/unarchive', {method: 'POST', headers: JSON_HEADERS, body: '{}'});
}
