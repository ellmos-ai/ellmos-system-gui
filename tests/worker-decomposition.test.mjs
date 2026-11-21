import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../src/pages/agenten/running.astro', import.meta.url), 'utf8');
const start = page.indexOf('async function runWorkerAction(');
const end = page.indexOf('async function deleteWorker(', start);
const source = page.slice(start, end).trim();

function actionHarness(state, ok = true, respond = null) {
  const summary = {textContent: ''};
  const feedback = {textContent: ''};
  const calls = [];
  let refreshes = 0;
  const run = vm.runInNewContext(`(${source})`, {
    workerRefreshEpoch: 0,
    workerActionEpoch: 0,
    document: {getElementById: (id) => id === 'worker-action-feedback' ? feedback : summary},
    fetch: async (url, options) => {
      calls.push({url, body: JSON.parse(options.body)});
      if (respond) return respond(url);
      return {ok, json: async () => ({ok, receipt: {state}, detail: ok ? undefined : 'Auftrag geändert'})};
    },
    loadBackgroundWorkers: async () => {
      refreshes++;
      summary.textContent = 'Workerstatus aktualisiert';
    },
  });
  return {run, feedback, summary, calls, refreshes: () => refreshes};
}

test('decomposition sends the visible generation and exact task content version', async () => {
  const h = actionHarness('pending');
  await h.run('worker-1', 'decompose', 'a'.repeat(32), {task_id: 42, task_version: 'b'.repeat(64)});
  assert.deepEqual(h.calls, [{url: '/api/system/workers/worker-1/decompose',
    body: {generation: 'a'.repeat(32), task_id: 42, task_version: 'b'.repeat(64)}}]);
  assert.match(h.feedback.textContent, /angefordert/);
  assert.doesNotMatch(h.feedback.textContent, /durch den Lead bestätigt/);
  assert.equal(h.refreshes(), 1);
});

test('only an actual confirmed receipt displays a successful decomposition', async () => {
  const h = actionHarness('confirmed');
  await h.run('worker-1', 'decompose', 'a'.repeat(32), {task_id: 42, task_version: 'b'.repeat(64)});
  assert.equal(h.feedback.textContent, 'Teilaufgabenanlage durch den Lead bestätigt.');
});

for (const [state, message] of [['error', 'ohne bestätigte Teilaufgaben'], ['cancelled', 'abgebrochen']]) {
  test(`terminal ${state} receipt is visible without success text`, async () => {
    const h = actionHarness(state);
    await h.run('worker-1', 'decompose', 'a'.repeat(32), {task_id: 42, task_version: 'b'.repeat(64)});
    assert.match(h.feedback.textContent, new RegExp(message));
    assert.doesNotMatch(h.feedback.textContent, /durch den Lead bestätigt/);
  });
}

test('a stale request error refreshes status without retrying the mutation', async () => {
  const h = actionHarness(undefined, false);
  await h.run('worker-1', 'decompose', 'a'.repeat(32), {task_id: 42, task_version: 'b'.repeat(64)});
  assert.equal(h.calls.length, 1);
  assert.equal(h.feedback.textContent, 'Auftrag geändert');
  assert.equal(h.summary.textContent, 'Workerstatus aktualisiert');
  assert.equal(h.refreshes(), 1);
});

test('unsupported actions never start a provider', async () => {
  const h = actionHarness('pending');
  await h.run('worker-1', 'delegate', 'a'.repeat(32));
  assert.equal(h.calls.length, 0);
});

test('a late action response cannot replace the latest user feedback', async () => {
  let completeEarlier;
  const earlierResponse = new Promise(resolve => {completeEarlier = resolve;});
  const h = actionHarness(undefined, true, (url) => url.endsWith('/start')
    ? earlierResponse : {ok: false, json: async () => ({detail: 'Pausieren nicht bestätigt'})});
  const earlier = h.run('worker-1', 'start');
  await h.run('worker-2', 'pause');
  completeEarlier({ok: true, json: async () => ({ok: true})});
  await earlier;
  assert.equal(h.feedback.textContent, 'Pausieren nicht bestätigt');
  assert.equal(h.summary.textContent, 'Workerstatus aktualisiert');
  assert.equal(h.refreshes(), 2);
});
