// Consumer-owned configuration. This client never starts or loads a model.
const BASE = '/api/system/model-sockets';
const VERSION = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,191}$/;
const SOCKET = /^model-[a-f0-9]{24}$/;
const BINDING = /^binding-[a-f0-9]{24}$/;
const LOCAL = new Set(['ollama', 'lmstudio']);
const integer = (n, low, high) => Number.isInteger(n) && n >= low && n <= high;
const fail = () => { throw new Error('Die Modellzuordnung konnte nicht bestätigt werden.'); };
const localTarget = item => item && LOCAL.has(item.backend) && typeof item.model === 'string' && MODEL.test(item.model) &&
  !item.model.toLowerCase().endsWith(':cloud') && typeof item.host_id === 'string' && ID.test(item.host_id);

export function socketSnapshot(value) {
  if (!value || value.schema !== 'bach.model-sockets.v1' || typeof value.configuration_version !== 'string' || !VERSION.test(value.configuration_version) ||
      typeof value.host_id !== 'string' || !ID.test(value.host_id) || typeof value.migration_required !== 'boolean' ||
      value.source !== (value.migration_required ? 'legacy_projection' : 'canonical_slots_config') ||
      !Array.isArray(value.sockets) || !Array.isArray(value.unbound_agent_ids) ||
      !integer(value.host_inference_limit, 1, 1000)) fail();
  const targets = new Set(), bindings = new Set();
  for (const socket of value.sockets) {
    if (!localTarget(socket) || !SOCKET.test(socket.id) || targets.has(socket.id) ||
        socket.host_id !== value.host_id || typeof socket.enabled !== 'boolean' ||
        !integer(socket.max_active_slots, 1, 1000) || !['exclusive', 'shared'].includes(socket.residency_policy) ||
        !Array.isArray(socket.slots) || typeof socket.capacity_verified !== 'boolean' ||
        !integer(socket.effective_max_active_slots, 1, 1000)) fail();
    targets.add(socket.id);
    for (const slot of socket.slots) {
      if (!slot || !BINDING.test(slot.id) || bindings.has(slot.id) || typeof slot.agent_id !== 'string' || !ID.test(slot.agent_id) ||
          slot.socket_id !== socket.id || typeof slot.enabled !== 'boolean' ||
          typeof slot.orphaned !== 'boolean' || !['foreground', 'background'].includes(slot.priority) ||
          !(slot.context_tokens === null || integer(slot.context_tokens, 1, 1048576))) fail();
      bindings.add(slot.id);
    }
  }
  if (value.unbound_agent_ids.some(id => typeof id !== 'string' || !ID.test(id)) ||
      new Set(value.unbound_agent_ids).size !== value.unbound_agent_ids.length) fail();
  return structuredClone(value);
}

export function modelCatalogue(value, host) {
  if (!value || value.schema !== 'bach.local-model-catalog.v1' || value.host_id !== host ||
      value.source !== 'configured_native_provider_metadata' || typeof value.observed_at !== 'string' ||
      !Number.isFinite(Date.parse(value.observed_at)) ||
      !Array.isArray(value.models) || !Array.isArray(value.providers) || !Array.isArray(value.excluded))
    throw new Error('Der lokale Modellkatalog konnte nicht bestätigt werden.');
  const ids = new Set();
  for (const model of value.models) {
    if (!localTarget(model) || !SOCKET.test(model.socket_id) || model.host_id !== host ||
        ids.has(model.socket_id) || model.local_metadata_verified !== true ||
        !Array.isArray(model.capabilities) || !model.capabilities.length ||
        model.capabilities.some(c => typeof c !== 'string' || c.length > 80) ||
        model.chat_eligible !== model.capabilities.includes('completion') ||
        model.native_tools_capable !== model.capabilities.includes('tools'))
      throw new Error('Der lokale Modellkatalog enthält unbestätigte Fähigkeiten.');
    ids.add(model.socket_id);
  }
  if (value.providers.some(p => !p || !LOCAL.has(p.backend) || !['verified', 'unknown'].includes(p.status)))
    throw new Error('Der Anbieterstatus ist nicht bestätigt.');
  return structuredClone(value);
}

export function agentChoices(snapshot) {
  const names = new Map(snapshot.unbound_agent_ids.map(id => [id, id]));
  for (const socket of snapshot.sockets) for (const slot of socket.slots)
    if (!slot.orphaned) names.set(slot.agent_id, String(slot.name || slot.agent_id));
  return [...names].map(([id, name]) => ({id, name})).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

async function request(path, options, fetcher) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(BASE + path, {...options, redirect:'error', signal:controller.signal});
    let body;
    try { body = await response.json(); }
    catch { throw new Error('Die Quelle liefert keine lesbare Antwort.'); }
    if (!response.ok) {
      const error = new Error(response.status === 409
        ? 'Die Konfiguration wurde inzwischen geändert. Lade sie neu und prüfe deinen Entwurf.'
        : response.status === 404 ? 'Die Modellzuordnung ist in diesem System noch nicht angebunden.'
        : response.status === 401 || response.status === 403 ? 'Bitte die Geräteanmeldung prüfen.'
        : 'Die Modellzuordnung ist derzeit nicht verfügbar.');
      error.status = response.status;
      throw error;
    }
    return body;
  } finally { clearTimeout(timeout); }
}

export async function loadSocketSnapshot(fetcher = globalThis.fetch) {
  return socketSnapshot(await request('', {method:'GET'}, fetcher));
}

export async function loadModelCatalogue(host, fetcher = globalThis.fetch) {
  return modelCatalogue(await request('/catalog', {method:'GET'}, fetcher), host);
}

export async function saveSocketChange(snapshot, operation, fetcher = globalThis.fetch) {
  snapshot = socketSnapshot(snapshot);
  if (snapshot.migration_required) throw new Error('Die Modellzuordnung ist noch nicht eingerichtet.');
  let path = '', method = 'PUT', payload = {configuration_version:snapshot.configuration_version};
  const keys = value => Object.keys(value).sort().join(',');
  if (operation?.kind === 'socket') {
    const change = operation.changes;
    if (!localTarget({...change, host_id:snapshot.host_id}) || typeof change.enabled !== 'boolean' ||
        !integer(change.max_active_slots, 1, 1000) || !['exclusive', 'shared'].includes(change.residency_policy) ||
        keys(change) !== 'backend,enabled,max_active_slots,model,residency_policy') fail();
    payload.changes = change;
  } else if (operation?.kind === 'bind') {
    const change = operation.changes;
    if (typeof operation.agent_id !== 'string' || !ID.test(operation.agent_id) || !SOCKET.test(operation.socket_id) ||
        !agentChoices(snapshot).some(a => a.id === operation.agent_id) ||
        !snapshot.sockets.some(s => s.id === operation.socket_id) || typeof change?.enabled !== 'boolean' ||
        !['foreground', 'background'].includes(change.priority) ||
        !(change.context_tokens === null || integer(change.context_tokens, 1, 1048576)) ||
        keys(change) !== 'context_tokens,enabled,priority') fail();
    path = '/bindings/' + encodeURIComponent(operation.agent_id) + '/' + encodeURIComponent(operation.socket_id);
    payload.changes = change;
  } else if (operation?.kind === 'unbind') {
    if (!BINDING.test(operation.binding_id) ||
        !snapshot.sockets.some(s => s.slots.some(b => b.id === operation.binding_id))) fail();
    path = '/bindings/' + encodeURIComponent(operation.binding_id);
    method = 'DELETE';
  } else fail();
  const saved = socketSnapshot(await request(path, {method, headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)}, fetcher));
  if (saved.host_id !== snapshot.host_id || saved.migration_required ||
      saved.ack?.configuration_saved !== true || saved.ack?.worker_started !== false ||
      saved.ack?.runtime_verified !== false) throw new Error('Die Speicherung ist nicht bestätigt.');
  const observed = await loadSocketSnapshot(fetcher);
  if (observed.host_id !== saved.host_id || observed.configuration_version !== saved.configuration_version ||
      observed.migration_required) throw new Error('Die Konfiguration wurde nach dem Speichern geändert. Bitte neu prüfen.');
  const configured = value => JSON.stringify({host:value.host_id,
    unbound:[...value.unbound_agent_ids].sort(), sockets:value.sockets.map(s => ({id:s.id, backend:s.backend,
      model:s.model, host:s.host_id, enabled:s.enabled, max_active_slots:s.max_active_slots, residency_policy:s.residency_policy,
      slots:s.slots.map(b => ({id:b.id, agent_id:b.agent_id, socket_id:b.socket_id, enabled:b.enabled,
        priority:b.priority, context_tokens:b.context_tokens})).sort((a,b) => a.id.localeCompare(b.id))
    })).sort((a,b) => a.id.localeCompare(b.id))});
  if (configured(saved) !== configured(observed)) throw new Error('Speicherbeleg und rückgelesene Zuordnung stimmen nicht überein.');
  if (operation.kind === 'socket') {
    const c = operation.changes;
    const socket = observed.sockets.find(s => s.backend === c.backend && s.model === c.model);
    if (!socket || Object.entries(c).some(([k, v]) => socket[k] !== v)) fail();
  } else if (operation.kind === 'bind') {
    const slot = observed.sockets.find(s => s.id === operation.socket_id)?.slots.find(b => b.agent_id === operation.agent_id);
    if (!slot || slot.orphaned || Object.entries(operation.changes).some(([k, v]) => slot[k] !== v)) fail();
  } else if (observed.sockets.some(s => s.slots.some(b => b.id === operation.binding_id))) fail();
  return observed;
}
