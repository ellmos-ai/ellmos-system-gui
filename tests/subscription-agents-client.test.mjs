import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildComposeRequest,
  composePreview,
  declarationState,
  loadBlueprints,
  loadCapabilities,
  loadSkillLibrary,
  parseBlueprintCatalog,
  parseSkillLibrary,
  SubscriptionAgentsError,
  SUBSCRIPTION_AGENTS_PATHS,
  validatePreview,
} from '../src/lib/subscription-agents-client.mjs';

const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; });

const caps = state => ({
  schema: 'ellmos.gui.capabilities.v1',
  endpoints: state === 'unknown' ? [] : [{
    method: 'POST', path: SUBSCRIPTION_AGENTS_PATHS.compose,
    ...(state === 'available' ? {available: true} : state === 'unavailable' ? {available: false} : {}),
  }],
});
const blueprintPayload = {
  blueprints: [{id: 42, title: 'Helper', name: 'Helper', version: 3, kind: 'agent',
    persona_role: 'assistant', skills: []}],
  templates: [
    {id: 84, name: 'Template', version: 2, kind: 'role', persona_role: 'assistant', skills: []},
    {id: 85, name: 'Legacy', version: '1.0.0', kind: 'agent', persona_role: 'assistant', skills: []},
    {id: 42, name: 'Duplicate', version: 6, kind: 'agent', persona_role: 'assistant', skills: []},
  ],
};
const skillPayload = {
  schema: 'bach.skill-library.v1',
  skills: [{id: 'load-project', name: 'Load Project', category: 'workflow', version: '2.0.0',
    source_version: 'a'.repeat(64), evidence_type: 'filesystem_present', source_kind: 'factory'}],
};
const request = {
  schema: 'bach.subscription-agent-onboarding.request.v1',
  target_client: {client_id: 'codex', host: 'laptop', name: 'Codex'},
  blueprint: {id: 42, version: 3},
  selected_skill_ids: ['load-project'], user_task: 'Prüfe die Aufgabe.', task_refs: [31],
  task_selection_rule: '', governance: {scope: 'BACH', policy_query: '', decision_query: ''},
};
const previewContext = {
  blueprint: parseBlueprintCatalog(blueprintPayload).find(item => item.id === 42),
  skills: parseSkillLibrary(skillPayload),
};
const makeSource = (id, kind, state, version, sha256, details = {}, options = {}) => ({
  id, kind, state, version, sha256,
  host: options.host ?? 'test-host', path: options.path ?? null,
  source_bytes: options.sourceBytes ?? 1,
  included_chars: options.includedChars ?? 1,
  included_bytes: options.includedBytes ?? 1,
  ...details,
});
const userTaskBytes = new TextEncoder().encode(request.user_task).length;
const policyDigest = 'e'.repeat(64);
const policyReference = {
  id: 'policy-test', kind: 'policy', scope: 'BACH', version: '1', status: 'active',
  source_state: 'current', source_sha256: 'f'.repeat(64), enforcement_verified: false,
};
const preview = {
  schema: 'bach.subscription-agent-onboarding.preview.v1', status: 'ready_for_review',
  target_client: request.target_client, blueprint: {...request.blueprint, id: String(request.blueprint.id), name: 'Helper', sha256: 'b'.repeat(64)},
  governance_scope: 'BACH', prompt: 'Nur eine Vorschau.', prompt_chars: 18, prompt_bytes: 18,
  max_prompt_chars: 120000, sources: [
    makeSource('blueprint:42', 'blueprint', 'included', 3, 'b'.repeat(64), {
      kind_id: 'agent', snapshot_source: 'blueprint_service._execution_blueprint', projection_only: true,
    }),
    makeSource('role:assistant', 'role', 'included', 3, 'c'.repeat(64), {blueprint_sha256: 'b'.repeat(64)}),
    makeSource('skill:load-project', 'skill', 'included', '2.0.0', 'a'.repeat(64), {tools_granted: false}),
    makeSource('task:31', 'task_snapshot', 'included', 'd'.repeat(64), 'd'.repeat(64), {
      task_id: 31, task_reference_only: true,
    }, {host: 'BACH-TaskLeaseClient'}),
    makeSource('policy-registry:policy', 'policy', 'available', policyDigest, policyDigest, {
      enforcement_verified: false, read_only: true, count: 1, truncated: false, refs: [policyReference],
    }, {host: 'policy-registry'}),
    makeSource('policy-registry:decision', 'decision', 'available_empty', '1'.repeat(64), '1'.repeat(64), {
      enforcement_verified: false, read_only: true, count: 0, truncated: false, refs: [],
    }, {host: 'policy-registry'}),
    makeSource('user-task', 'user_instruction', 'included', 1, '2'.repeat(64), {}, {
      host: 'request', sourceBytes: userTaskBytes, includedChars: request.user_task.length,
      includedBytes: userTaskBytes,
    }),
  ], missing: [],
  actions: {agent_started: false, task_claimed: false, queue_scanned: false, clipboard_written: false},
  limits: {credential_scan: 'heuristic_only', task_context: 'reference_only', governance_enforcement_verified: false},
};
const response = (body, status = 200) => ({ok: status >= 200 && status < 300, status, json: async () => body});
const workspacePreview = workspace => {
  const prompt = `- Arbeitskontext: ${workspace} (Zugriff nicht geprüft)\n${preview.prompt}`;
  return {
    ...preview,
    target_client: {...request.target_client, workspace},
    prompt,
    prompt_chars: prompt.length,
    prompt_bytes: new TextEncoder().encode(prompt).length,
  };
};

test('capability declaration distinguishes available, unavailable, and unknown', () => {
  assert.equal(declarationState(caps('available')), 'available');
  assert.equal(declarationState(caps('unavailable')), 'unavailable');
  assert.equal(declarationState(caps('unknown')), 'unavailable');
  assert.equal(declarationState({schema: 'wrong', endpoints: []}), 'unknown');
  assert.equal(declarationState({...caps('available'), endpoints: [...caps('available').endpoints, ...caps('available').endpoints]}), 'unknown');
});

test('blueprint catalog keeps incompatible revisions visible but never selectable', () => {
  const items = parseBlueprintCatalog(blueprintPayload);
  assert.deepEqual(items.map(item => item.id), [42, 84, 85]);
  assert.equal(items[0].version, 3);
  assert.deepEqual(items[0].skillIds, []);
  assert.equal(items[0].personaRole, 'assistant');
  assert.equal(items[2].composable, false);
  assert.throws(() => parseBlueprintCatalog({blueprints: [], templates: null}), SubscriptionAgentsError);
  const invalidSkills = parseBlueprintCatalog({blueprints: [{id: 23, name: 'Bad', version: 1,
    kind: 'agent', persona_role: 'assistant', skills: ['not valid!']}], templates: []});
  assert.equal(invalidSkills[0].composable, false);
  assert.deepEqual(parseBlueprintCatalog({blueprints: [{...blueprintPayload.blueprints[0], id: '42'}], templates: []}), []);
});

test('skill selection is bound to a current skill-library source version', () => {
  const items = parseSkillLibrary(skillPayload);
  assert.equal(items[0].sourceVersion, 'a'.repeat(64));
  assert.throws(() => parseSkillLibrary({...skillPayload, skills: [{...skillPayload.skills[0], source_version: 'unknown'}]}), /unvollständig/);
  assert.throws(() => parseSkillLibrary({...skillPayload, skills: [skillPayload.skills[0], skillPayload.skills[0]]}), /unvollständig/);
});

test('request uses only the agreed composer fields and task references are positive unique IDs', () => {
  const blueprints = parseBlueprintCatalog(blueprintPayload);
  const skills = parseSkillLibrary(skillPayload);
  const payload = buildComposeRequest({
    clientId: 'codex', host: 'laptop', clientName: 'Codex', blueprintId: '42',
    selectedSkillIds: ['load-project'], userTask: '', taskRefs: '31, 32', taskSelectionRule: 'Manuelle Auswahl',
    governanceScope: 'BACH', policyQuery: 'Taskpolicy', decisionQuery: '',
  }, {blueprints, skills});
  assert.deepEqual(Object.keys(payload).sort(), ['blueprint', 'governance', 'schema', 'selected_skill_ids', 'target_client', 'task_refs', 'task_selection_rule', 'user_task'].sort());
  assert.deepEqual(payload.task_refs, [31, 32]);
  assert.equal(payload.blueprint.id, 42);
  assert.equal(typeof payload.blueprint.id, 'number');
  assert.equal(payload.blueprint.version, 3);
  assert.deepEqual(payload.governance, {scope: 'BACH', policy_query: 'Taskpolicy', decision_query: ''});
  assert.equal('workspace' in payload.target_client, false);
  const emptyWorkspace = buildComposeRequest({clientId: 'codex', host: 'laptop', clientName: 'Codex',
    blueprintId: '42', taskRefs: '31', workspace: '  '}, {blueprints, skills});
  assert.equal('workspace' in emptyWorkspace.target_client, false);
  const withWorkspace = buildComposeRequest({clientId: 'codex', host: 'laptop', clientName: 'Codex',
    blueprintId: '42', taskRefs: '31', workspace: 'Projektbereich BACH'}, {blueprints, skills});
  assert.equal(withWorkspace.target_client.workspace, 'Projektbereich BACH');
  const maxWorkspace = buildComposeRequest({clientId: 'codex', host: 'laptop', clientName: 'Codex',
    blueprintId: '42', taskRefs: '31', workspace: 'w'.repeat(1024)}, {blueprints, skills});
  assert.equal(maxWorkspace.target_client.workspace.length, 1024);
  assert.equal(buildComposeRequest({clientId: 'codex', host: 'h'.repeat(128), clientName: 'Codex',
    blueprintId: '42', taskRefs: '31'}, {blueprints, skills}).target_client.host.length, 128);
  assert.throws(() => buildComposeRequest({clientId: 'codex', host: 'h'.repeat(129), clientName: 'Codex',
    blueprintId: '42', taskRefs: '31'}, {blueprints, skills}), /Host/);
  for (const workspace of ['w'.repeat(1025), 'zwei\nZeilen', 'eine\u2028Zeile', 'Bearer syntheticfixture123456', 'api_key=syntheticfixture123456'])
    assert.throws(() => buildComposeRequest({clientId: 'codex', host: 'laptop', clientName: 'Codex',
      blueprintId: '42', taskRefs: '31', workspace}, {blueprints, skills}), /Arbeitskontext/);
  assert.throws(() => buildComposeRequest({clientId: 'codex', host: 'laptop', clientName: 'Codex',
    blueprintId: '42', taskRefs: '31', workspace: {path: 'not-a-text-field'}}, {blueprints, skills}), /Arbeitskontext/);
  assert.equal(buildComposeRequest({clientId: 'a'.repeat(64), host: 'laptop', clientName: 'Codex',
    blueprintId: '42', taskRefs: '31', userTask: 'x'}, {blueprints, skills}).target_client.client_id.length, 64);
  assert.throws(() => buildComposeRequest({clientId: 'a'.repeat(65), host: 'laptop', clientName: 'Codex',
    blueprintId: '42', taskRefs: '31'}, {blueprints, skills}), /Client-Kennung/);
  assert.throws(() => buildComposeRequest({clientId: 'codex', host: 'laptop', clientName: 'Codex', blueprintId: '85', taskRefs: '31'}, {blueprints, skills}), /Ganzzahlrevision/);
  assert.throws(() => buildComposeRequest({clientId: 'codex', host: 'laptop', clientName: 'Codex', blueprintId: '42', selectedSkillIds: ['not-loaded'], taskRefs: '31'}, {blueprints, skills}), /unbekannte Skills/);
  assert.throws(() => buildComposeRequest({clientId: 'codex', host: 'laptop', clientName: 'Codex', blueprintId: '042', taskRefs: '31'}, {blueprints, skills}), /Ganzzahlrevision/);
  for (const taskRefs of ['0', '-2', '1,1', '1.2', Array(21).fill('1').join(',')])
    assert.throws(() => buildComposeRequest({clientId: 'codex', host: 'laptop', clientName: 'Codex', blueprintId: '42', taskRefs}, {blueprints, skills}));
});

test('read calls are same-origin GETs and only the declared preview route is POSTed', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url, options});
    if (url === SUBSCRIPTION_AGENTS_PATHS.capabilities) return response(caps('available'));
    if (url === SUBSCRIPTION_AGENTS_PATHS.blueprints) return response(blueprintPayload);
    if (url === SUBSCRIPTION_AGENTS_PATHS.skills) return response(skillPayload);
    return response(preview);
  };
  const capabilityPayload = await loadCapabilities();
  assert.deepEqual(await loadBlueprints(), parseBlueprintCatalog(blueprintPayload));
  assert.deepEqual(await loadSkillLibrary(), parseSkillLibrary(skillPayload));
  assert.deepEqual(await composePreview(request, capabilityPayload, previewContext), preview);
  assert.deepEqual(calls.map(call => [call.url, call.options.method]), [
    [SUBSCRIPTION_AGENTS_PATHS.capabilities, 'GET'],
    [SUBSCRIPTION_AGENTS_PATHS.blueprints, 'GET'],
    [SUBSCRIPTION_AGENTS_PATHS.skills, 'GET'],
    [SUBSCRIPTION_AGENTS_PATHS.compose, 'POST'],
  ]);
  for (const call of calls) {
    assert.equal(call.options.credentials, 'same-origin');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.cache, 'no-store');
  }
  const sent = JSON.parse(calls.at(-1).options.body);
  assert.deepEqual(sent, request);
});

test('workspace is transmitted only when present and must echo as explicitly unverified context', async () => {
  const workspace = 'Projektbereich BACH';
  const requestWithWorkspace = {...request, target_client: {...request.target_client, workspace}};
  const previewWithWorkspace = workspacePreview(workspace);
  let sent;
  globalThis.fetch = async (url, options) => {
    if (url === SUBSCRIPTION_AGENTS_PATHS.compose) {
      sent = JSON.parse(options.body);
      return response(previewWithWorkspace);
    }
    return response(caps('available'));
  };
  const result = await composePreview(requestWithWorkspace, caps('available'), previewContext);
  assert.deepEqual(sent.target_client, requestWithWorkspace.target_client);
  assert.equal(result.target_client.workspace, workspace);
  assert.match(result.prompt, /- Arbeitskontext: Projektbereich BACH \(Zugriff nicht geprüft\)\n/);
});

test('unknown or unavailable capability prevents any preview POST', async () => {
  let posts = 0;
  globalThis.fetch = async (_url, options) => { if (options.method === 'POST') posts += 1; return response(preview); };
  await assert.rejects(composePreview(request, caps('unknown')), error => error.kind === 'unavailable');
  await assert.rejects(composePreview(request, {...caps('available'), endpoints: [{method: 'POST', path: SUBSCRIPTION_AGENTS_PATHS.compose}]}), error => error.kind === 'unknown');
  assert.equal(posts, 0);
});

test('preview must retain preview-only action flags and reference-only limits', () => {
  assert.equal(validatePreview(preview, request, previewContext).status, 'ready_for_review');
  assert.throws(() => validatePreview({...preview, actions: {...preview.actions, task_claimed: true}}, request, previewContext), /Preview-only/);
  assert.throws(() => validatePreview({...preview, limits: {...preview.limits, governance_enforcement_verified: true}}, request, previewContext), /Preview-only/);
  assert.throws(() => validatePreview({...preview, target_client: {...preview.target_client, client_id: 'other'}}, request, previewContext), /Preview-only/);
  assert.throws(() => validatePreview({...preview, blueprint: {...preview.blueprint, id: 42}}, request, previewContext), /Preview-only/);
  assert.throws(() => validatePreview(preview, {...request, blueprint: {...request.blueprint, id: '42'}}, previewContext), /Preview-only/);
  assert.throws(() => validatePreview({...preview, schema: 'wrong'}, request, previewContext), /Preview-only/);
});

test('optional workspace is echoed only as unverified text in preview metadata and prompt', () => {
  const workspace = 'Projektbereich BACH';
  const withWorkspace = {
    ...request,
    target_client: {...request.target_client, workspace},
  };
  const echoed = workspacePreview(workspace);
  assert.equal(validatePreview(echoed, withWorkspace, previewContext).target_client.workspace, workspace);
  assert.throws(() => validatePreview({...echoed, target_client: {...echoed.target_client, workspace: 'anderer Bereich'}},
    withWorkspace, previewContext), /Preview-only/);
  const promptWithoutMark = {...echoed, prompt: echoed.prompt.replace(' (Zugriff nicht geprüft)', ''),
    prompt_chars: echoed.prompt.length - ' (Zugriff nicht geprüft)'.length,
    prompt_bytes: new TextEncoder().encode(echoed.prompt.replace(' (Zugriff nicht geprüft)', '')).length};
  assert.throws(() => validatePreview(promptWithoutMark, withWorkspace, previewContext), /Preview-only/);
  assert.throws(() => validatePreview({...echoed, target_client: request.target_client}, withWorkspace, previewContext), /Preview-only/);
});

test('real needs_sources shape accounts for blueprint skills and task failures', () => {
  const skills = parseSkillLibrary(skillPayload);
  const missingBlueprintPayload = {
    ...blueprintPayload,
    blueprints: [{...blueprintPayload.blueprints[0], skills: ['not-installed']}],
  };
  const missingBlueprint = parseBlueprintCatalog(missingBlueprintPayload).find(item => item.id === 42);
  const missingRequest = buildComposeRequest({
    clientId: 'codex', host: 'laptop', clientName: 'Codex', blueprintId: '42',
    selectedSkillIds: ['load-project'], userTask: 'Prüfe die Aufgabe.', taskRefs: '31',
    governanceScope: 'BACH',
  }, {blueprints: [missingBlueprint], skills});
  const missingSkill = makeSource('skill:not-installed', 'skill', 'missing', null, null,
    {tools_granted: false}, {sourceBytes: 0, includedChars: 0, includedBytes: 0});
  const needsSources = {
    ...preview,
    status: 'needs_sources',
    sources: preview.sources.filter(row => row.id !== 'task:31').concat(missingSkill),
    missing: [
      {id: 'not-installed', kind: 'skill', reason: 'source_missing'},
      {id: 31, kind: 'task', reason: 'snapshot_unavailable'},
    ],
  };
  assert.equal(validatePreview(needsSources, missingRequest, {
    blueprint: missingBlueprint, skills,
  }).status, 'needs_sources');
  assert.throws(() => validatePreview({...needsSources, status: 'ready_for_review'}, missingRequest, {
    blueprint: missingBlueprint, skills,
  }), /Preview-only/);
  assert.throws(() => validatePreview({...needsSources, missing: []}, missingRequest, {
    blueprint: missingBlueprint, skills,
  }), /Preview-only/);
});

test('native ID 19 needs_sources shape binds integer request to string preview ID and unavailable policy rows', () => {
  const nativeRequest = {
    ...request,
    blueprint: {id: 19, version: 1},
    selected_skill_ids: [],
    user_task: 'Synthetischer Auftrag zur Vorschau.',
    task_refs: [],
    task_selection_rule: '',
  };
  const expected = {
    blueprint: {id: 19, version: 1, personaRole: 'boss_routing', skillIds: []},
    skills: [],
  };
  const blueprintSha = '6'.repeat(64);
  const userTaskBytes = new TextEncoder().encode(nativeRequest.user_task).length;
  const nativeSources = [
    makeSource('blueprint:19', 'blueprint', 'included', 1, blueprintSha, {
      kind_id: 'agent', snapshot_source: 'blueprint_service._execution_blueprint', projection_only: true,
    }, {host: 'mac-studio', sourceBytes: 782, includedChars: 476, includedBytes: 481}),
    makeSource('role:boss_routing', 'role', 'included', 1, '7'.repeat(64), {
      blueprint_sha256: blueprintSha,
    }, {host: 'mac-studio', sourceBytes: 578, includedChars: 476, includedBytes: 481}),
    ...['policy', 'decision'].map(kind => makeSource(`policy-registry:${kind}`, kind,
      'unavailable', null, null, {enforcement_verified: false, read_only: true, count: 0}, {
        host: 'policy-registry', sourceBytes: 0, includedChars: 0, includedBytes: 0,
      })),
    makeSource('user-task', 'user_instruction', 'included', 1, '8'.repeat(64), {}, {
      host: 'request', sourceBytes: userTaskBytes, includedChars: nativeRequest.user_task.length,
      includedBytes: userTaskBytes,
    }),
  ];
  const nativePrompt = 'Synthetische native Vorschau.';
  const nativePreview = {
    ...preview,
    status: 'needs_sources',
    target_client: nativeRequest.target_client,
    blueprint: {id: '19', name: 'Routing-Agent', version: 1, sha256: blueprintSha},
    prompt: nativePrompt,
    prompt_chars: nativePrompt.length,
    prompt_bytes: new TextEncoder().encode(nativePrompt).length,
    sources: nativeSources,
    missing: [
      {id: 'policy-registry:policy', kind: 'policy', reason: 'provider_unavailable'},
      {id: 'policy-registry:decision', kind: 'decision', reason: 'provider_unavailable'},
    ],
  };

  assert.equal(typeof nativeRequest.blueprint.id, 'number');
  assert.equal(typeof nativePreview.blueprint.id, 'string');
  assert.equal(validatePreview(nativePreview, nativeRequest, expected).status, 'needs_sources');
  assert.throws(() => validatePreview({...nativePreview,
    blueprint: {...nativePreview.blueprint, id: 19}}, nativeRequest, expected), /Preview-only/);
  assert.throws(() => validatePreview({...nativePreview,
    blueprint: {...nativePreview.blueprint, id: '019'}}, nativeRequest, expected), /Preview-only/);
  assert.throws(() => validatePreview({...nativePreview,
    sources: nativeSources.map(row => row.kind === 'policy' || row.kind === 'decision'
      ? {...row, refs: [], truncated: false} : row)}, nativeRequest, expected), /Preview-only/);
  assert.throws(() => validatePreview({...nativePreview,
    sources: nativeSources.map(row => row.kind === 'policy' ? {...row, read_only: undefined} : row)},
  nativeRequest, expected), /Preview-only/);
});

test('preview rejects malformed, stale, duplicated, or unaccounted source records', () => {
  const context = previewContext;
  const changed = preview.sources.map(row => row.id === 'skill:load-project' ? {...row, sha256: 'bad'} : row);
  assert.throws(() => validatePreview({...preview, sources: changed}, request, context), /Preview-only/);
  assert.throws(() => validatePreview({...preview, sources: preview.sources.filter(row => row.id !== 'skill:load-project')}, request, context), /Preview-only/);
  assert.throws(() => validatePreview({...preview, sources: preview.sources.filter(row => row.id !== 'blueprint:42')}, request, context), /Preview-only/);
  assert.throws(() => validatePreview({...preview, sources: [...preview.sources, {...preview.sources[2], id: 'skill:other'}]}, request, context), /Preview-only/);
  assert.throws(() => validatePreview({...preview, sources: [...preview.sources, {kind: 'skill'}]}, request, context), /Preview-only/);
  assert.throws(() => validatePreview({...preview, missing: ['skill:load-project'], status: 'needs_sources'}, request, context), /Preview-only/);
  assert.throws(() => validatePreview({...preview, sources: preview.sources.map(row => row.id === 'role:assistant'
    ? {...row, blueprint_sha256: '0'.repeat(64)} : row)}, request, context), /Preview-only/);
});

test('HTTP failures do not pass backend details into the UI error', async () => {
  globalThis.fetch = async () => response({detail: 'C:\\private\\home\\user-name'}, 503);
  await assert.rejects(loadBlueprints(), error => error.status === 503 && !error.message.includes('private'));
});
