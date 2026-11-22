import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../src/pages/talk.astro', import.meta.url), 'utf8');
const between = (source, begin, end) => source.slice(source.indexOf(begin), source.indexOf(end, source.indexOf(begin)));

function harness(kind, {status = 200, network = false, empty = false, lateReflex = false, editDuringSend = false, holdTurn = false} = {}) {
  const calls = [], rows = [], handlers = {}, notices = [];
  const input = {value: 'Mein Funkspruch'};
  const box = {hidden: false, textContent: ''}, reflexStatus = {textContent: ''};
  let spoken = 0, settleReflex, releaseTurn;
  const scope = {
    quickInput: input, utteranceInput: input, replyBox: box, transcriptBox: box, reflexStatus,
    personaSelect: {value: 'buddha'}, mainModelSelect: {value: 'buddha'},
    quickForm: {addEventListener: (event, handler) => { handlers[event] = handler; }},
    form: {addEventListener: (event, handler) => { handlers[event] = handler; }},
    document: {documentElement: {lang: 'de'}},
    window: {speechSynthesis: {cancel() {}, speak() { spoken++; }}},
    SpeechSynthesisUtterance: function () {},
    applyTalkStateToHeader() {}, applyVisualState() {},
    appendTranscriptEntry: (...row) => rows.push(row),
    playSpokenResponse: async () => { spoken++; },
    fetch: async (url, options) => {
      calls.push({url, options});
      if (url === '/api/talk/reflex') {
        const response = {ok: true, json: async () => ({reflex: {ack_text: 'Wird geprüft.', fast_model: 'synthetic-reflex'}})};
        if (lateReflex) return new Promise(resolve => { settleReflex = () => resolve(response); });
        return response;
      }
      if (url === '/api/voice/tts') return {ok: false};
      assert.equal(url, '/api/talk/turn');
      if (editDuringSend) input.value = 'Inzwischen neuer Entwurf';
      if (network) throw new TypeError('Scoped network failure');
      if (holdTurn) await new Promise(resolve => { releaseTurn = resolve; });
      return {ok: status === 200, status, json: async () =>
        status === 200 ? {spoken_text: empty ? '' : 'Empfangene Antwort.'} : {detail: 'Scoped failure ' + status}};
    },
  };
  const context = vm.createContext(scope);
  if (kind === 'header') {
    vm.runInContext(between(header, '    async function sendHeaderTalkTurn(', '    async function ackHeaderTalkSummon('), context);
    vm.runInContext(between(header, "    quickForm?.addEventListener('submit'", '    async function captureViaLocalStt('), context);
  } else {
    vm.runInContext(between(studio, '      async function sendStudioTurn(', '      cycleBtn?.addEventListener('), context);
  }
  return {input, box, reflexStatus, calls, rows, notices, scope, context,
    spoken: () => spoken, releaseTurn: () => releaseTurn?.(),
    async submit() { await handlers.submit({preventDefault() {}}); },
    async finishReflex() { settleReflex?.(); await new Promise(resolve => setImmediate(resolve)); }};
}

for (const kind of ['header', 'studio']) {
  for (const status of [401, 409, 503]) {
    test(kind + ' shows HTTP ' + status + ' detail and preserves input without speech', async () => {
      const h = harness(kind, {status});
      await h.submit();
      assert.equal(h.input.value, 'Mein Funkspruch');
      assert.match(h.box.textContent, new RegExp('Scoped failure ' + status));
      assert.equal(h.spoken(), 0);
      assert.equal(h.rows.filter(row => row[2] === 'model').length, 0);
      assert.equal(h.calls.filter(call => call.url === '/api/voice/tts').length, 0);
    });
  }
  test(kind + ' keeps a network failure visible even after a late reflex response', async () => {
    const h = harness(kind, {network: true, lateReflex: true});
    await h.submit();
    await h.finishReflex();
    assert.equal(h.input.value, 'Mein Funkspruch');
    assert.match(h.box.textContent, /Scoped network failure/);
    assert.equal(h.spoken(), 0);
  });
  test(kind + ' clears only a confirmed response and uses the same-origin API/auth contract', async () => {
    const h = harness(kind);
    await h.submit();
    assert.equal(h.input.value, '');
    assert.match(h.box.textContent, /Empfangene Antwort/);
    assert.equal(h.spoken(), 1);
    const turn = h.calls.find(call => call.url === '/api/talk/turn');
    assert.equal(turn.options.method, 'POST');
    assert.notEqual(turn.options.credentials, 'omit');
    assert.deepEqual(JSON.parse(turn.options.body), {user_utterance: 'Mein Funkspruch', persona: 'buddha', language: 'de'});
  });
  test(kind + ' leaves a draft edited during the pending turn intact', async () => {
    const h = harness(kind, {editDuringSend: true});
    await h.submit();
    assert.equal(h.input.value, 'Inzwischen neuer Entwurf');
    assert.match(h.box.textContent, /Empfangene Antwort/);
  });
  test(kind + ' prevents duplicate submission of an in-flight turn', async () => {
    const h = harness(kind, {holdTurn: true});
    const first = h.submit();
    await new Promise(resolve => setImmediate(resolve));
    const second = h.submit();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.filter(call => call.url === '/api/talk/turn').length, 1);
    h.releaseTurn();
    await Promise.all([first, second]);
  });
  test(kind + ' treats an empty answer as failure', async () => {
    const h = harness(kind, {empty: true});
    await h.submit();
    assert.equal(h.input.value, 'Mein Funkspruch');
    assert.match(h.box.textContent, /Antwort/);
    assert.equal(h.spoken(), 0);
  });
}

test('Talk labels do not present legacy primary_model as the executing model', () => {
  assert.doesNotMatch(header, /activeModelPill\.textContent\s*=\s*cfg\.primary_model/);
  assert.doesNotMatch(studio, /Verbunden:.*cfg\.primary_model/);
});
