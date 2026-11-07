import assert from 'node:assert/strict';
import test from 'node:test';
import {parseHooks, parsePermissionMatrix} from '../src/lib/governance-readers.mjs';
import {createGovernanceRequest} from '../src/lib/governance-request.mjs';

const hooksBody = (over = {}) => ({success: true, available: true, concept: 'hook-master', detail: 'Ein zentraler hook-master ist als Konzept vorgesehen.',
  db_guard_present: true, hooks: [{name: 'bach-db-guard.sh', present: true, path: 'C:\private\bach-db-guard.sh'}, {name: 'other.sh', present: false}],
  checked_at: '2026-11-07T10:00:00+00:00', ...over});

test('hooks: names and presence are read, the local file path is never carried into the model', () => {
  const model = parseHooks(hooksBody());
  assert.equal(model.available, true);
  assert.equal(model.concept, 'hook-master');
  assert.equal(model.dbGuardPresent, true);
  assert.deepEqual(model.hooks, [{name: 'bach-db-guard.sh', present: true}, {name: 'other.sh', present: false}]);
  assert.equal(JSON.stringify(model).includes('private'), false);
  assert.equal(model.checkedAt, '2026-11-07T10:00:00+00:00');
});

test('hooks: an empty list is a real answer, a missing list is a contract violation', () => {
  assert.deepEqual(parseHooks(hooksBody({available: false, hooks: []})).hooks, []);
  assert.throws(() => parseHooks({success: true, available: true}), /Governance-Vertrag/);
  assert.throws(() => parseHooks(null), /Governance-Vertrag/);
  assert.throws(() => parseHooks(hooksBody({hooks: [{present: true}]})), /Governance-Vertrag/);
});

const matrixBody = (over = {}) => ({success: true, actions: ['bildschirmsteuerung', 'mail'], actors: ['buddha', 'codex'], decisions: ['erlaubt', 'rueckfrage', 'nie'],
  row_defaults: {bildschirmsteuerung: 'rueckfrage', mail: 'nie'}, column_defaults: {buddha: 'rueckfrage', codex: 'nie'}, fallback: 'nie',
  cells: {bildschirmsteuerung: {}, mail: {buddha: 'rueckfrage'}},
  effective_cells: {'bildschirmsteuerung|buddha': {decision: 'rueckfrage', reason: 'row default', source: 'row_default', needs_ticket: false, escalation_hint: null},
    'bildschirmsteuerung|codex': {decision: 'nie', reason: 'column default', source: 'column_default', needs_ticket: true, escalation_hint: 'Ticket'},
    'mail|buddha': {decision: 'rueckfrage', reason: 'cell', source: 'cell', needs_ticket: false, escalation_hint: null},
    'mail|codex': {decision: 'nie', reason: 'row default', source: 'row_default', needs_ticket: false, escalation_hint: null}},
  operators: [{actor: 'buddha', rank: 1}], escalation_ladder: ['buddha', 'codex'], revision: 'v1', notice: 'Hinweis', ...over});

test('permission matrix: rows by action, columns by actor, decisions from the backend only', () => {
  const model = parsePermissionMatrix(matrixBody());
  assert.deepEqual(model.actors, ['buddha', 'codex']);
  assert.deepEqual(model.rows.map(row => row.action), ['bildschirmsteuerung', 'mail']);
  const cell = model.rows[0].cells[1];
  assert.deepEqual({actor: cell.actor, decision: cell.decision, source: cell.source, needsTicket: cell.needsTicket, hint: cell.escalationHint},
    {actor: 'codex', decision: 'nie', source: 'column_default', needsTicket: true, hint: 'Ticket'});
  assert.equal(model.rows[1].cells[0].explicit, true);
  assert.equal(model.rows[0].cells[0].explicit, false);
  assert.equal(model.revision, 'v1');
  assert.equal(model.notice, 'Hinweis');
  assert.equal(model.fallback, 'nie');
});

test('permission matrix: without effective cells the declared cell, then the defaults answer; nothing is invented', () => {
  const model = parsePermissionMatrix(matrixBody({effective_cells: undefined}));
  assert.equal(model.rows[1].cells[0].decision, 'rueckfrage');
  assert.equal(model.rows[1].cells[1].decision, 'nie');
  assert.equal(model.rows[0].cells[0].decision, 'rueckfrage');
  const bare = parsePermissionMatrix(matrixBody({effective_cells: undefined, row_defaults: {}, column_defaults: {}, fallback: undefined, cells: {}}));
  assert.equal(bare.rows[0].cells[0].decision, null);
});

test('permission matrix: malformed bodies are contract violations', () => {
  assert.throws(() => parsePermissionMatrix({success: true}), /Governance-Vertrag/);
  assert.throws(() => parsePermissionMatrix(matrixBody({actions: 'mail'})), /Governance-Vertrag/);
  assert.throws(() => parsePermissionMatrix(matrixBody({actors: [1]})), /Governance-Vertrag/);
});

test('the read-only transport accepts exactly the two new read endpoints', async () => {
  const seen = [];
  const request = createGovernanceRequest(result => seen.push(result.state));
  const ok = body => async () => ({ok: true, status: 200, text: async () => JSON.stringify(body)});
  await request.load('/api/governance/hooks', parseHooks, ok(hooksBody()), () => 'ok');
  assert.equal(seen.at(-1), 'ok');
  await request.load('/api/governance/permission-matrix', parsePermissionMatrix, ok(matrixBody()), () => 'ok');
  assert.equal(seen.at(-1), 'ok');
  await request.load('/api/governance/evaluate-permission', parsePermissionMatrix, ok(matrixBody()), () => 'ok');
  assert.equal(seen.at(-1), 'contract');
});
