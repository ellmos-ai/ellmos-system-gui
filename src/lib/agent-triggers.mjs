const BASE = '/api/agent-triggers';
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
export class TriggerError extends Error {
  constructor(state, message) { super(message); this.state = state; }
}
const invalid = () => { throw new TriggerError('invalid', 'Ungültiger Triggervertrag'); };
const canonical = value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
});
function identifier(value) { if (typeof value !== 'string' || !ID.test(value)) invalid(); return value; }
export function parseTrigger(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  identifier(value.id); identifier(value.agent_id);
  if (!Number.isSafeInteger(value.version) || value.version < 1
      || !Number.isSafeInteger(value.revision) || value.revision < 1
      || typeof value.enabled !== 'boolean' || typeof value.deleted !== 'boolean'
      || !value.schedule || !['once', 'daily', 'interval', 'cron', 'event'].includes(value.schedule.kind)) invalid();
  return structuredClone(value);
}
function envelope(data) {
  if (data?.schema !== 'bach.agent-triggers.v1' || data.provider !== 'ellmos-scheduler'
      || data.source !== 'external_scheduler' || data.state !== 'available')
    throw new TriggerError('unavailable', 'Triggerverwaltung ist nicht verfügbar');
  return data;
}
export function createTriggerClient(fetcher = globalThis.fetch) {
  async function request(path, method = 'GET', body) {
    let response;
    try {
      response = await fetcher(path, {method, redirect: 'error',
        ...(body === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})});
    } catch { throw new TriggerError('unavailable', 'Triggerverwaltung ist nicht erreichbar'); }
    if (!response.ok) {
      if (response.status === 400 || response.status === 422)
        throw new TriggerError('invalid', 'Eingaben wurden abgelehnt. Bitte Zeitplan und Parameter prüfen.');
      const state = response.status === 409 ? 'conflict' : response.status === 401 || response.status === 403 ? 'auth' : 'unavailable';
      throw new TriggerError(state, state === 'conflict' ? 'Definition geändert. Entwurf bleibt erhalten; bitte neu laden.'
        : state === 'auth' ? 'Geräteanmeldung erforderlich' : 'Triggerverwaltung ist nicht verfügbar');
    }
    try { return envelope(await response.json()); }
    catch (error) { if (error instanceof TriggerError) throw error; invalid(); }
  }
  const path = id => BASE + '/' + encodeURIComponent(identifier(id));
  async function get(id) {
    const value = parseTrigger((await request(path(id))).trigger);
    if (value.id !== id) invalid();
    return value;
  }
  async function write(id, method, body) {
    const data = await request(method === 'POST' ? BASE : path(id), method, body);
    const saved = parseTrigger(data.trigger);
    if (saved.id !== id || data.ack?.configuration_saved !== true
        || data.ack?.readback_verified !== true || data.ack?.worker_started !== false) invalid();
    const wanted = method === 'POST' ? body : method === 'PUT' ? body.changes : {deleted: true, enabled: false};
    if (saved.version !== body.expected_version + 1
        || Object.entries(wanted).some(([key, value]) => key !== 'expected_version' && canonical(saved[key]) !== canonical(value))) invalid();
    const readback = await get(id);
    if (readback.version !== saved.version || canonical(readback) !== canonical(saved))
      throw new TriggerError('conflict', 'Speicherung ist nicht unabhängig bestätigt. Entwurf bleibt erhalten.');
    return readback;
  }
  return {
    get,
    async list(agentId) {
      const data = await request(BASE + (agentId ? '?agent_id=' + encodeURIComponent(identifier(agentId)) : ''));
      if (!Array.isArray(data.triggers)) invalid();
      const values = data.triggers.map(parseTrigger);
      if (new Set(values.map(v => v.id)).size !== values.length || values.some(v => agentId && v.agent_id !== agentId)) invalid();
      return values;
    },
    create(draft) { identifier(draft.id); return write(draft.id, 'POST', {...draft, expected_version: 0}); },
    update(snapshot, changes) { const v = parseTrigger(snapshot); return write(v.id, 'PUT', {expected_version: v.version, changes}); },
    remove(snapshot) { const v = parseTrigger(snapshot); return write(v.id, 'DELETE', {expected_version: v.version}); },
  };
}
