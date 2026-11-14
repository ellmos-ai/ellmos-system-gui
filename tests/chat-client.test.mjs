import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseChatParams, newChatId, sendChatMessage, describeSendError, forkSession, resumeWorker,
  isProblem, continueMode, ChatSendError} from '../src/lib/chat-client.mjs';
import {loadSessionPage} from '../src/lib/transcript-history.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
const withFetch = async (impl, body) => {
  const old = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => { calls.push({url, options}); return impl(url, options); };
  try { await body(calls); } finally { globalThis.fetch = old; }
};

test('deep links: resume_session, slot_id and agent are read; anything malformed is ignored', () => {
  assert.deepEqual(parseChatParams('?resume_session=12&slot_id=buddha_chat&agent=ticket-master'),
    {resumeSession: 12, slotId: 'buddha_chat', agent: 'ticket-master'});
  assert.deepEqual(parseChatParams(''), {resumeSession: null, slotId: null, agent: null});
  assert.deepEqual(parseChatParams('?resume_session=abc&slot_id=a b&agent=../x'), {resumeSession: null, slotId: null, agent: null});
  assert.equal(parseChatParams('?resume_session=1&resume_session=2').resumeSession, null);
  assert.equal(parseChatParams('?resume_session=0').resumeSession, null);
});

test('a new chat id carries the slot and 32 hex characters', () => {
  const id = newChatId('buddha_chat', new Uint8Array(16).fill(171));
  assert.equal(id, 'slot:buddha_chat:' + 'ab'.repeat(16));
  assert.match(newChatId('buddha_always_on'), /^slot:buddha_always_on:[a-f0-9]{32}$/);
  assert.throws(() => newChatId('bad slot'));
});

test('sending goes to the chat-control route the backend serves and returns the answer', async () => {
  await withFetch(() => json({ok: true, answer: 'Hallo zurück'}), async calls => {
    assert.equal(await sendChatMessage('Hallo', 'slot:buddha_chat:' + 'a'.repeat(32)), 'Hallo zurück');
    assert.equal(calls[0].url, '/api/chat-control/chat');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), {prompt: 'Hallo', chat_id: 'slot:buddha_chat:' + 'a'.repeat(32)});
  });
});

for (const [label, impl, expect] of [
  ['a 504 gateway timeout', () => json({detail: 'Chatdienst nicht erreichbar'}, 504), /504/],
  ['a 503 with a reason', () => json({detail: 'Chatdienst nicht registriert'}, 503), /Chatdienst nicht registriert/],
  ['a backend refusal inside a 200', () => json({ok: false, error: 'Systemsteckplatz ist ausgeschaltet'}), /Systemsteckplatz ist ausgeschaltet/],
  ['a dropped connection', () => { throw new TypeError('Failed to fetch'); }, /Verbindung/],
  ['an aborted request', () => { throw new DOMException('aborted', 'AbortError'); }, /abgebrochen/],
  ['an empty answer', () => json({ok: true, answer: ''}), /Antwort/],
]) {
  test(`${label} becomes an honest error without any queue claim`, async () => {
    await withFetch(impl, async () => {
      await assert.rejects(sendChatMessage('Hallo', 'gui-web'), err => {
        assert.ok(err instanceof ChatSendError);
        const text = describeSendError(err);
        assert.match(text, expect);
        assert.match(text, /nicht gesendet|keine Antwort|Erneut senden/i);
        assert.doesNotMatch(text, /queue/i);
        return true;
      });
    });
  });
}

test('fork and worker resume use the existing routes with the documented bodies', async () => {
  await withFetch(() => json({ok: true, messages_count: 4}), async calls => {
    assert.equal((await forkSession('slot:buddha_chat:' + 'b'.repeat(32), 9)).messages_count, 4);
    assert.equal(calls[0].url, '/api/chat-control/fork');
    assert.deepEqual(JSON.parse(calls[0].options.body), {chat_id: 'slot:buddha_chat:' + 'b'.repeat(32), snapshot_id: 9});
  });
  await withFetch(() => json({ok: true, action: 'resume'}), async calls => {
    await resumeWorker(9, 'worker-7');
    assert.equal(calls[0].url, '/api/agent-history/sessions/9/resume');
    assert.deepEqual(JSON.parse(calls[0].options.body), {worker_id: 'worker-7'});
    await resumeWorker(9, 'worker-7', {prompt: 'Bitte weiter'});
    assert.deepEqual(JSON.parse(calls[1].options.body), {worker_id: 'worker-7', prompt: 'Bitte weiter'});
    await assert.rejects(resumeWorker(9, 'not a worker!'));
  });
});

test('a problem is a failed answer, three or more returns, or flapping', () => {
  assert.equal(isProblem({failed_count: 1}), true);
  assert.equal(isProblem({return_count: 3}), true);
  assert.equal(isProblem({flapping: true}), true);
  assert.equal(isProblem({failed_count: 0, return_count: 2}), false);
  assert.equal(isProblem({}), false);
});

test('only a current user chat continues in place; everything else forks or resumes a worker', () => {
  assert.equal(continueMode({source: 'user', archived: false, chat_id: 'slot:buddha_chat:' + 'a'.repeat(32)}), 'in-place');
  assert.equal(continueMode({source: 'user', archived: true, chat_id: 'gui-web'}), 'fork');
  assert.equal(continueMode({source: 'buddha', archived: false, chat_id: 'buddha_always_on'}), 'fork');
  assert.equal(continueMode({source: 'worker', archived: false, chat_id: 'worker-7'}), 'worker');
  assert.equal(continueMode({source: 'system', archived: false, chat_id: 'control-api-x'}), 'none');
});

test('the history loader sends source and problem filters and rejects a backend that ignores them', async () => {
  const page = (extra = {}) => ({schema: 'bach.chat-sessions.v1', source: 'session_snapshots', snapshot_type: 'chat-transcript.v1',
    context: 'global', agent_id: null, archive: 'all', sessions: [], total: 0, offset: 0, limit: 25, has_more: false,
    save_limits: {max_messages: 40, max_content_chars: 24000}, ...extra});
  await withFetch(() => json(page({source_filter: 'user', problems: true, source_counts: {user: 0, buddha: 0, worker: 0, system: 0}})), async calls => {
    await loadSessionPage({source: 'user', problems: true});
    assert.match(calls[0].url, /archive=all&source=user&problems=true/);
    await assert.rejects(loadSessionPage({source: 'nope'}));
  });
  await withFetch(() => json(page()), async () => {
    await assert.rejects(loadSessionPage({source: 'user'}), /Quelle/);
    await loadSessionPage();
  });
});

test('the chat page no longer claims a queue or calls the invented send route', () => {
  const text = readFileSync(new URL('../src/pages/chat.astro', import.meta.url), 'utf8') +
    readFileSync(new URL('../src/scripts/chat-page.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /\/api\/chat\/send/);
  assert.doesNotMatch(text, /queue/i);
});

test('the history tab starts with my chats and offers the problem filter', () => {
  const page = readFileSync(new URL('../src/pages/agenten/sessions.astro', import.meta.url), 'utf8');
  assert.match(page, /id="history-source"><option value="user">Ich<\/option>/);
  assert.match(page, /id="history-problems" type="checkbox"/);
  const script = readFileSync(new URL('../src/scripts/agent-history.mjs', import.meta.url), 'utf8');
  assert.match(script, /source:sourceFilter\.value,problems:problemsOnly\.checked/);
});
