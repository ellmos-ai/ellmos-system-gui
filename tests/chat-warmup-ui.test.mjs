import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sendChatMessage, ChatSendError, describeSendError} from '../src/lib/chat-client.mjs';

const response = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
const originalFetch = globalThis.fetch;
for (const agentId of [undefined, 7]) {
  test('readiness and POST keep exactly the same target, agent=' + agentId, async () => {
    const chatId = (agentId ? 'agent:' + agentId + ':' : '') + 'slot:buddha_chat:' + 'a'.repeat(32);
    const calls = [], observations = [];
    globalThis.fetch = async (url, options) => {
      calls.push({url, options});
      return options?.method === 'POST' ? response({ok: true, answer: 'Antwort'}) :
        response({available: true, load_required: true, readiness_state: 'startable', status: 'Startbar'});
    };
    try {
      assert.equal(await sendChatMessage('Hallo', chatId, {agentId, onReadiness: value => observations.push(value)}), 'Antwort');
      assert.equal(calls.length, 2);
      const probe = new URL(calls[0].url, 'https://gui.example.test');
      assert.equal(probe.pathname, '/api/chat-control/readiness');
      assert.equal(probe.searchParams.get('chat_id'), chatId);
      assert.equal(probe.searchParams.get('agent_id'), agentId ? String(agentId) : null);
      const body = JSON.parse(calls[1].options.body);
      assert.equal(body.chat_id, chatId);
      assert.equal(body.agent_id, agentId);
      assert.equal(observations[0].load_required, true);
    } finally { globalThis.fetch = originalFetch; }
  });
}
test('a failed optional readiness probe cannot replace the authoritative POST error', async () => {
  let posts = 0;
  globalThis.fetch = async (url, options) => {
    if (options?.method !== 'POST') throw new TypeError('probe unavailable');
    posts++; return response({error: 'Ressourcen blockiert'}, 503);
  };
  try {
    await assert.rejects(sendChatMessage('Hallo', 'gui-web', {onReadiness() {}}), error =>
      error instanceof ChatSendError && error.status === 503 && error.reason === 'Ressourcen blockiert');
    assert.equal(posts, 1);
  } finally { globalThis.fetch = originalFetch; }
});

function pageHarness({fail = false, changeDraft = false} = {}) {
  const page = readFileSync(new URL('../src/scripts/chat-page.mjs', import.meta.url), 'utf8');
  const start = page.indexOf('  // ---- sending'), end = page.indexOf('  // ---- controls', start);
  const statuses = [], handlers = {}, targets = [], bubbles = [];
  const input = {value: 'Mein Auftrag', disabled: false, addEventListener() {}};
  const state = {chatId: 'slot:buddha_chat:' + 'b'.repeat(32), slot: 'buddha_chat'};
  const scope = {
    state, input, sendBtn: {disabled: false}, log: {querySelector() {}},
    form: {addEventListener(event, fn) {handlers[event] = fn;}},
    setStatus: text => statuses.push(text), refreshList() {},
    node: () => ({addEventListener() {}}),
    bubble: (...values) => {bubbles.push(values); return {setAttribute() {}};},
    ChatSendError, describeSendError,
    sendChatMessage: async (text, chatId, options) => {
      targets.push(chatId);
      assert.equal(typeof options?.onReadiness, 'function');
      options.onReadiness({available: true, load_required: true, readiness_state: 'startable'});
      if (changeDraft) input.value = 'Neuer Entwurf';
      if (fail) throw new ChatSendError('http', 503, 'Warmup nicht zugelassen');
      return 'Antwort';
    },
  };
  vm.runInNewContext(page.slice(start, end), scope);
  return {input, state, targets, statuses, bubbles, submit: () => handlers.submit({preventDefault() {}})};
}
test('main chat shows a conditional start hint and keeps a failed draft with the POST reason', async () => {
  const h = pageHarness({fail: true});
  await h.submit();
  assert.equal(h.input.value, 'Mein Auftrag');
  assert.ok(h.statuses.some(text => /wird gestartet/.test(text)));
  assert.ok(h.bubbles.some(values => String(values[2]).includes('Warmup nicht zugelassen')));
});
test('main chat clears confirmed input but preserves a new draft typed during await', async () => {
  for (const changeDraft of [false, true]) {
    const h = pageHarness({changeDraft});
    await h.submit();
    assert.equal(h.input.value, changeDraft ? 'Neuer Entwurf' : '');
  }
});
