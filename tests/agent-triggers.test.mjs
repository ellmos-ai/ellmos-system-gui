import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTriggerClient} from '../src/lib/agent-triggers.mjs';
import {formatTriggerStatus} from '../src/lib/agent-triggers-ui.mjs';
const trigger = (extra = {}) => ({id: 't', agent_id: 'a', version: 1, revision: 1, enabled: false, deleted: false, schedule: {kind: 'daily', time: '09:00', timezone: 'Europe/Berlin'}, ...extra});
const envelope = value => ({schema: 'bach.agent-triggers.v1', provider: 'ellmos-scheduler', source: 'external_scheduler', state: 'available', ...value});
const reply = (value, status = 200) => ({ok: status === 200, status, json: async () => value});
const ack = {configuration_saved: true, readback_verified: true, worker_started: false};

test('a conflict preserves the original CAS and never retries a mutation', async () => {
  const calls = [], snapshot = trigger();
  const client = createTriggerClient(async (url, options) => { calls.push({url, options}); return reply({}, 409); });
  await assert.rejects(client.update(snapshot, {enabled: true}), error => error.state === 'conflict');
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].options.body).expected_version, 1);
  assert.equal(snapshot.enabled, false);
});
test('save requires the requested change and a separate matching GET; property order is irrelevant', async () => {
  const calls = [], saved = trigger({version: 2, enabled: true});
  const client = createTriggerClient(async (url, options) => {
    calls.push(options.method);
    return reply(envelope(options.method === 'GET' ? {trigger: Object.fromEntries(Object.entries(saved).reverse())} : {trigger: saved, ack}));
  });
  assert.equal((await client.update(trigger(), {enabled: true})).enabled, true);
  assert.deepEqual(calls, ['PUT', 'GET']);
});
test('an ACK cannot certify ignored edits, a started worker, or a different readback version', async () => {
  for (const fault of ['ignored', 'started', 'changed']) {
    const saved = trigger({version: 2, enabled: fault !== 'ignored'});
    const client = createTriggerClient(async (_url, options) => reply(envelope(options.method === 'GET'
      ? {trigger: {...saved, version: 3}}
      : {trigger: saved, ack: {...ack, worker_started: fault === 'started'}})));
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
test('running.astro no longer imports AgentTriggers and links to /routinen#startregeln below the page header', () => {
  const running = readFileSync(new URL('../src/pages/agenten/running.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(running, /AgentTriggers/);
  const h1Index = running.indexOf('</h1>');
  const linkIndex = running.indexOf('/routinen#startregeln');
  assert.ok(h1Index > -1 && linkIndex > h1Index, 'link to /routinen#startregeln must appear after the h1 block');
  assert.match(running, /Automatische Startregeln und Zeitpläne für deine Agenten findest du unter\s+<a href="\/routinen#startregeln">Routinen & Jobs<\/a>\./);

  const component = readFileSync(new URL('../src/components/AgentTriggers.astro', import.meta.url), 'utf8');
  assert.match(component, /<section id="startregeln"[^>]*aria-label="Automatische Startregeln & Zeitpläne">/);
  assert.match(component, /<h2>Automatische Startregeln & Zeitpläne<\/h2>/);
  assert.match(component, /Hier legst du fest, nach welchem Zeitplan oder Ereignis ein Agent künftig automatisch angestoßen werden soll – das Speichern einer Regel startet noch keinen Agenten\./);
});
test('trigger status text formats zero, singular and plural rule counts', () => {
  assert.equal(formatTriggerStatus(0), 'Noch keine Startregel gespeichert.');
  assert.equal(formatTriggerStatus(1), '1 Startregel gespeichert.');
  assert.equal(formatTriggerStatus(2), '2 Startregeln gespeichert.');
  assert.equal(formatTriggerStatus(5), '5 Startregeln gespeichert.');
});
