import test from 'node:test';
import assert from 'node:assert/strict';
import {createTriggerClient} from '../src/lib/agent-triggers.mjs';
const trigger = (extra = {}) => ({id: 't', agent_id: 'a', version: 1, revision: 1, enabled: false, deleted: false, schedule: {kind: 'daily', time: '09:00', timezone: 'Europe/Berlin'}, ...extra});
const envelope = value => ({schema: 'bach.agent-triggers.v1', provider: 'ellmos-scheduler', source: 'external_scheduler', state: 'available', ...value});
const reply = (value, status = 200, headers = {}) => ({ok: status === 200, status, headers: new Headers(headers), json: async () => value});
const ack = {configuration_saved: true, readback_verified: true, worker_started: false};

test('a conflict preserves the original CAS and never retries a mutation', async () => {
  const calls = [], snapshot = trigger();
  const client = createTriggerClient(async (url, options) => {
    calls.push({url, options});
    return options.method === 'GET' ? reply(envelope({triggers: []})) : reply({}, 409);
  });
  await assert.rejects(client.update(snapshot, {enabled: true}), error => error.state === 'conflict');
  const writes = calls.filter(call => call.options.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0].options.body).expected_version, 1);
  assert.equal(snapshot.enabled, false);
});
test('save requires the requested change and a separate matching GET; property order is irrelevant', async () => {
  const calls = [], saved = trigger({version: 2, enabled: true});
  const client = createTriggerClient(async (url, options) => {
    calls.push(options.method);
    if (url === '/api/agent-triggers' && options.method === 'GET') return reply(envelope({triggers: []}));
    return reply(envelope(options.method === 'GET' ? {trigger: Object.fromEntries(Object.entries(saved).reverse())} : {trigger: saved, ack}));
  });
  assert.equal((await client.update(trigger(), {enabled: true})).enabled, true);
  assert.deepEqual(calls, ['GET', 'PUT', 'GET']);
});
test('an ACK cannot certify ignored edits, a started worker, or a different readback version', async () => {
  for (const fault of ['ignored', 'started', 'changed']) {
    const saved = trigger({version: 2, enabled: fault !== 'ignored'});
    const client = createTriggerClient(async (url, options) => {
      if (url === '/api/agent-triggers' && options.method === 'GET') return reply(envelope({triggers: []}));
      return reply(envelope(options.method === 'GET'
        ? {trigger: {...saved, version: 3}}
        : {trigger: saved, ack: {...ack, worker_started: fault === 'started'}}));
    });
    await assert.rejects(client.update(trigger(), {enabled: true}));
  }
});
test('unknown providers, duplicate IDs and cross-agent filters are not accepted collections', async () => {
  for (const value of [envelope({provider: 'other', triggers: []}), envelope({triggers: [trigger(), trigger()]}), envelope({triggers: [trigger({agent_id: 'other'})]})]) {
    await assert.rejects(createTriggerClient(async () => reply(value)).list('a'));
  }
});
test('missing device authorization stays distinct from an empty confirmed collection', async () => {
  await assert.rejects(createTriggerClient(async () => reply({}, 401)).list(), error => error.state === 'auth');
  assert.deepEqual(await createTriggerClient(async () => reply(envelope({triggers: []}))).list(), []);
});
test('rejected input remains distinct from an unavailable provider without echoing server data', async () => {
  for (const status of [400, 422]) {
    await assert.rejects(createTriggerClient(async () => reply({detail: 'private-server-data'}, status)).list(),
      error => error.state === 'invalid' && !error.message.includes('private-server-data'));
  }
  await assert.rejects(createTriggerClient(async () => reply({}, 503)).list(), error => error.state === 'unavailable');
});
test('native slash identifiers are encoded as one object identifier and independently matched', async () => {
  for (const id of ['team/weekly', 'team/deliver']) {
    let called;
    const client = createTriggerClient(async (url) => { called = url; return reply(envelope({trigger: trigger({id})})); });
    assert.equal((await client.get(id)).id, id);
    assert.equal(called, '/api/agent-triggers/' + encodeURIComponent(id));
  }
});

const sessionHeaders = {'X-GUI-CSRF-Required': '1', 'X-CSRF-Token': 'synthetic-csrf-value', 'X-GUI-Auth-Mode': 'session'};

test('session host requires a validated collection before first write and sends CSRF only in the write header', async () => {
  const calls = [], saved = trigger({version: 2, enabled: true});
  const client = createTriggerClient(async (url, options) => {
    calls.push({url, options});
    if (url === '/api/agent-triggers') return reply(envelope({triggers: [trigger()]}), 200, sessionHeaders);
    return reply(envelope(options.method === 'GET' ? {trigger: saved} : {trigger: saved, ack}), 200, sessionHeaders);
  });
  assert.equal((await client.update(trigger(), {enabled: true})).version, 2);
  assert.deepEqual(calls.map(call => call.options.method), ['GET', 'PUT', 'GET']);
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'synthetic-csrf-value');
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[2].options.headers, undefined);
  for (const call of calls) {
    assert.equal(call.options.redirect, 'error');
    assert.ok(!call.url.includes('synthetic-csrf-value'));
    assert.ok(!String(call.options.body).includes('synthetic-csrf-value'));
  }
});

test('missing, malformed or noncanonical CSRF metadata prevents a write without echoing its value', async () => {
  for (const headers of [
    {'X-GUI-CSRF-Required': '1'},
    {'X-GUI-CSRF-Required': 'unknown', 'X-CSRF-Token': 'synthetic-csrf-value'},
    {'X-GUI-CSRF-Required': '1', 'X-CSRF-Token': 'x'.repeat(4097)},
  ]) {
    const calls = [];
    const client = createTriggerClient(async (_url, options) => {
      calls.push(options.method); return reply(envelope({triggers: []}), 200, headers);
    });
    await assert.rejects(client.update(trigger(), {enabled: true}), error => error.state === 'unavailable'
      && !error.message.includes('synthetic-csrf-value'));
    assert.deepEqual(calls, ['GET']);
  }
});

test('an invalid initial collection cannot certify transport readiness on a later attempt', async () => {
  const calls = [];
  const client = createTriggerClient(async (_url, options) => {
    calls.push(options.method); return reply(envelope({trigger: trigger()}), 200, sessionHeaders);
  });
  await assert.rejects(client.update(trigger(), {enabled: true}));
  await assert.rejects(client.update(trigger(), {enabled: true}));
  assert.deepEqual(calls, ['GET', 'GET']);
});

test('forbidden session write is not retried and does not expose server or CSRF data', async () => {
  const calls = [];
  const client = createTriggerClient(async (_url, options) => {
    calls.push(options.method);
    return options.method === 'GET' ? reply(envelope({triggers: []}), 200, sessionHeaders)
      : reply({detail: 'private-server-data synthetic-csrf-value'}, 403, sessionHeaders);
  });
  await assert.rejects(client.update(trigger(), {enabled: true}), error => error.state === 'auth'
    && !error.message.includes('private-server-data') && !error.message.includes('synthetic-csrf-value'));
  assert.deepEqual(calls, ['GET', 'PUT']);
});

test('a confirmed CSRF channel cannot silently downgrade during independent readback', async () => {
  const saved = trigger({version: 2, enabled: true});
  const client = createTriggerClient(async (url, options) => {
    if (url === '/api/agent-triggers') return reply(envelope({triggers: []}), 200, sessionHeaders);
    return reply(envelope(options.method === 'GET' ? {trigger: saved} : {trigger: saved, ack}));
  });
  await assert.rejects(client.update(trigger(), {enabled: true}), error => error.state === 'unavailable');
});
