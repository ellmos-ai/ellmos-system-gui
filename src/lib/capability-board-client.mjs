export const SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const REVISION = /^[a-f0-9]{64}$/;
export const INVENTORIES = {
  skills: '/api/capabilities/skills/library',
  plugins: '/api/capabilities/plugins/inventory',
  mcp: '/api/capabilities/mcp/connections',
  software: '/api/capabilities/software',
  ocean: '/api/capabilities/ocean',
};
const defaultFetcher = globalThis.fetch;

function withLocale(url, requestedLocale) {
  if (typeof requestedLocale !== 'string' || !requestedLocale.trim()) return url;
  const separator = url.includes('?') ? '&' : '?';
  return url + separator + 'locale=' + encodeURIComponent(requestedLocale.trim());
}

export function confirmSkillReplacement(content, loadedContent, ask) {
  return content === loadedContent || ask('Ungespeicherte Änderungen durch die ausgewählte Fassung ersetzen?') === true;
}

export async function requestJson(url, options = {}, fetcher = globalThis.fetch) {
  const response = await fetcher(url, options);
  let data;
  try { data = await response.json(); }
  catch {
    const error = new Error('Die Quelle liefert keine lesbare Antwort.');
    error.status = response.status; // der Statuscode bleibt auch bei unlesbarem Körper erhalten
    throw error;
  }
  if (!response.ok) {
    const error = new Error(response.status === 409
      ? 'Die Quelle wurde inzwischen geändert. Lade die aktuelle Fassung vor dem Speichern.'
      : typeof data?.detail === 'string' ? data.detail : 'Die Anfrage konnte nicht bestätigt werden.');
    error.status = response.status;
    throw error;
  }
  return data;
}

// Fehleranzeige für Inventare: 401, 403, 503 und sonstige Statuscodes bleiben unterscheidbar.
export function describeSourceError(error) {
  const status = Number.isInteger(error?.status) ? error.status : null;
  const detail = typeof error?.message === 'string' && error.message ? error.message : 'unbekannter Fehler';
  if (status === 401) return 'Nicht angemeldet (HTTP 401): Die Geräteanmeldung fehlt oder ist abgelaufen. ' + detail;
  if (status === 403) return 'Zugriff verweigert (HTTP 403): Das Gerät ist für diese Quelle nicht freigegeben. ' + detail;
  if (status === 503) return 'Quelle nicht verfügbar (HTTP 503): Der Dienst oder die Konfiguration ist nicht bereit. ' + detail;
  if (status !== null) return 'Quelle antwortet mit HTTP ' + status + '. ' + detail;
  return detail;
}

export async function loadSkill(id, requestedLocaleOrFetcher, maybeFetcher) {
  if (!SKILL_ID.test(id)) throw new Error('Ungültige Skill-Kennung.');
  const requestedLocale = typeof requestedLocaleOrFetcher === 'string' ? requestedLocaleOrFetcher : '';
  const fetcher = typeof requestedLocaleOrFetcher === 'string'
    ? maybeFetcher || defaultFetcher : requestedLocaleOrFetcher || defaultFetcher;
  const source = await requestJson(withLocale('/api/capabilities/skills/' + encodeURIComponent(id) + '/source', requestedLocale), {}, fetcher);
  if (source.id !== id || (source.canonical_skill_id && source.canonical_skill_id !== id)
      || typeof source.content !== 'string' || !REVISION.test(source.source_version)
      || (source.resolved_locale !== undefined && typeof source.resolved_locale !== 'string'))
    throw new Error('Die aktuelle Skill-Fassung konnte nicht bestätigt werden.');
  return source;
}

export async function saveSkill(source, content, requestedLocaleOrFetcher, maybeFetcher) {
  const requestedLocale = typeof requestedLocaleOrFetcher === 'string'
    ? requestedLocaleOrFetcher : source?.requested_locale || '';
  const fetcher = typeof requestedLocaleOrFetcher === 'string'
    ? maybeFetcher || defaultFetcher : requestedLocaleOrFetcher || defaultFetcher;
  if (!source || !SKILL_ID.test(source.id)
      || !(source.source_version === '0' || REVISION.test(source.source_version))
      || typeof content !== 'string' || !content.trim())
    throw new Error('Skill-Kennung, Inhalt und geladene Quellenversion sind erforderlich.');
  const body = {content, source_version: source.source_version};
  if (requestedLocale) body.requested_locale = requestedLocale;
  const saved = await requestJson(withLocale('/api/capabilities/skills/' + encodeURIComponent(source.id) + '/source', requestedLocale), {
    method: 'PUT', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  }, fetcher);
  if (saved.id !== source.id || saved.content !== content || saved.receipt?.source_saved !== true)
    throw new Error('Der Speicherbeleg stimmt nicht mit der Änderung überein.');
  const observed = requestedLocale
    ? await loadSkill(source.id, requestedLocale, fetcher)
    : await loadSkill(source.id, fetcher);
  if (observed.source_version !== saved.source_version || observed.content !== content)
    throw new Error('Die Quelle wurde nach dem Speichern erneut geändert. Prüfe die aktuelle Fassung.');
  return observed;
}
