import test from 'node:test';
import assert from 'node:assert/strict';
import {WINDOWS, describeReason, returnBadge, waitingModel, terminalReasonText, loadTaskReturns, loadReturnTimeline,
  filterEvents, optionsOf, sessionReturnMarker} from '../src/lib/task-returns.mjs';

const summary = (over = {}) => ({available: true, contract: 'task-returns.v1', return_count: 3, last_return_reason: 'task_scope_unavailable',
  last_return_at: '2026-11-07T08:00:00+00:00', consecutive_identical: 3, flapping: false, host_scoped: false, ...over});
const reply = body => ({ok: true, json: async () => body});

test('reasons become plain sentences with a next step; the raw code stays available', () => {
  const host = describeReason('host_precondition:twin_status_unknown');
  assert.equal(host.scope, 'host');
  assert.match(host.title, /Sperrstatus/);
  assert.match(host.hint, /Mac/);
  assert.equal(host.code, 'host_precondition:twin_status_unknown');
  assert.equal(describeReason('task_scope_unavailable').scope, 'task');
  const repeated = describeReason('repeated_return:task_scope_unavailable');
  assert.match(repeated.title, /blockiert/);
  assert.match(repeated.hint, /Arbeitsumgebung/, 'the inner reason is explained too');
  assert.equal(describeReason('model_failure:local_reserve_reserve_wait_expired').scope, 'provider');
  assert.equal(describeReason('capability_missing:safe_shell').scope, 'task');
  assert.equal(describeReason('etwas:Neues').title, 'Unbekannter Grund');
  assert.equal(describeReason('etwas:Neues').code, 'etwas:Neues');
  for (const empty of ['', null, undefined]) assert.equal(describeReason(empty).title, 'Ohne Angabe');
});

test('badge: nothing for one return, a warning from two, critical when flapping or blocked', () => {
  assert.equal(returnBadge(summary({return_count: 0}), {status: 'pending'}), null);
  assert.equal(returnBadge(summary({return_count: 1}), {status: 'pending'}), null);
  const warn = returnBadge(summary({return_count: 2}), {status: 'pending'});
  assert.deepEqual([warn.level, warn.label], ['warn', '2× zurückgegeben']);
  const flap = returnBadge(summary({return_count: 65, flapping: true}), {status: 'pending'});
  assert.deepEqual([flap.level, flap.label], ['critical', '65× zurückgegeben · wechselt hin und her']);
  const blocked = returnBadge(summary({return_count: 5}), {status: 'blocked'});
  assert.equal(blocked.level, 'critical');
  assert.match(blocked.label, /blockiert/);
  assert.equal(returnBadge(summary({host_scoped: true, last_return_reason: 'host_precondition:project_lock'}), {status: 'pending'}).reason.scope, 'host');
  assert.equal(returnBadge({available: false}, {status: 'pending'}), null, 'no kernel, no claim');
  assert.equal(returnBadge(undefined, {status: 'pending'}), null);
  assert.equal(returnBadge(summary({return_count: 'viele'}), {status: 'pending'}), null, 'malformed counters are not shown as a number');
});

test('worker waiting for a host precondition: reason, attempt and next check', () => {
  const wait = {state: 'waiting_precondition', code: 'twin_status_unknown', attempt: 3, next_check_at: '2026-11-07T10:15:00+00:00'};
  const model = waitingModel({id: 'w1', precondition_wait: wait}, Date.parse('2026-11-07T10:11:00+00:00'));
  assert.match(model.headline, /Wartet auf Voraussetzung/);
  assert.match(model.headline, /Sperrstatus/);
  assert.match(model.detail, /Versuch 3/);
  assert.match(model.detail, /in 4 min/);
  assert.match(waitingModel({precondition_wait: wait}, Date.parse('2026-11-07T10:20:00+00:00')).detail, /fällig/);
  assert.equal(waitingModel({}, 0), null);
  assert.equal(waitingModel({precondition_wait: {...wait, state: 'x'}}, 0), null);
});

test('terminal reasons of the last provider request read as sentences; a completed answer is no abort', () => {
  assert.match(terminalReasonText('total_deadline'), /Zeitlimit/);
  assert.match(terminalReasonText('httpx_read_timeout'), /nicht geantwortet/);
  assert.match(terminalReasonText('worker_stop'), /gestoppt/);
  assert.equal(terminalReasonText('response_completed'), '');
  assert.equal(terminalReasonText(null), '');
  assert.match(terminalReasonText('unbekannt_neu'), /unbekannt_neu/);
});

test('task returns are read in batches of 200 and malformed entries are dropped', async () => {
  const urls = [];
  const ids = Array.from({length: 450}, (_, i) => i + 1);
  const fetcher = async url => {
    urls.push(url);
    const requested = new URL(url, 'http://x').searchParams.get('ids').split(',');
    return reply({tasks: Object.fromEntries(requested.map(id => [id, id === '5' ? {available: true, return_count: 'x'} : summary()]))});
  };
  const {byId, error} = await loadTaskReturns(ids, fetcher);
  assert.equal(error, null);
  assert.equal(urls.length, 3);
  assert.ok(urls.every(url => url.startsWith('/api/task-returns?ids=')));
  assert.equal(byId.size, 449);
  assert.equal(byId.has(5), false);
  assert.equal(byId.get(7).return_count, 3);
});

test('task returns: backend failure is reported, not hidden; no ids means no call', async () => {
  assert.deepEqual((await loadTaskReturns([], async () => { throw new Error('nie'); })).byId.size, 0);
  const failed = await loadTaskReturns([1], async () => ({ok: false, status: 503}));
  assert.equal(failed.byId.size, 0);
  assert.match(failed.error, /503/);
  const thrown = await loadTaskReturns([1], async () => { throw new Error('offline'); });
  assert.match(thrown.error, /nicht verfügbar/);
});

test('timeline request carries window, limit and task; the schema is checked', async () => {
  const calls = [];
  const body = {schema: 'bach.task-return-timeline.v1', hours: 168, total: 1, truncated: false, by_reason: {a: 1},
    events: [{task_id: 4, task_title: 'T', at: '2026-11-07T08:00:00.000000', worker: 'worker-aa@H', reason: 'a', outcome: 'return'}]};
  const fetcher = async url => { calls.push(url); return reply(body); };
  const result = await loadReturnTimeline({hours: 168, taskId: 4}, fetcher);
  assert.equal(calls[0], '/api/task-returns/timeline?hours=168&limit=200&task_id=4');
  assert.equal(result.events.length, 1);
  await assert.rejects(loadReturnTimeline({hours: 24}, async () => reply({...body, schema: 'anders'})), /nicht bestätigt/);
  await assert.rejects(loadReturnTimeline({hours: 24}, async () => reply({...body, events: [{task_id: 'x'}]})), /nicht bestätigt/);
  await assert.rejects(loadReturnTimeline({hours: 3}, fetcher), /Zeitfenster/);
  assert.deepEqual(WINDOWS.map(w => w.hours), [24, 168, 720]);
});

test('timeline filters by worker and reason and lists the choices', () => {
  const events = [
    {task_id: 1, worker: 'worker-aa@H', reason: 'x', at: 'a'}, {task_id: 2, worker: 'worker-bb@H', reason: 'x', at: 'b'},
    {task_id: 3, worker: 'worker-aa@H', reason: 'y', at: 'c'}];
  assert.deepEqual(filterEvents(events, {worker: 'worker-aa@H'}).map(e => e.task_id), [1, 3]);
  assert.deepEqual(filterEvents(events, {worker: 'worker-aa@H', reason: 'y'}).map(e => e.task_id), [3]);
  assert.equal(filterEvents(events, {}).length, 3);
  assert.deepEqual(optionsOf(events, 'worker'), ['worker-aa@H', 'worker-bb@H']);
  assert.deepEqual(optionsOf(events, 'reason'), ['x', 'y']);
});

test('a worker session is marked when its worker returned tasks in the window, with a count and reason', () => {
  const events = [
    {task_id: 1, worker: 'worker-9e4c@HOST', reason: 'host_precondition:twin_status_unknown'},
    {task_id: 2, worker: 'worker-9e4c@HOST', reason: 'host_precondition:twin_status_unknown'},
    {task_id: 3, worker: 'worker-ffff@HOST', reason: 'task_scope_unavailable'}];
  const marker = sessionReturnMarker({chat_id: 'worker-9e4c', source: 'worker'}, events, 24);
  assert.equal(marker.count, 2);
  assert.match(marker.label, /2 Rückgaben in 24 Stunden/);
  assert.equal(marker.reason.scope, 'host');
  assert.equal(marker.worker, 'worker-9e4c@HOST');
  assert.equal(sessionReturnMarker({chat_id: 'worker-0000', source: 'worker'}, events, 24), null);
  assert.equal(sessionReturnMarker({chat_id: '12345', source: 'user'}, events, 24), null, 'a user chat is never matched');
  assert.equal(sessionReturnMarker({chat_id: 'worker-9e4c', source: 'worker'}, [], 24), null);
});
