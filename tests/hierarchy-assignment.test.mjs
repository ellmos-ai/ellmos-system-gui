import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ApiError, GROUPS, failureOf, parseHierarchy, diffAssignments, hasChanges, buildPutBody, verifyReadback, declarationState, loadedView, derivedExpertNote, DERIVED_EXPERT_NOTE, createHierarchyClient} from '../src/lib/hierarchy-assignment.mjs';

const json = (status, body) => ({ok: status < 400, status, json: async () => body});
const answer = (over = {}) => ({
  items: {
    agents: [{id: 'boss', name: 'Boss', description: 'd'}, {id: 'other', name: 'Other'}],
    experts: [{id: 'e1', name: 'Expert 1'}], skills: [{id: 's1', name: 'S1'}, {id: 's2', name: 'S2'}],
    services: [{id: 'v1', name: 'V1'}], workflows: [],
  },
  assignments: {boss: {experts: ['e1'], skills: ['s1'], services: [], workflows: []}},
  _meta: {source: 'bach.db', generated_at: 'x'}, ...over,
});
function recorder(responder) {
  const calls = [];
  return {calls, fetcher: async (url, options = {}) => { calls.push({url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined}); return responder(url, options, calls); }};
}

test('failures are classified into separate kinds (404/501 = adapter not available, 400 keeps the text, 503 = table missing)', () => {
  for (const [status, kind] of [[0, 'network'], [401, 'auth'], [403, 'auth'], [404, 'unavailable'], [501, 'unavailable'], [400, 'invalid'], [422, 'invalid'], [413, 'invalid'], [503, 'table-missing'], [500, 'server']])
    assert.equal(failureOf(status).kind, kind, String(status));
  assert.equal(failureOf(400, {detail: 'Ungültige Hierarchie: x'}).detail, 'Ungültige Hierarchie: x');
});

test('parse is strict, ids come from the API, unknown children are dropped, every agent gets all four lists', () => {
  const p = parseHierarchy(answer({assignments: {boss: {experts: ['e1', 'e1', 'ghost'], skills: ['s1']}}}));
  assert.deepEqual(p.assignments.boss, {experts: ['e1'], skills: ['s1'], services: [], workflows: []});
  assert.deepEqual(p.assignments.other, {experts: [], skills: [], services: [], workflows: []});
  assert.equal(p.items.agents[1].name, 'Other');
  for (const bad of [null, {}, {items: {}, assignments: {}}, answer({items: {...answer().items, skills: [{id: 's1'}, {id: 's1'}]}}),
    answer({items: {...answer().items, agents: [{name: 'x'}]}}), answer({assignments: {boss: {skills: 'x'}}}), answer({assignments: {boss: 'x'}})])
    assert.throws(() => parseHierarchy(bad), e => e.kind === 'contract');
});

test('writable ONLY when the answer says _meta.source is bach.db (an empty DB-error structure must never be written back)', () => {
  assert.equal(parseHierarchy(answer()).writable, true);
  assert.equal(parseHierarchy(answer({_meta: {source: 'empty'}})).writable, false);
  assert.equal(parseHierarchy(answer({_meta: undefined})).writable, false);
  assert.equal(parseHierarchy(answer({_meta: {source: 'skills_hierarchy.json'}})).writable, false);
});

test('diff and PUT body: one agent, ALL four lists (a missing list would delete the stored rows), stable order', () => {
  const base = {experts: ['e1'], skills: ['s1'], services: [], workflows: []};
  const draft = {experts: [], skills: ['s2', 's1'], services: ['v1'], workflows: []};
  const diff = diffAssignments(base, draft);
  assert.deepEqual(diff.experts, {added: [], removed: ['e1']});
  assert.deepEqual(diff.skills, {added: ['s2'], removed: []});
  assert.equal(hasChanges(diff), true);
  assert.equal(hasChanges(diffAssignments(base, base)), false);
  const body = buildPutBody('boss', draft);
  assert.deepEqual(Object.keys(body), ['assignments']);
  assert.deepEqual(Object.keys(body.assignments), ['boss']);
  assert.deepEqual(Object.keys(body.assignments.boss), GROUPS.map(g => g.key));
  assert.deepEqual(body.assignments.boss.skills, ['s1', 's2']);
  assert.throws(() => buildPutBody('', draft), e => e.kind === 'invalid');
});

test('readback compares as sets and reports missing/extra per group', () => {
  const parsed = parseHierarchy(answer());
  assert.equal(verifyReadback('boss', {experts: ['e1'], skills: ['s1'], services: [], workflows: []}, parsed).ok, true);
  const bad = verifyReadback('boss', {experts: ['e1'], skills: ['s1', 's2'], services: ['v1'], workflows: []}, parsed);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.problems.map(p => [p.group, p.missing]), [['skills', ['s2']], ['services', ['v1']]]);
});

test('declaration: GET and PUT must be declared; an unreadable declaration is unknown, not unavailable', () => {
  const ep = (method, path = '/api/skills-board/hierarchy') => ({method, path, available: true});
  assert.equal(declarationState({endpoints: [ep('GET'), ep('PUT')]}), 'declared');
  assert.equal(declarationState({endpoints: [ep('GET')]}), 'undeclared');
  assert.equal(declarationState({endpoints: [ep('GET', '/api/tasks'), ep('PUT', '/api/tasks')]}), 'undeclared');
  assert.equal(declarationState({endpoints: [{...ep('GET'), available: false}, ep('PUT')]}), 'undeclared');
  assert.equal(declarationState(null), 'unknown');
  assert.equal(declarationState({}), 'unknown');
});

test('client.declared: missing capabilities route is unknown (the GET decides)', async () => {
  const miss = createHierarchyClient(recorder(() => json(404, {detail: 'x'})).fetcher);
  assert.equal(await miss.declared(), 'unknown');
  const down = createHierarchyClient(async () => { throw new Error('offline'); });
  assert.equal(await down.declared(), 'unknown');
});

test('client.load maps failures to separate states and never turns them into an empty list', async () => {
  for (const [status, kind] of [[404, 'unavailable'], [501, 'unavailable'], [401, 'auth'], [403, 'auth'], [503, 'table-missing'], [400, 'invalid'], [500, 'server']]) {
    const client = createHierarchyClient(recorder(() => json(status, {detail: 'boom'})).fetcher);
    await assert.rejects(client.load(), e => e.kind === kind, String(status));
  }
  await assert.rejects(createHierarchyClient(async () => { throw new Error('x'); }).load(), e => e.kind === 'network');
  await assert.rejects(createHierarchyClient(recorder(() => json(200, [])).fetcher).load(), e => e.kind === 'contract');
});

test('save: fresh read, PUT with the whole agent, readback; the PUT is sent exactly once', async () => {
  const stored = {experts: ['e1'], skills: ['s1'], services: [], workflows: []};
  const draft = {experts: ['e1'], skills: ['s1', 's2'], services: [], workflows: []};
  let current = stored;
  const rec = recorder((url, o) => {
    if (o.method === 'PUT') { current = draft; return json(200, {status: 'saved', persisted: 'hierarchy_assignments', items_persisted: false, parents: 1, inserted: 1, updated: 0, deleted: 0}); }
    return json(200, answer({assignments: {boss: current}}));
  });
  const result = await createHierarchyClient(rec.fetcher).save('boss', stored, draft);
  assert.deepEqual(rec.calls.map(c => c.method), ['GET', 'PUT', 'GET']);
  assert.deepEqual(rec.calls[1].body.assignments.boss.skills, ['s1', 's2']);
  assert.equal(result.verification.ok, true);
  assert.deepEqual(result.after.assignments.boss.skills, ['s1', 's2']);
});

test('save is refused without a PUT when the source is not the database (negative control: a normal answer does write)', async () => {
  const stored = {experts: [], skills: [], services: [], workflows: []};
  const draft = {experts: [], skills: ['s1'], services: [], workflows: []};
  const readonly = recorder(() => json(200, answer({assignments: {}, _meta: {source: 'empty'}})));
  await assert.rejects(createHierarchyClient(readonly.fetcher).save('boss', stored, draft), e => e.kind === 'readonly');
  assert.ok(readonly.calls.every(c => c.method === 'GET'), 'no PUT may be sent');
  const normal = recorder((url, o) => (o.method === 'PUT' ? json(200, {status: 'saved', persisted: 'hierarchy_assignments'}) : json(200, answer({assignments: {}}))));
  await createHierarchyClient(normal.fetcher).save('boss', stored, draft);
  assert.ok(normal.calls.some(c => c.method === 'PUT'));
});

test('save detects a concurrent change before writing (no PUT) and reports server refusals with their text', async () => {
  const stored = {experts: ['e1'], skills: [], services: [], workflows: []};
  const draft = {experts: [], skills: [], services: [], workflows: []};
  const changed = recorder(() => json(200, answer({assignments: {boss: {experts: ['e1'], skills: ['s2']}}})));
  await assert.rejects(createHierarchyClient(changed.fetcher).save('boss', stored, draft), e => e.kind === 'conflict');
  assert.ok(changed.calls.every(c => c.method === 'GET'));
  for (const [status, kind] of [[400, 'invalid'], [503, 'table-missing'], [401, 'auth'], [500, 'server']]) {
    const rec = recorder((u, o) => (o.method === 'PUT' ? json(status, {detail: 'Ungültige Hierarchie: x'}) : json(200, answer())));
    await assert.rejects(createHierarchyClient(rec.fetcher).save('boss', {experts: ['e1'], skills: ['s1'], services: [], workflows: []}, draft), e => e.kind === kind && (status !== 400 || /Ungültige Hierarchie/.test(e.message)));
  }
});

test('save reports a readback that differs from what was written instead of claiming success', async () => {
  const stored = {experts: ['e1'], skills: ['s1'], services: [], workflows: []};
  const draft = {experts: ['e1'], skills: ['s1', 's2'], services: [], workflows: []};
  const rec = recorder((u, o) => (o.method === 'PUT' ? json(200, {status: 'saved', persisted: 'hierarchy_assignments'}) : json(200, answer())));
  const result = await createHierarchyClient(rec.fetcher).save('boss', stored, draft);
  assert.equal(result.verification.ok, false);
  assert.deepEqual(result.verification.problems[0], {group: 'skills', missing: ['s2'], extra: []});
  const wrong = recorder((u, o) => (o.method === 'PUT' ? json(200, {status: 'saved', persisted: 'hierarchy_assignments.json'}) : json(200, answer())));
  await assert.rejects(createHierarchyClient(wrong.fetcher).save('boss', stored, draft), e => e.kind === 'contract');
});

test('UI source: no innerHTML/outerHTML/insertAdjacentHTML, no inline handlers, no local storage of assignments, no text colour from the raw accent', () => {
  const ui = readFileSync(new URL('../src/lib/hierarchy-assignment-ui.mjs', import.meta.url), 'utf8');
  const lib = readFileSync(new URL('../src/lib/hierarchy-assignment.mjs', import.meta.url), 'utf8');
  const astro = readFileSync(new URL('../src/components/CapabilityBoard.astro', import.meta.url), 'utf8');
  for (const source of [ui, lib]) {
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(source, /\son[a-z]+\s*=/);
  }
  const css = astro.slice(astro.indexOf('<style is:global>'));
  assert.doesNotMatch(css, /[^-]color:\s*var\(--(accent|success|warning|error|accent-blue)\)/);
  assert.match(css, /--error-text/);
  assert.match(css, /--success-text/);
});

test('an empty agent list is an empty stock only for source bach.db; the DB-error fallback ("empty") is a source problem', () => {
  const noAgents = over => parseHierarchy(answer({items: {agents: [], experts: [], skills: [], services: [], workflows: []}, assignments: {}, ...over}));
  assert.equal(loadedView(noAgents({})), 'empty');
  assert.equal(loadedView(noAgents({_meta: {source: 'empty'}})), 'source-unavailable');
  assert.equal(loadedView(noAgents({_meta: undefined})), 'source-unavailable');
  assert.equal(loadedView(parseHierarchy(answer())), 'ready');
  assert.equal(loadedView(parseHierarchy(answer({_meta: {source: 'empty'}}))), 'ready'); // agents present: the read-only note handles it
});

test('derived experts: a note appears only when an expert reappears after the readback', () => {
  const parsed = parseHierarchy(answer());
  const bad = verifyReadback('boss', {experts: [], skills: ['s1'], services: [], workflows: []}, parsed);
  assert.equal(derivedExpertNote(bad.problems), DERIVED_EXPERT_NOTE);
  const skillsOnly = verifyReadback('boss', {experts: ['e1'], skills: ['s1', 's2'], services: [], workflows: []}, parsed);
  assert.equal(derivedExpertNote(skillsOnly.problems), '');
  assert.equal(derivedExpertNote([]), '');
});
