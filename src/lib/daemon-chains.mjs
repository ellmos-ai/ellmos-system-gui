// Daemon chains client (P-1963-P4): the existing APIs /api/daemon/chains* of the connected system are the ONLY store
// (table toolchains / toolchain_runs). This module holds no data of its own: it validates responses strictly, classifies
// failures into separate states, keeps ids as integers from the API and never loses step data it cannot edit.
const BASE = '/api/daemon/chains';
export const TRIGGER_TYPES = [
  {value: 'manual', label: 'Manuell'}, {value: 'time', label: 'Zeitgesteuert'},
  {value: 'event', label: 'Event-basiert'}, {value: 'startup', label: 'Beim Start'},
];

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
  if (status === 400 || status === 422) return {kind: 'invalid', label: 'Eingabe abgelehnt (HTTP ' + status + ')', detail};
  if (status === 503) return {kind: 'unavailable', label: 'Daemon-Ketten nicht verfügbar (HTTP 503)', detail};
  return {kind: 'server', label: 'Serverfehler (HTTP ' + status + ')', detail};
}

// steps_json is text in the database. Unreadable text is reported, never replaced by an empty list.
export function parseSteps(stepsJson) {
  let data;
  try { data = JSON.parse(stepsJson); } catch { return {steps: [], error: 'steps_json ist kein gültiges JSON'}; }
  if (!Array.isArray(data) || data.some(s => !isObject(s))) return {steps: [], error: 'steps_json ist keine Liste von Schritten'};
  return {steps: data, error: null};
}

export const isParallel = step => step.parallel === true;
export const argsText = step => (Array.isArray(step.args) ? step.args.join(' ') : typeof step.args === 'string' ? step.args : '');
export function stepSummary(step) {
  if (isParallel(step)) {
    const tools = Array.isArray(step.tools) ? step.tools : [];
    return '[PARALLEL] ' + tools.length + ' Tasks: ' + tools.map(t => (isObject(t) && typeof t.tool === 'string' ? t.tool : '?')).join(', ');
  }
  return (typeof step.tool === 'string' ? step.tool : '?') + (argsText(step) ? ' ' + argsText(step) : '');
}

// Rows of the step editor -> steps. A row keeps the ORIGINAL step object (extra keys such as on_failure, parallel steps) and
// only replaces tool and args of simple steps; parallel steps pass through unchanged; rows without a tool are dropped.
export function collectSteps(rows) {
  const steps = [];
  for (const row of rows) {
    if (row.original && isParallel(row.original)) { steps.push(row.original); continue; }
    const tool = String(row.tool ?? '').trim();
    if (!tool) continue;
    const argText = String(row.args ?? '').trim();
    steps.push({...(row.original || {}), tool, args: argText ? argText.split(/\s+/) : []});
  }
  return steps;
}

export function rowsFromSteps(steps) {
  return steps.map(original => (isParallel(original) ? {original, parallel: true, tool: '', args: ''} : {original, parallel: false, tool: typeof original.tool === 'string' ? original.tool : '', args: argsText(original)}));
}

function parseChain(c) {
  if (!isObject(c) || typeof c.name !== 'string' || !c.name) fail('Kette ohne Name');
  if (typeof c.steps_json !== 'string') fail('steps_json fehlt');
  if (c.is_active !== 0 && c.is_active !== 1 && typeof c.is_active !== 'boolean' && c.is_active !== null) fail('is_active');
  const parsed = parseSteps(c.steps_json);
  return {id: requireId(c.id, 'chain.id'), name: c.name, description: nullableText(c.description, 'description'), triggerType: nullableText(c.trigger_type, 'trigger_type') || 'manual',
    triggerValue: nullableText(c.trigger_value, 'trigger_value'), stepsJson: c.steps_json, steps: parsed.steps, stepsError: parsed.error, active: !!c.is_active,
    lastRun: nullableText(c.last_run, 'last_run'), createdAt: nullableText(c.created_at, 'created_at')};
}

export function parseChainList(body) {
  if (!isObject(body) || !Array.isArray(body.chains)) fail('chains fehlt');
  const chains = body.chains.map(parseChain);
  if (new Set(chains.map(c => c.id)).size !== chains.length) fail('doppelte Ketten-ID');
  return chains;
}

export function parseRuns(body) {
  if (!isObject(body) || !Array.isArray(body.runs)) fail('runs fehlt');
  return body.runs.map(r => {
    if (!isObject(r) || typeof r.status !== 'string') fail('Lauf ohne Status');
    const num = (v, where) => { if (v !== null && v !== undefined && typeof v !== 'number') fail(where); return v ?? null; };
    return {id: requireId(r.id, 'run.id'), status: r.status, startedAt: nullableText(r.started_at, 'started_at'), duration: num(r.duration_seconds, 'duration_seconds'),
      stepsCompleted: num(r.steps_completed, 'steps_completed'), stepsTotal: num(r.steps_total, 'steps_total'), triggeredBy: nullableText(r.triggered_by, 'triggered_by') || 'manual',
      log: nullableText(r.log, 'log'), error: nullableText(r.error, 'error')};
  });
}

export function createChainClient(fetcher = globalThis.fetch) {
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
  const idPath = id => { if (!Number.isInteger(id) || id < 1) throw new ApiError('invalid', 'Ungültige Ketten-ID', 0); return BASE + '/' + id; };
  const payload = ({name, description, triggerType, triggerValue, steps}) => {
    const clean = String(name ?? '').trim();
    if (!clean) throw new ApiError('invalid', 'Name ist Pflicht', 0);
    if (!TRIGGER_TYPES.some(t => t.value === triggerType)) throw new ApiError('invalid', 'Unbekannter Trigger-Typ', 0);
    if (!Array.isArray(steps) || !steps.length) throw new ApiError('invalid', 'Mindestens ein Schritt mit Tool-Name ist erforderlich', 0);
    return {name: clean, description: String(description ?? '').trim(), trigger_type: triggerType, trigger_value: String(triggerValue ?? '').trim(), steps_json: JSON.stringify(steps)};
  };
  return {
    async list() {
      try { return parseChainList(await request('GET', BASE)); }
      catch (error) {
        if (error instanceof ApiError && error.kind === 'notfound') throw new ApiError('unavailable', 'Daemon-Ketten: Adapter oder Quelle nicht verfügbar (HTTP 404 auf der Liste)', 404, error.detail);
        throw error;
      }
    },
    async create(chain) { const d = await request('POST', BASE, {...payload(chain), is_active: 1}); return requireId(d.id, 'id der Neuanlage'); },
    async update(id, chain) { const d = await request('PUT', idPath(id), payload(chain)); if (d.status !== 'updated' && d.status !== 'no_changes') fail('Update-Status'); return d.status; },
    async toggle(id) { const d = await request('PUT', idPath(id) + '/toggle'); if (typeof d.is_active !== 'boolean') fail('is_active der Umschaltung'); return d.is_active; },
    async remove(id) { await request('DELETE', idPath(id)); },
    async run(id) { const d = await request('POST', idPath(id) + '/run'); if (d.status !== 'started') fail('Start-Status'); return true; },
    async runs(id, limit = 10) { return parseRuns(await request('GET', idPath(id) + '/runs?limit=' + encodeURIComponent(String(limit)))); },
  };
}

export const durationText = seconds => (typeof seconds === 'number' ? seconds.toFixed(1) + ' s' : 'Dauer unbekannt');

// The list state is exactly one of: loading, error:<kind>, empty, list.
export function listState({loading, error, chains}) {
  if (loading) return 'loading';
  if (error) return 'error:' + error.kind;
  return chains.length ? 'list' : 'empty';
}
export function createLatest() { let current = 0; return {next: () => ++current, isCurrent: token => token === current}; }
