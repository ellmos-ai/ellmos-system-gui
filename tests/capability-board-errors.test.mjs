import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestJson, describeSourceError} from '../src/lib/capability-board-client.mjs';
import {catalogMatches} from '../src/lib/software-catalog.mjs';
import {plugState} from '../src/lib/plugin-plug-state.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/plugin-inventory-handler.json', import.meta.url), 'utf8')).response;
const reply = (status, body, {json = true} = {}) => ({ok: status < 400, status, json: async () => {
  if (!json) throw new SyntaxError('Unexpected token < in JSON');
  return body;
}});

test('plugins only accept a plugin inventory (schema and kind), nothing else', () => {
  assert.equal(catalogMatches('plugins', fixture), true);
  assert.equal(catalogMatches('plugins', {...fixture, kind: 'mcp'}), false, 'MCP inventory with items');
  assert.equal(catalogMatches('plugins', {...fixture, schema: 'other.v1'}), false);
  assert.equal(catalogMatches('plugins', {...fixture, schema: undefined}), false);
  assert.equal(catalogMatches('plugins', {items: fixture.items}), false, 'bare item list');
  assert.equal(catalogMatches('plugins', null), false);
  assert.equal(catalogMatches('plugins', 'text'), false);
  assert.equal(catalogMatches('plugins', {schema: 'bach.capability-inventory.v1', kind: 'plugins', items: []}), true);
});

test('other boards keep their existing contract', () => {
  assert.equal(catalogMatches('software', {kind: 'software', catalog: 'software-applications'}), true);
  assert.equal(catalogMatches('software', {kind: 'software'}), false);
  assert.equal(catalogMatches('ocean', {kind: 'ocean', catalog: 'ocean-host-sources'}), true);
  assert.equal(catalogMatches('ocean', {kind: 'plugins'}), false);
  for (const kind of ['skills', 'mcp']) assert.equal(catalogMatches(kind, {anything: 1}), true, kind);
});

test('a 401 without detail keeps its status and is shown as missing sign-in', async () => {
  const error = await requestJson('/x', {}, async () => reply(401, {})).catch(e => e);
  assert.equal(error.status, 401);
  assert.match(describeSourceError(error), /Nicht angemeldet \(HTTP 401\)/);
});

test('a 503 without detail keeps its status and is shown as unavailable source', async () => {
  const error = await requestJson('/x', {}, async () => reply(503, {})).catch(e => e);
  assert.equal(error.status, 503);
  assert.match(describeSourceError(error), /Quelle nicht verfügbar \(HTTP 503\)/);
});

test('an unreadable (non-JSON) error body keeps the status code', async () => {
  for (const status of [401, 403, 502, 503]) {
    const error = await requestJson('/x', {}, async () => reply(status, null, {json: false})).catch(e => e);
    assert.equal(error.status, status, String(status));
    assert.match(error.message, /keine lesbare Antwort/);
    assert.ok(describeSourceError(error).includes('HTTP ' + status), String(status));
  }
});

test('401, 403, 503 and other statuses are told apart; the detail from the source is kept', async () => {
  const texts = new Map();
  for (const status of [401, 403, 500, 503]) {
    const error = await requestJson('/x', {}, async () => reply(status, {detail: 'Grund ' + status})).catch(e => e);
    const text = describeSourceError(error);
    assert.ok(text.includes('Grund ' + status), text);
    texts.set(status, text.replace('Grund ' + status, ''));
  }
  assert.equal(new Set(texts.values()).size, 4, 'four different messages');
  assert.match(texts.get(500), /HTTP 500/);
});

test('JSON null as an error body and errors without a status do not crash', async () => {
  const nullBody = await requestJson('/x', {}, async () => reply(503, null)).catch(e => e);
  assert.equal(nullBody.status, 503);
  assert.equal(describeSourceError(new Error('Netzwerkfehler')), 'Netzwerkfehler');
  assert.equal(describeSourceError({status: 'x'}), 'unbekannter Fehler');
  assert.equal(describeSourceError(null), 'unbekannter Fehler');
});

test('409 and success behave as before', async () => {
  const conflict = await requestJson('/x', {}, async () => reply(409, {detail: 'x'})).catch(e => e);
  assert.equal(conflict.status, 409);
  assert.match(conflict.message, /inzwischen geändert/);
  assert.deepEqual(await requestJson('/x', {}, async () => reply(200, {ok: 1})), {ok: 1});
});

test('null is neutral: no claim about the scope and no claim that an entry is missing', () => {
  const info = plugState({consumer: 'Claude', enabled_in_client: null});
  assert.equal(info.state, 'unknown');
  assert.match(info.reason, /Kein boolescher Aktivierungswert im Inventar \(Quelle nicht lesbar, ungültig oder kein Eintrag\)/);
  assert.equal(info.scope, null);
  assert.ok(!/Benutzer-Scope/.test(info.reason));
  assert.match(plugState({consumer: 'Claude', enabled_in_client: true}).scope, /Benutzer-Scope/);
  assert.match(plugState({consumer: 'Codex', enabled_in_client: false}).scope, /Benutzer-Scope/);
});
