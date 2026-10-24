const CAPABILITIES_URL = '/api/gui/capabilities';
const BLUEPRINTS_URL = '/api/agent-studio/blueprints';
const SKILLS_URL = '/api/capabilities/skills/library';
const COMPOSE_URL = '/api/agent-studio/subscription-agents/compose';
const REQUEST_SCHEMA = 'bach.subscription-agent-onboarding.request.v1';
const PREVIEW_SCHEMA = 'bach.subscription-agent-onboarding.preview.v1';
const REQUEST_SCHEMA_V2 = 'bach.subscription-agent-onboarding.request.v2';
const PREVIEW_SCHEMA_V2 = 'bach.subscription-agent-onboarding.preview.v2';
const BOOT_ROLES = ['system', 'bach'];
const SKILL_SCHEMA = 'bach.skill-library.v1';
const CAPABILITIES_SCHEMA = 'ellmos.gui.capabilities.v1';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const CREDENTIAL_LIKE = /(?:\b(?:sk|ghp|github_pat|AKIA)[_-][A-Za-z0-9_-]{12,}\b|\bbearer\s+[A-Za-z0-9._~+/=-]{12,}\b|(?:api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|authorization|credentials|secret)\s*[:=]\s*(?:"[^"]{4,}"|'[^']{4,}'|[^\s,;]{8,}))/i;

export const SUBSCRIPTION_AGENTS_PATHS = Object.freeze({
  capabilities: CAPABILITIES_URL,
  blueprints: BLUEPRINTS_URL,
  skills: SKILLS_URL,
  compose: COMPOSE_URL,
});

export class SubscriptionAgentsError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'SubscriptionAgentsError';
    this.kind = kind;
    this.status = status;
  }
}

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const failContract = message => { throw new SubscriptionAgentsError('contract', message); };

const requestSignal = () => typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
  ? AbortSignal.timeout(15000) : undefined;

async function readResponse(response) {
  if (!response || typeof response.ok !== 'boolean')
    throw new SubscriptionAgentsError('network', 'Die Antwort des verbundenen Systems ist nicht lesbar.');
  if (!response.ok) {
    const status = Number.isInteger(response.status) ? response.status : 0;
    const kind = status === 401 || status === 403 ? 'auth'
      : status === 404 || status === 501 ? 'unavailable'
        : status === 0 ? 'network' : 'server';
    const label = status === 401 || status === 403 ? 'Geräteanmeldung oder Zugriff fehlt.'
      : status === 404 || status === 501 ? 'Der verbundene Dienst bietet diese Funktion nicht an.'
        : status === 0 ? 'Das verbundene System ist nicht erreichbar.'
          : `Die Anfrage wurde mit HTTP ${status} abgelehnt.`;
    throw new SubscriptionAgentsError(kind, label, status);
  }
  try { return await response.json(); }
  catch { throw new SubscriptionAgentsError('contract', 'Das verbundene System lieferte keine lesbare JSON-Antwort.'); }
}

export function declarationState(payload) {
  if (!isObject(payload) || payload.schema !== CAPABILITIES_SCHEMA || !Array.isArray(payload.endpoints))
    return 'unknown';
  const matches = payload.endpoints.filter(item => isObject(item)
    && item.method === 'POST' && item.path === COMPOSE_URL);
  if (matches.length !== 1) return matches.length === 0 ? 'unavailable' : 'unknown';
  if (matches[0].available === true) return 'available';
  if (matches[0].available === false) return 'unavailable';
  return 'unknown';
}

export async function loadCapabilities() {
  return readResponse(await fetch('/api/gui/capabilities', {
    method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: requestSignal(),
  }));
}

export function parseBlueprintCatalog(payload) {
  if (!isObject(payload) || !Array.isArray(payload.blueprints) || !Array.isArray(payload.templates))
    failContract('Die Blueprint-Quelle liefert kein bestätigtes Verzeichnis.');
  const seen = new Set();
  const rows = [];
  for (const item of [...payload.blueprints, ...payload.templates]) {
    if (!isObject(item) || !Number.isSafeInteger(item.id) || item.id <= 0 || seen.has(item.id)) continue;
    seen.add(item.id);
    const validVersion = Number.isSafeInteger(item.version) && item.version > 0;
    const validSkillIds = Array.isArray(item.skills) && item.skills.length <= 30
      && item.skills.every(id => typeof id === 'string' && SAFE_ID.test(id))
      && new Set(item.skills).size === item.skills.length;
    const personaRole = typeof item.persona_role === 'string' ? item.persona_role.trim() : '';
    const validPersonaRole = !!personaRole && personaRole.length <= 160 && !personaRole.includes('\0');
    const composable = validVersion && validSkillIds && validPersonaRole;
    rows.push({
      id: item.id,
      name: typeof item.title === 'string' && item.title.trim() ? item.title.trim()
        : typeof item.name === 'string' && item.name.trim() ? item.name.trim() : item.id,
      kind: typeof item.kind === 'string' ? item.kind : 'unbekannt',
      version: validVersion ? item.version : null,
      personaRole: validPersonaRole ? personaRole : null,
      skillIds: validSkillIds ? [...item.skills] : null,
      composable,
      reason: !validVersion ? 'Die Revision ist keine positive Ganzzahl; Auswahl bleibt gesperrt.'
        : !validPersonaRole ? 'Die Blueprint-Rolle ist nicht bestätigt; Auswahl bleibt gesperrt.'
          : !validSkillIds ? 'Die Blueprint-Skills sind nicht vollständig bestätigt; Auswahl bleibt gesperrt.' : '',
    });
  }
  return rows;
}

export function parseSkillLibrary(payload) {
  if (!isObject(payload) || payload.schema !== SKILL_SCHEMA || !Array.isArray(payload.skills))
    failContract('Die Skill-Quelle liefert kein bestätigtes Verzeichnis.');
  const ids = new Set();
  return payload.skills.map(item => {
    if (!isObject(item) || typeof item.id !== 'string' || !SAFE_ID.test(item.id)
        || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim()
        || typeof item.version !== 'string' || typeof item.category !== 'string'
        || !SHA256.test(item.source_version) || item.evidence_type !== 'filesystem_present'
        || !['factory', 'local_override'].includes(item.source_kind))
      failContract('Ein Skill-Eintrag ist unvollständig oder seine aktuelle Quelle ist nicht bestätigt.');
    ids.add(item.id);
    return {
      id: item.id,
      name: item.name.trim(),
      category: item.category,
      version: item.version,
      sourceVersion: item.source_version,
      sourceKind: item.source_kind,
    };
  });
}

function parseTaskReferences(value) {
  const text = String(value ?? '').trim();
  if (!text) return [];
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (parts.length > 20 || parts.some(part => !/^\d+$/.test(part)))
    throw new SubscriptionAgentsError('invalid', 'Gib höchstens 20 positive Task-IDs ein.');
  const ids = parts.map(Number);
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length)
    throw new SubscriptionAgentsError('invalid', 'Task-IDs müssen eindeutig und positiv sein.');
  return ids;
}

function boundedText(value, label, maximum, {required = false} = {}) {
  const text = String(value ?? '').trim();
  if ((required && !text) || text.length > maximum)
    throw new SubscriptionAgentsError('invalid', `${label} fehlt oder überschreitet ${maximum} Zeichen.`);
  return text;
}

function optionalWorkspace(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > 1024 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value))
    throw new SubscriptionAgentsError('invalid', 'Arbeitskontext muss einzeiliger Text mit höchstens 1024 Zeichen sein.');
  const text = value.trim();
  if (text && CREDENTIAL_LIKE.test(text))
    throw new SubscriptionAgentsError('invalid', 'Arbeitskontext enthält mögliche Zugangsdaten oder Schlüsselangaben.');
  return text;
}

function validWorkspace(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024
    && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)
    && !CREDENTIAL_LIKE.test(value);
}

export function buildComposeRequest(input, {blueprints, skills} = {}) {
  const selectedBlueprintId = typeof input.blueprintId === 'number' && Number.isSafeInteger(input.blueprintId)
    ? String(input.blueprintId) : typeof input.blueprintId === 'string' ? input.blueprintId.trim() : '';
  const blueprint = (blueprints ?? []).find(item => Number.isSafeInteger(item.id)
    && item.id > 0 && String(item.id) === selectedBlueprintId);
  if (!blueprint || !blueprint.composable || !Number.isSafeInteger(blueprint.version) || blueprint.version <= 0
      || !Number.isSafeInteger(blueprint.id) || blueprint.id <= 0
      || !Array.isArray(blueprint.skillIds) || typeof blueprint.personaRole !== 'string')
    throw new SubscriptionAgentsError('invalid', 'Wähle eine Blueprint-Fassung mit bestätigter Ganzzahlrevision.');
  const selectedSkillIds = input.selectedSkillIds ?? [];
  if (!Array.isArray(selectedSkillIds) || selectedSkillIds.some(id => typeof id !== 'string' || !SAFE_ID.test(id)))
    throw new SubscriptionAgentsError('invalid', 'Die Skill-Auswahl ist ungültig.');
  const skillIds = [...new Set(selectedSkillIds)];
  const knownSkills = new Set((skills ?? []).map(skill => skill.id));
  if (skillIds.length > 30 || skillIds.some(id => !knownSkills.has(id)))
    throw new SubscriptionAgentsError('invalid', 'Die Auswahl enthält unbekannte Skills oder überschreitet 30 Einträge.');

  let bootSources;
  if (input.bootSourceIds !== undefined) {
    if (!hasExactKeys(input.bootSourceIds, BOOT_ROLES))
      throw new SubscriptionAgentsError('invalid', 'Wähle je eine Quelle für Systemwissen und BACH-Anleitung.');
    bootSources = {};
    for (const role of BOOT_ROLES) {
      const source = (skills ?? []).find(skill => skill.id === input.bootSourceIds[role]);
      if (!source || !SAFE_ID.test(source.id) || !isDigest(source.sourceVersion))
        throw new SubscriptionAgentsError('invalid', 'Bootquellen müssen aus der aktuellen Skillbibliothek stammen.');
      bootSources[role] = {id: source.id, source_version: source.sourceVersion};
    }
    if (new Set([...Object.values(bootSources).map(ref => ref.id), ...blueprint.skillIds, ...skillIds]).size > 30)
      throw new SubscriptionAgentsError('invalid', 'Boot-, Blueprint- und Zusatzskills überschreiten zusammen 30 Quellen.');
  }

  const clientId = boundedText(input.clientId, 'Client-Kennung', 64, {required: true});
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(clientId))
    throw new SubscriptionAgentsError('invalid', 'Die Client-Kennung ist ungültig.');
  const targetClient = {
    client_id: clientId,
    host: boundedText(input.host, 'Host', 128, {required: true}),
    name: boundedText(input.clientName, 'Anzeigename', 120, {required: true}),
  };
  const workspace = optionalWorkspace(input.workspace);
  if (workspace) targetClient.workspace = workspace;
  const userTask = boundedText(input.userTask, 'Arbeitsauftrag', 16000);
  const taskRefs = parseTaskReferences(input.taskRefs);
  const taskSelectionRule = boundedText(input.taskSelectionRule, 'Task-Auswahlregel', 2000);
  if (!userTask && !taskRefs.length && !taskSelectionRule)
    throw new SubscriptionAgentsError('invalid', 'Gib einen Auftrag, Task-Referenzen oder eine Auswahlregel an.');

  return {
    schema: bootSources ? REQUEST_SCHEMA_V2 : REQUEST_SCHEMA,
    ...(bootSources ? {boot_sources: bootSources} : {}),
    target_client: targetClient,
    blueprint: {id: blueprint.id, version: blueprint.version},
    selected_skill_ids: skillIds,
    user_task: userTask,
    task_refs: taskRefs,
    task_selection_rule: taskSelectionRule,
    governance: {
      scope: boundedText(input.governanceScope || 'BACH', 'Governance-Bereich', 256, {required: true}),
      policy_query: boundedText(input.policyQuery, 'Policy-Frage', 128),
      decision_query: boundedText(input.decisionQuery, 'Entscheidungsfrage', 128),
    },
  };
}

const PREVIEW_KEYS = [
  'schema', 'status', 'target_client', 'blueprint', 'governance_scope', 'prompt',
  'prompt_chars', 'prompt_bytes', 'max_prompt_chars', 'sources', 'missing', 'actions', 'limits',
];
const SOURCE_KEYS = [
  'id', 'kind', 'state', 'version', 'sha256', 'host', 'path',
  'source_bytes', 'included_chars', 'included_bytes',
];
const SOURCE_DETAILS = {
  blueprint: ['kind_id', 'snapshot_source', 'projection_only'],
  role: ['blueprint_sha256'],
  skill: ['tools_granted'],
  task_snapshot: ['task_id', 'task_reference_only'],
  policy: ['enforcement_verified', 'read_only', 'count', 'truncated', 'refs'],
  decision: ['enforcement_verified', 'read_only', 'count', 'truncated', 'refs'],
  user_instruction: [],
  selection_rule: ['queue_scanned', 'tasks_claimed'],
};
const POLICY_REF_KEYS = [
  'id', 'kind', 'scope', 'version', 'status', 'source_state', 'source_sha256', 'enforcement_verified',
];

function hasExactKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function isText(value, maximum, {empty = false} = {}) {
  return typeof value === 'string' && value.length <= maximum && !value.includes('\0')
    && (empty || !!value.trim());
}

// The native Python contract counts Unicode code points, not UTF-16 code units.
const characterCount = value => Array.from(value).length;

function isCounter(value) { return Number.isSafeInteger(value) && value >= 0; }
function isDigest(value) { return typeof value === 'string' && SHA256.test(value); }
function isCanonicalBlueprintResponseId(value) {
  return typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
    && Number.isSafeInteger(Number(value)) && String(Number(value)) === value;
}

function isPolicyRef(ref, kind) {
  return hasExactKeys(ref, POLICY_REF_KEYS)
    && isText(ref.id, 160) && ref.kind === kind
    && (ref.scope === null || isText(ref.scope, 256, {empty: true}))
    && (ref.version === null || isText(ref.version, 80, {empty: true}))
    && (ref.status === null || isText(ref.status, 40, {empty: true}))
    && isText(ref.source_state, 40)
    && (ref.source_sha256 === null || isDigest(ref.source_sha256))
    && ref.enforcement_verified === false;
}

function sourceHasValidShape(row, versionTwo = false) {
  if (!isObject(row) || typeof row.kind !== 'string' || !Object.hasOwn(SOURCE_DETAILS, row.kind)) return false;
  const isUnavailablePolicy = ['policy', 'decision'].includes(row.kind) && row.state === 'unavailable';
  const details = isUnavailablePolicy
    ? ['enforcement_verified', 'read_only', 'count'] : SOURCE_DETAILS[row.kind];
  const keys = [...SOURCE_KEYS, ...details, ...(versionTwo && row.kind === 'skill' ? ['boot_roles'] : [])];
  return hasExactKeys(row, keys)
    && isText(row.id, 512)
    && isText(row.state, 40)
    && (row.version === null || typeof row.version === 'string' || Number.isSafeInteger(row.version))
    && (row.sha256 === null || isDigest(row.sha256))
    && (row.host === null || isText(row.host, 256, {empty: true}))
    && (row.path === null || isText(row.path, 4096, {empty: true}))
    && isCounter(row.source_bytes) && isCounter(row.included_chars) && isCounter(row.included_bytes);
}

function validatePolicySource(row) {
  if (!['available', 'available_empty', 'unavailable'].includes(row.state)
      || row.enforcement_verified !== false || row.read_only !== true || !isCounter(row.count))
    return false;
  if (row.state === 'unavailable')
    return row.count === 0 && row.version === null && row.sha256 === null;
  if (typeof row.truncated !== 'boolean' || !Array.isArray(row.refs) || row.refs.length > 256
      || row.refs.some(ref => !isPolicyRef(ref, row.kind)) || row.count !== row.refs.length)
    return false;
  return row.count === 0 ? row.state === 'available_empty'
    && isDigest(row.version) && row.sha256 === row.version
    : row.state === 'available' && isDigest(row.version) && row.sha256 === row.version;
}

export function validatePreview(payload, request, expected) {
  const invalid = () => failContract('Die Vorschau bestätigt den Preview-only-Vertrag und ihre Quellnachweise nicht.');
  const versionTwo = request?.schema === REQUEST_SCHEMA_V2;
  if (!hasExactKeys(payload, [...PREVIEW_KEYS, ...(versionTwo ? ['boot_sources', 'boot_delivery'] : [])])
      || payload.schema !== (versionTwo ? PREVIEW_SCHEMA_V2 : PREVIEW_SCHEMA)
      || !['ready_for_review', 'needs_sources'].includes(payload.status)
      || !hasExactKeys(request, ['schema', 'target_client', 'blueprint', 'selected_skill_ids', 'user_task',
        'task_refs', 'task_selection_rule', 'governance', ...(versionTwo ? ['boot_sources'] : [])])
      || request.schema !== (versionTwo ? REQUEST_SCHEMA_V2 : REQUEST_SCHEMA)
      || !hasExactKeys(request.target_client, Object.hasOwn(request.target_client ?? {}, 'workspace')
        ? ['client_id', 'host', 'name', 'workspace'] : ['client_id', 'host', 'name'])
      || (Object.hasOwn(request.target_client ?? {}, 'workspace') && !validWorkspace(request.target_client.workspace))
      || !hasExactKeys(request.blueprint, ['id', 'version'])
      || !Number.isSafeInteger(request.blueprint.id) || request.blueprint.id <= 0
      || !Number.isSafeInteger(request.blueprint.version) || request.blueprint.version <= 0
      || !Array.isArray(request.selected_skill_ids)
      || request.selected_skill_ids.some(id => typeof id !== 'string' || !SAFE_ID.test(id))
      || new Set(request.selected_skill_ids).size !== request.selected_skill_ids.length
      || !Array.isArray(request.task_refs)
      || request.task_refs.some(id => !Number.isSafeInteger(id) || id <= 0)
      || new Set(request.task_refs).size !== request.task_refs.length
      || !isText(request.user_task, 16000, {empty: true})
      || !isText(request.task_selection_rule, 2000, {empty: true})
      || !isObject(expected) || !isObject(expected.blueprint) || !Array.isArray(expected.skills)) invalid();

  const blueprint = expected.blueprint;
  if (blueprint.id !== request.blueprint.id || blueprint.version !== request.blueprint.version
      || !Number.isSafeInteger(blueprint.id) || blueprint.id <= 0
      || !Number.isSafeInteger(blueprint.version) || blueprint.version <= 0
      || !isText(blueprint.personaRole, 160)
      || !Array.isArray(blueprint.skillIds)
      || blueprint.skillIds.some(id => typeof id !== 'string' || !SAFE_ID.test(id))
      || new Set(blueprint.skillIds).size !== blueprint.skillIds.length) invalid();

  const knownSkills = new Map();
  for (const skill of expected.skills) {
    if (!isObject(skill) || !isText(skill.id, 80) || !SAFE_ID.test(skill.id)
        || !isText(skill.version, 80) || !isDigest(skill.sourceVersion) || knownSkills.has(skill.id)) invalid();
    knownSkills.set(skill.id, skill);
  }
  if (request.selected_skill_ids.some(id => !knownSkills.has(id))) invalid();
  const bootRefs = [];
  if (versionTwo) {
    if (!hasExactKeys(request.boot_sources, BOOT_ROLES) || !hasExactKeys(payload.boot_sources, BOOT_ROLES)
        || !hasExactKeys(payload.boot_delivery, ['mode', 'source', 'target_readability_verified', 'role_suitability_verified'])
        || payload.boot_delivery.mode !== 'text' || payload.boot_delivery.source !== 'current_skill_library'
        || payload.boot_delivery.target_readability_verified !== false
        || payload.boot_delivery.role_suitability_verified !== false) invalid();
    for (const role of BOOT_ROLES) {
      const ref = request.boot_sources[role];
      const returned = payload.boot_sources[role];
      if (!hasExactKeys(ref, ['id', 'source_version']) || !hasExactKeys(returned, ['id', 'source_version'])
          || typeof ref.id !== 'string' || !SAFE_ID.test(ref.id) || !isDigest(ref.source_version)
          || knownSkills.get(ref.id)?.sourceVersion !== ref.source_version
          || returned.id !== ref.id || returned.source_version !== ref.source_version) invalid();
      bootRefs.push(ref);
    }
  }

  const target = payload.target_client;
  const targetKeys = Object.hasOwn(request.target_client, 'workspace')
    ? ['client_id', 'host', 'name', 'workspace'] : ['client_id', 'host', 'name'];
  if (!hasExactKeys(target, targetKeys)
      || target.client_id !== request.target_client.client_id
      || target.host !== request.target_client.host || target.name !== request.target_client.name
      || (Object.hasOwn(request.target_client, 'workspace')
        && target.workspace !== request.target_client.workspace)) invalid();
  const previewBlueprint = payload.blueprint;
  if (!hasExactKeys(previewBlueprint, ['id', 'name', 'version', 'sha256'])
      || !isCanonicalBlueprintResponseId(previewBlueprint.id)
      || previewBlueprint.id !== String(request.blueprint.id) || previewBlueprint.version !== request.blueprint.version
      || !isText(previewBlueprint.name, 80) || !isDigest(previewBlueprint.sha256)
      || !isText(payload.governance_scope, 256)
      || typeof payload.prompt !== 'string' || payload.prompt.length === 0 || characterCount(payload.prompt) > 120000
      || payload.max_prompt_chars !== 120000
      || payload.prompt_chars !== characterCount(payload.prompt)
      || payload.prompt_bytes !== new TextEncoder().encode(payload.prompt).length
      || !Array.isArray(payload.sources) || payload.sources.length > 128
      || !Array.isArray(payload.missing) || payload.missing.length > 64
      || !hasExactKeys(payload.actions, ['agent_started', 'task_claimed', 'queue_scanned', 'clipboard_written'])
      || payload.actions.agent_started !== false || payload.actions.task_claimed !== false
      || payload.actions.queue_scanned !== false || payload.actions.clipboard_written !== false
      || !hasExactKeys(payload.limits, ['credential_scan', 'task_context', 'governance_enforcement_verified'])
      || payload.limits.credential_scan !== 'heuristic_only'
      || payload.limits.task_context !== 'reference_only'
      || payload.limits.governance_enforcement_verified !== false) invalid();

  if (Object.hasOwn(request.target_client, 'workspace')) {
    const line = `- Arbeitskontext: ${request.target_client.workspace} (Zugriff nicht geprüft)\n`;
    if (payload.prompt.split(line).length !== 2) invalid();
  }

  const sources = new Map();
  for (const row of payload.sources) {
    if (!sourceHasValidShape(row, versionTwo) || sources.has(row.id)) invalid();
    sources.set(row.id, row);
  }
  const missing = new Map();
  for (const item of payload.missing) {
    if (!hasExactKeys(item, ['id', 'kind', 'reason']) || typeof item.kind !== 'string'
        || !isText(item.reason, 80)) invalid();
    const key = `${item.kind}\0${typeof item.id}:${String(item.id)}`;
    if (missing.has(key)) invalid();
    missing.set(key, item);
  }
  const getMissing = (kind, id) => missing.get(`${kind}\0${typeof id}:${String(id)}`);
  const expectedSkillIds = [...new Set([...bootRefs.map(ref => ref.id), ...blueprint.skillIds, ...request.selected_skill_ids])];
  if (versionTwo && expectedSkillIds.length > 30) invalid();
  const allowedSourceIds = new Set([
    `blueprint:${request.blueprint.id}`, `role:${blueprint.personaRole}`,
    'policy-registry:policy', 'policy-registry:decision', 'user-task',
    ...(request.task_selection_rule ? ['task-selection-rule'] : []),
    ...expectedSkillIds.map(id => `skill:${id}`),
    ...request.task_refs.map(id => `task:${id}`),
  ]);
  if ([...sources.keys()].some(id => !allowedSourceIds.has(id))) invalid();

  const blueprintSource = sources.get(`blueprint:${request.blueprint.id}`);
  if (!blueprintSource || blueprintSource.kind !== 'blueprint' || blueprintSource.state !== 'included'
      || blueprintSource.version !== request.blueprint.version || blueprintSource.sha256 !== previewBlueprint.sha256
      || !['agent', 'role'].includes(blueprintSource.kind_id)
      || blueprintSource.snapshot_source !== 'blueprint_service._execution_blueprint'
      || blueprintSource.projection_only !== true || blueprintSource.path !== null) invalid();

  const roleSource = sources.get(`role:${blueprint.personaRole}`);
  if (!roleSource || roleSource.kind !== 'role' || roleSource.state !== 'included'
      || roleSource.version !== request.blueprint.version || !isDigest(roleSource.sha256)
      || roleSource.blueprint_sha256 !== blueprintSource.sha256 || roleSource.path !== null) invalid();

  for (const skillId of expectedSkillIds) {
    const row = sources.get(`skill:${skillId}`);
    const absent = getMissing('skill', skillId);
    if (!row || row.kind !== 'skill' || row.tools_granted !== false) invalid();
    if (versionTwo) {
      const roles = BOOT_ROLES.filter(role => request.boot_sources[role].id === skillId);
      if (!Array.isArray(row.boot_roles) || row.boot_roles.length !== roles.length
          || row.boot_roles.some((role, index) => role !== roles[index])) invalid();
    }
    if (row.state === 'included') {
      const catalogSkill = knownSkills.get(skillId);
      if (absent || !catalogSkill || !isText(row.version, 80)
          || row.version !== catalogSkill.version || row.sha256 !== catalogSkill.sourceVersion) invalid();
    } else if (row.state === 'missing' || row.state === 'invalid') {
      const reason = row.state === 'missing' ? 'source_missing' : 'source_invalid';
      if (row.version !== null || row.sha256 !== null || !absent || absent.reason !== reason) invalid();
    } else invalid();
  }

  for (const taskId of request.task_refs) {
    const row = sources.get(`task:${taskId}`);
    const absent = getMissing('task', taskId);
    if (row) {
      if (row.kind !== 'task_snapshot' || row.state !== 'included' || absent
          || row.task_id !== taskId || row.task_reference_only !== true
          || !isDigest(row.version) || row.sha256 !== row.version
          || row.host !== 'BACH-TaskLeaseClient' || row.path !== null) invalid();
    } else if (!absent || !['reader_unavailable', 'snapshot_unavailable'].includes(absent.reason)) invalid();
  }

  for (const kind of ['policy', 'decision']) {
    const id = `policy-registry:${kind}`;
    const row = sources.get(id);
    const absent = getMissing(kind, id);
    if (!row || row.kind !== kind || row.id !== id || row.path !== null
        || row.host !== 'policy-registry' || !validatePolicySource(row)) invalid();
    if (row.state === 'unavailable') {
      if (!absent || absent.reason !== 'provider_unavailable') invalid();
    } else if (kind === 'policy' && row.state === 'available_empty') {
      if (!absent || absent.reason !== 'no_matching_policy_references') invalid();
    } else if (absent) invalid();
  }

  const userTask = sources.get('user-task');
  const userTaskBytes = new TextEncoder().encode(request.user_task).length;
  if (!userTask || userTask.kind !== 'user_instruction'
      || userTask.state !== (request.user_task ? 'included' : 'empty') || userTask.version !== 1
      || userTask.host !== 'request' || userTask.path !== null
      || userTask.source_bytes !== userTaskBytes || userTask.included_chars !== characterCount(request.user_task)
      || userTask.included_bytes !== userTaskBytes
      || (request.user_task ? !isDigest(userTask.sha256) : userTask.sha256 !== null)) invalid();
  const selectionRule = sources.get('task-selection-rule');
  if (request.task_selection_rule) {
    const ruleBytes = new TextEncoder().encode(request.task_selection_rule).length;
    if (!selectionRule || selectionRule.kind !== 'selection_rule' || selectionRule.state !== 'included'
        || selectionRule.version !== 1 || !isDigest(selectionRule.sha256)
        || selectionRule.host !== 'request' || selectionRule.path !== null
        || selectionRule.source_bytes !== ruleBytes || selectionRule.included_chars !== characterCount(request.task_selection_rule)
        || selectionRule.included_bytes !== ruleBytes || selectionRule.queue_scanned !== false
        || selectionRule.tasks_claimed !== false) invalid();
  } else if (selectionRule) invalid();

  for (const item of payload.missing) {
    if (item.kind === 'skill') {
      if (!expectedSkillIds.includes(item.id)) invalid();
    } else if (item.kind === 'task') {
      if (typeof item.id !== 'number' || !request.task_refs.includes(item.id)) invalid();
    } else if (item.kind === 'policy' || item.kind === 'decision') {
      if (item.id !== `policy-registry:${item.kind}`) invalid();
    } else invalid();
  }
  for (const row of payload.sources) {
    if (row.kind !== 'task_snapshot' && row.kind !== 'skill'
        && !['blueprint', 'role', 'policy', 'decision', 'user_instruction', 'selection_rule'].includes(row.kind)) invalid();
  }
  if ((payload.status === 'ready_for_review') !== (payload.missing.length === 0)) invalid();
  return payload;
}

export async function loadBlueprints() {
  return parseBlueprintCatalog(await readResponse(await fetch('/api/agent-studio/blueprints', {
    method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: requestSignal(),
  })));
}

export async function loadSkillLibrary() {
  return parseSkillLibrary(await readResponse(await fetch('/api/capabilities/skills/library', {
    method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: requestSignal(),
  })));
}

export async function composePreview(request, capabilityPayload, expected) {
  const state = declarationState(capabilityPayload);
  if (state !== 'available') {
    throw new SubscriptionAgentsError(state, state === 'unknown'
      ? 'Die Schreibroute ist nicht bestätigt; die Vorschau wurde nicht gesendet.'
      : 'Der verbundene Dienst deklariert keine verfügbare Vorschau-Route.');
  }
  const payload = await readResponse(await fetch('/api/agent-studio/subscription-agents/compose', {
    method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request), signal: requestSignal(),
  }));
  return validatePreview(payload, request, expected);
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') node.value = value;
  else node.textContent = value;
}

function setStatus(id, message, error = false) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = message;
  node.dataset.error = String(error);
}

function appendText(parent, tag, text, className = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function renderBlueprints(rows) {
  const select = document.getElementById('subscription-blueprint');
  if (!select) return;
  select.replaceChildren(new Option('Blueprint auswählen …', ''));
  for (const row of rows) {
    const option = new Option(`${row.name} · ${row.kind} · ${row.version ?? 'Revision nicht kompatibel'}`, row.id);
    option.disabled = !row.composable;
    select.add(option);
  }
}

function renderBootSources(rows) {
  for (const role of BOOT_ROLES) {
    const select = document.getElementById('subscription-boot-' + role);
    if (!select) continue;
    select.replaceChildren(new Option('Quelle ausdrücklich auswählen …', ''));
    for (const row of rows)
      select.add(new Option(row.name + ' · ' + row.id + ' · ' + row.version + ' · ' + row.sourceVersion.slice(0, 12), row.id));
  }
}

function renderSkills(rows) {
  const list = document.getElementById('subscription-skills');
  if (!list) return;
  list.replaceChildren();
  for (const row of rows) {
    const label = document.createElement('label');
    label.className = 'subscription-skill';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'selected_skill_ids';
    input.value = row.id;
    const content = document.createElement('span');
    appendText(content, 'strong', row.name);
    appendText(content, 'small', `${row.id} · ${row.category} · ${row.version} · ${row.sourceKind} · ${row.sourceVersion.slice(0, 12)}`);
    label.append(input, content);
    list.append(label);
  }
  if (!rows.length) appendText(list, 'p', 'Keine aktuellen Skill-Quellen bestätigt.', 'muted');
}

function renderSources(rows) {
  const list = document.getElementById('subscription-source-list');
  if (!list) return;
  list.replaceChildren();
  for (const row of rows) {
    const name = [row.kind, row.id, row.version, ...(Array.isArray(row.boot_roles) ? row.boot_roles : [])].filter(value => typeof value === 'string' && SAFE_TOKEN.test(value)).join(' · ');
    const digest = typeof row.sha256 === 'string' && SHA256.test(row.sha256) ? row.sha256
      : typeof row.source_version === 'string' && SHA256.test(row.source_version) ? row.source_version : '';
    appendText(list, 'li', `${name || 'Quelle'}${digest ? ` · SHA-256 ${digest.slice(0, 16)}…` : ''}`);
  }
}

function renderMissing(rows) {
  const list = document.getElementById('subscription-missing-list');
  if (!list) return;
  list.replaceChildren();
  for (const item of rows) {
    const text = typeof item === 'string' ? (SAFE_TOKEN.test(item) ? item : 'Nicht bestätigte Quelle')
      : isObject(item) ? [item.kind, item.id, item.reason].filter(value => typeof value === 'string' && SAFE_TOKEN.test(value)).join(' · ')
        : 'Nicht verfügbare Quelle';
    appendText(list, 'li', text || 'Nicht verfügbare Quelle');
  }
}

function formInput(form, name) { return form.elements.namedItem(name)?.value ?? ''; }

export function initSubscriptionAgentsPage() {
  if (typeof document === 'undefined') return;
  const form = document.getElementById('subscription-form');
  if (!form) return;
  let capabilityPayload = null;
  let blueprints = [];
  let skills = [];
  let lastPreview = null;
  let previewEpoch = 0;
  let refreshEpoch = 0;
  let loadingSources = false;
  const composeButton = document.getElementById('subscription-compose');

  function invalidatePreview() {
    previewEpoch += 1;
    lastPreview = null;
    setText('subscription-prompt', '');
    setText('subscription-preview-state', 'Noch keine bestätigte Vorschau.');
    setText('subscription-preview-meta', '');
    renderSources([]);
    renderMissing([]);
    const copyButton = document.getElementById('subscription-copy');
    if (copyButton) copyButton.disabled = true;
    if (composeButton) composeButton.disabled = loadingSources || !blueprints.length || !skills.length
      || declarationState(capabilityPayload) !== 'available';
  }

  async function refresh() {
    const epoch = ++refreshEpoch;
    loadingSources = true;
    invalidatePreview();
    if (composeButton) composeButton.disabled = true;
    setStatus('subscription-status', 'Quellen werden geprüft …');
    const settled = await Promise.allSettled([loadCapabilities(), loadBlueprints(), loadSkillLibrary()]);
    if (epoch !== refreshEpoch) return;
    loadingSources = false;
    capabilityPayload = settled[0].status === 'fulfilled' ? settled[0].value : null;
    blueprints = settled[1].status === 'fulfilled' ? settled[1].value : [];
    skills = settled[2].status === 'fulfilled' ? settled[2].value : [];
    renderBlueprints(blueprints);
    renderSkills(skills);
    renderBootSources(skills);
    const route = declarationState(capabilityPayload);
    setText('subscription-route-state', route === 'available' ? 'Vorschau-Route deklariert verfügbar'
      : route === 'unavailable' ? 'Vorschau-Route nicht verfügbar' : 'Vorschau-Route unbekannt');
    const sourceErrors = settled.slice(1).filter(result => result.status === 'rejected');
    const summary = sourceErrors.length
      ? 'Mindestens eine Quellliste ist nicht bestätigt; Vorschau bleibt gesperrt.'
      : 'Quellen gelesen. Auswahl und Preview starten keinen Agenten und übernehmen keine Task.';
    setStatus('subscription-status', summary, sourceErrors.length > 0);
    if (composeButton) composeButton.disabled = sourceErrors.length > 0 || route !== 'available';
  }

  const onFormChange = () => {
    invalidatePreview();
    setStatus('subscription-status', 'Auswahl geändert. Eine neue Vorschau ist erforderlich.');
  };
  form.addEventListener('input', onFormChange);
  form.addEventListener('change', onFormChange);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (loadingSources || !capabilityPayload || !blueprints.length || !skills.length) {
      setStatus('subscription-status', 'Vorschau gesperrt: aktuelle Quellen oder Route fehlen.', true);
      return;
    }
    invalidatePreview();
    const epoch = previewEpoch;
    if (composeButton) composeButton.disabled = true;
    setStatus('subscription-status', 'Preview wird angefragt …');
    try {
      const selectedSkillIds = [...form.querySelectorAll('input[name="selected_skill_ids"]:checked')].map(input => input.value);
      const request = buildComposeRequest({
        clientId: formInput(form, 'client_id'),
        host: formInput(form, 'host'),
        clientName: formInput(form, 'client_name'),
        workspace: formInput(form, 'workspace'),
        blueprintId: formInput(form, 'blueprint_id'),
        selectedSkillIds,
        bootSourceIds: {system: formInput(form, 'boot_system'), bach: formInput(form, 'boot_bach')},
        userTask: formInput(form, 'user_task'),
        taskRefs: formInput(form, 'task_refs'),
        taskSelectionRule: formInput(form, 'task_selection_rule'),
        governanceScope: formInput(form, 'governance_scope'),
        policyQuery: formInput(form, 'policy_query'),
        decisionQuery: formInput(form, 'decision_query'),
      }, {blueprints, skills});
      const expectedBlueprint = blueprints.find(item => item.id === request.blueprint.id);
      const preview = await composePreview(request, capabilityPayload, {blueprint: expectedBlueprint, skills});
      if (epoch !== previewEpoch) return;
      lastPreview = preview;
      const ready = lastPreview.status === 'ready_for_review';
      setStatus('subscription-preview-state', ready
        ? 'Quellenstatus: Für Review bereit · kein Client- oder Laufzeitcheck'
        : 'Quellenstatus: Quellen fehlen oder sind nicht bestätigt');
      setText('subscription-prompt', lastPreview.prompt);
      setText('subscription-preview-meta', `${lastPreview.prompt_chars} Zeichen · ${lastPreview.prompt_bytes} UTF-8-Bytes · Quelle ${lastPreview.sources.length} · fehlend ${lastPreview.missing.length}`);
      renderSources(lastPreview.sources);
      renderMissing(lastPreview.missing);
      const copyButton = document.getElementById('subscription-copy');
      if (copyButton) copyButton.disabled = false;
      setStatus('subscription-status', 'Preview empfangen. Worker gestartet: nein · Task übernommen: nein · Queue gelesen: nein.');
    } catch (error) {
      if (epoch !== previewEpoch) return;
      lastPreview = null;
      setText('subscription-prompt', '');
      const copyButton = document.getElementById('subscription-copy');
      if (copyButton) copyButton.disabled = true;
      const message = error instanceof SubscriptionAgentsError ? error.message : 'Die Preview konnte nicht bestätigt werden.';
      setStatus('subscription-status', message, true);
    } finally {
      if (composeButton && epoch === previewEpoch)
        composeButton.disabled = loadingSources || declarationState(capabilityPayload) !== 'available';
    }
  });

  document.getElementById('subscription-refresh')?.addEventListener('click', () => { void refresh(); });
  document.getElementById('subscription-copy')?.addEventListener('click', async event => {
    if (!lastPreview || !lastPreview.prompt) return;
    const prompt = document.getElementById('subscription-prompt');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(lastPreview.prompt);
      setStatus('subscription-status', 'Prompt in die Browser-Zwischenablage kopiert. Kein Agent wurde gestartet.');
    } catch {
      prompt?.focus();
      prompt?.select();
      setStatus('subscription-status', 'Prompt ist markiert. Kopiere ihn manuell mit Strg+C oder ⌘C.');
    }
    event.currentTarget.blur();
  });

  void refresh();
}

if (typeof document !== 'undefined') initSubscriptionAgentsPage();
