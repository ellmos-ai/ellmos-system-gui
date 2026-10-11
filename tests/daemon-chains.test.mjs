import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ApiError, failureOf, parseSteps, stepSummary, argsText, argsEditText, maxRunId, hasNewRun, pollForNewRun, saveChain, collectSteps, rowsFromSteps, parseChainList, parseRuns, createChainClient, durationText,
  listState, createLatest, TRIGGER_TYPES} from '../src/lib/daemon-chains.mjs';

const json = (status, body) => ({ok: status < 400, status, json: async () => body});
const chainRow = (over = {}) => ({id: 4, name: 'nightly', description: null, trigger_type: 'manual', trigger_value: null,
  steps_json: JSON.stringify([{tool: 'scan', args: ['run', '--quick']}, {parallel: true, tools: [{tool: 'a'}, {tool: 'b'}]}]), is_active: 1, last_run: null, created_at: null, ...over});
function recorder(responder) {
  const calls = [];
  return {calls, fetcher: async (url, options = {}) => { calls.push({url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined}); return responder(url, options); }};
}

test('failures are classified into separate kinds', () => {
  for (const [status, kind] of [[0, 'network'], [401, 'auth'], [403, 'auth'], [404, 'notfound'], [400, 'invalid'], [422, 'invalid'], [503, 'unavailable'], [500, 'server']])
    assert.equal(failureOf(status).kind, kind, String(status));
  assert.equal(failureOf(400, {detail: 'Ungueltiges JSON in steps_json'}).detail, 'Ungueltiges JSON in steps_json');
});

test('steps: unreadable text is reported, never replaced by an empty list; summaries cover parallel steps', () => {
  assert.match(parseSteps('{nope').error, /kein gültiges JSON/);
  assert.match(parseSteps('{"a":1}').error, /keine Liste/);
  assert.match(parseSteps('[1]').error, /keine Liste/);
  assert.deepEqual(parseSteps('[]'), {steps: [], error: null});
  const {steps} = parseSteps(chainRow().steps_json);
  assert.equal(stepSummary(steps[0]), 'scan run --quick');
  assert.equal(stepSummary(steps[1]), '[PARALLEL] 2 Tasks: a, b');
  assert.equal(argsText({args: 'x y'}), 'x y');
  assert.equal(argsText({}), '');
});

test('editing keeps parallel steps and unknown keys; rows without a tool are dropped; args split on whitespace', () => {
  const original = [{tool: 'scan', args: ['a'], on_failure: 'continue'}, {parallel: true, tools: [{tool: 'x'}]}];
  const rows = rowsFromSteps(original);
  assert.equal(rows[1].parallel, true);
  assert.deepEqual(collectSteps(rows), original); // untouched rows round-trip exactly
  rows[0].tool = ' newtool ';
  rows[0].args = '["run", "--mode", "quick"]';
  rows.push({original: null, parallel: false, tool: '  ', args: 'ignored'}, {original: null, parallel: false, tool: 'task', args: '[]'});
  assert.deepEqual(collectSteps(rows), [
    {tool: 'newtool', args: ['run', '--mode', 'quick'], on_failure: 'continue'},
    {parallel: true, tools: [{tool: 'x'}]},
    {tool: 'task', args: []},
  ]);
});

test('argument boundaries survive: a name-only save keeps ["hello world", "a\"b"] exactly; edits must be a JSON array of strings', () => {
  const original = [{tool: 'scan', args: ['hello world', 'a"b']}, {tool: 'x', args: 'one string'}, {tool: 'y'}];
  const rows = rowsFromSteps(original);
  assert.equal(rows[0].args, JSON.stringify(['hello world', 'a"b']));
  assert.deepEqual(collectSteps(rows), original);
  rows[0].args = JSON.stringify(['hello world', 'a"b', 'c d']);
  assert.deepEqual(collectSteps(rows)[0].args, ['hello world', 'a"b', 'c d']);
  for (const bad of ['hello world', '{"a":1}', '[1]', '["ok", 2]'])
    assert.throws(() => collectSteps([{original: null, parallel: false, tool: 't', args: bad}]), e => e.kind === 'invalid', bad);
});

test('unreadable steps_json: a metadata-only update does not send steps_json (stored raw value stays); replacing sends the new steps', async () => {
  const {fetcher, calls} = recorder(() => json(200, {status: 'updated', id: 9}));
  const client = createChainClient(fetcher);
  const chain = parseChainList({chains: [chainRow({id: 9, steps_json: 'kaputt'})]})[0];
  assert.ok(chain.stepsError);
  await client.update(9, {name: 'Neuer Name', description: 'd', triggerType: 'manual', triggerValue: '', steps: undefined});
  assert.ok(!('steps_json' in calls[0].body));
  assert.equal(calls[0].body.name, 'Neuer Name');
  await client.update(9, {name: 'n', description: '', triggerType: 'manual', triggerValue: '', steps: [{tool: 'a', args: []}]});
  assert.equal(calls[1].body.steps_json, '[{"tool":"a","args":[]}]');
  await assert.rejects(client.update(9, {name: 'n', triggerType: 'manual', steps: []}), e => e.kind === 'invalid');
  await assert.rejects(client.create({name: 'n', triggerType: 'manual'}), e => e.kind === 'invalid');
});

test('history detection uses the highest known run id, not the list length (capped at 10)', () => {
  const ten = Array.from({length: 10}, (_, i) => ({id: 100 - i}));
  assert.equal(maxRunId(ten), 100);
  assert.equal(hasNewRun(ten, 100), false);
  const afterNew = [{id: 101}, ...ten.slice(0, 9)];
  assert.equal(afterNew.length, ten.length);
  assert.equal(hasNewRun(afterNew, maxRunId(ten)), true);
  assert.equal(maxRunId([]), 0);
  assert.equal(hasNewRun([{id: 1}], 0), true);
});

test('the list parser keeps ids as API integers and rejects contract violations', () => {
  const chains = parseChainList({chains: [chainRow(), chainRow({id: 9, name: '7', is_active: 0, steps_json: 'kaputt'})]});
  assert.deepEqual(chains.map(c => c.id), [4, 9]);
  assert.equal(chains[1].name, '7');
  assert.equal(chains[1].active, false);
  assert.match(chains[1].stepsError, /kein gültiges JSON/);
  assert.equal(chains[0].steps.length, 2);
  const bad = mutate => () => { const b = {chains: [chainRow(), chainRow({id: 5})]}; mutate(b); parseChainList(b); };
  assert.throws(bad(b => { b.chains[0].id = '4'; }), /positive Ganzzahl/);
  assert.throws(bad(b => { b.chains[1].id = 4; }), /doppelte/);
  assert.throws(bad(b => { b.chains[0].name = ''; }), /Name/);
  assert.throws(bad(b => { delete b.chains[0].steps_json; }), /steps_json/);
  assert.throws(bad(b => { b.chains[0].is_active = 'ja'; }), /is_active/);
  assert.throws(() => parseChainList({}), /chains fehlt/);
});

test('runs are parsed with unknowns kept as null', () => {
  const runs = parseRuns({runs: [{id: 1, status: 'success', started_at: '2026-10-10T10:00:00', duration_seconds: 1.04, steps_completed: 1, steps_total: 1, triggered_by: null, log: 'ok'},
    {id: 2, status: 'failed', started_at: null, duration_seconds: null, steps_completed: null, steps_total: null, error: 'boom'}]});
  assert.equal(runs[0].triggeredBy, 'manual');
  assert.equal(durationText(runs[0].duration), '1.0 s');
  assert.equal(durationText(runs[1].duration), 'Dauer unbekannt');
  assert.equal(runs[1].stepsTotal, null);
  assert.throws(() => parseRuns({runs: [{id: 0, status: 'x'}]}), /positive Ganzzahl/);
  assert.throws(() => parseRuns({runs: [{id: 1}]}), /Status/);
});

test('list: a 404 on the LIST means the adapter is unavailable', async () => {
  const client = createChainClient(recorder(() => json(404, {detail: 'Not Found'})).fetcher);
  await assert.rejects(client.list(), e => e.kind === 'unavailable' && /Adapter oder Quelle nicht verfügbar/.test(e.message));
  await assert.rejects(client.toggle(3), e => e.kind === 'notfound');
});

test('ids must be positive integers and never touch the network otherwise', async () => {
  const {fetcher, calls} = recorder(() => json(200, {}));
  const client = createChainClient(fetcher);
  for (const bad of ['4', 0, -1, 1.5, null, undefined, 'nightly']) {
    await assert.rejects(client.toggle(bad), e => e.kind === 'invalid');
    await assert.rejects(client.remove(bad), e => e.kind === 'invalid');
    await assert.rejects(client.run(bad), e => e.kind === 'invalid');
    await assert.rejects(client.runs(bad), e => e.kind === 'invalid');
    await assert.rejects(client.update(bad, {name: 'x', triggerType: 'manual', steps: [{tool: 't'}]}), e => e.kind === 'invalid');
  }
  assert.equal(calls.length, 0);
});

test('create/update validate locally and send the legacy payload (update can clear text fields)', async () => {
  const {fetcher, calls} = recorder((url, o) => (o.method === 'POST' ? json(200, {id: 11, status: 'created'}) : json(200, {status: 'updated', id: 4})));
  const client = createChainClient(fetcher);
  const good = {name: ' Neu ', description: ' ', triggerType: 'time', triggerValue: ' 02:00 ', steps: [{tool: 'scan', args: []}]};
  for (const bad of [{...good, name: '  '}, {...good, triggerType: 'cron'}, {...good, steps: []}, {...good, steps: null}])
    await assert.rejects(client.create(bad), e => e.kind === 'invalid');
  assert.equal(calls.length, 0);
  assert.equal(await client.create(good), 11);
  assert.deepEqual(calls[0].body, {name: 'Neu', description: '', trigger_type: 'time', trigger_value: '02:00', steps_json: '[{"tool":"scan","args":[]}]', is_active: 1});
  assert.equal(await client.update(4, good), 'updated');
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].body.description, ''); // an empty string clears the field; null would leave it unchanged on the server
  assert.ok(!('is_active' in calls[1].body));
  assert.ok(TRIGGER_TYPES.some(t => t.value === 'startup'));
});

test('toggle, run and runs read the API answers strictly', async () => {
  const {fetcher, calls} = recorder(url => (url.endsWith('/toggle') ? json(200, {is_active: false}) : url.endsWith('/run') ? json(200, {status: 'started', chain_id: 4}) : json(200, {runs: []})));
  const client = createChainClient(fetcher);
  assert.equal(await client.toggle(4), false);
  assert.equal(await client.run(4), true);
  assert.deepEqual(await client.runs(4, 5), []);
  assert.equal(calls[2].url, '/api/daemon/chains/4/runs?limit=5');
  await assert.rejects(createChainClient(recorder(() => json(200, {ok: 1})).fetcher).toggle(4), e => e.kind === 'contract');
  await assert.rejects(createChainClient(recorder(() => json(200, {status: 'queued'})).fetcher).run(4), e => e.kind === 'contract');
});

test('HTTP errors keep their kind and the server detail; network and non-JSON are separate', async () => {
  const invalid = createChainClient(recorder(() => json(400, {detail: 'Ungueltiges JSON in steps_json'})).fetcher);
  await assert.rejects(invalid.create({name: 'x', triggerType: 'manual', steps: [{tool: 't'}]}), e => e.kind === 'invalid' && /Ungueltiges JSON/.test(e.message));
  const auth = createChainClient(recorder(() => json(401, {detail: 'Unauthorized'})).fetcher);
  await assert.rejects(auth.list(), e => e.kind === 'auth' && /HTTP 401/.test(e.message));
  const down = createChainClient(recorder(() => json(503, {detail: 'User-DB nicht gefunden'})).fetcher);
  await assert.rejects(down.list(), e => e.kind === 'unavailable' && /User-DB/.test(e.message));
  await assert.rejects(createChainClient(async () => { throw new TypeError('Failed to fetch'); }).list(), e => e.kind === 'network');
  const noJson = createChainClient(async () => ({ok: true, status: 200, json: async () => { throw new SyntaxError('x'); }}));
  await assert.rejects(noJson.list(), e => e.kind === 'contract' && e instanceof ApiError);
});

test('the list state separates loading, error kinds, empty and list; latest wins', () => {
  assert.equal(listState({loading: true, error: null, chains: []}), 'loading');
  assert.equal(listState({loading: false, error: {kind: 'auth'}, chains: []}), 'error:auth');
  assert.equal(listState({loading: false, error: null, chains: []}), 'empty');
  assert.equal(listState({loading: false, error: null, chains: [{}]}), 'list');
  const latest = createLatest();
  const first = latest.next();
  latest.next();
  assert.equal(latest.isCurrent(first), false);
});

test('the UI never writes API text through innerHTML or inline handlers and only calls the chain client', () => {
  for (const file of ['../src/lib/daemon-chains-ui.mjs', '../src/components/DaemonChains.astro', '../src/pages/daemon.astro']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML|set:html|<iframe|document\.write|\son[a-z]+\s*=|\balert\(/, file);
  }
  assert.doesNotMatch(readFileSync(new URL('../src/lib/daemon-chains-ui.mjs', import.meta.url), 'utf8'), /fetch\(/);
});

test('saveChain turns invalid argument JSON into a visible message and sends nothing', async () => {
  const {fetcher, calls} = recorder(() => json(200, {status: 'updated'}));
  const client = createChainClient(fetcher);
  const chain = parseChainList({chains: [chainRow()]})[0];
  const fields = {name: 'n', description: '', triggerType: 'manual', triggerValue: ''};
  const bad = await saveChain(client, chain, fields, [{original: null, parallel: false, tool: 't', args: 'hello world'}], true);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /kein gültiges JSON/);
  assert.equal(calls.length, 0);
  const good = await saveChain(client, chain, fields, [{original: null, parallel: false, tool: 't', args: '["a b"]'}], true);
  assert.deepEqual([good.ok, calls.length, calls[0].body.steps_json], [true, 1, '[{"tool":"t","args":["a b"]}]']);
  const server = await saveChain(createChainClient(recorder(() => json(400, {detail: 'Ungueltiges JSON in steps_json'})).fetcher), chain, fields, rowsFromSteps(chain.steps), true);
  assert.equal(server.ok, false);
  assert.match(server.message, /Ungueltiges JSON/);
});

test('pollForNewRun finds a new run when 10 runs already exist (id based), and reports none/stopped/failure separately', async () => {
  const ten = Array.from({length: 10}, (_, i) => ({id: 100 - i}));
  const afterNew = [{id: 101}, ...ten.slice(0, 9)];
  let reads = 0;
  const wait = async () => {};
  const found = await pollForNewRun(async () => (++reads < 3 ? ten : afterNew), maxRunId(ten), {wait});
  assert.equal(found.status, 'found');
  assert.equal(reads, 3);
  assert.equal(found.runs[0].id, 101);
  assert.equal((await pollForNewRun(async () => ten, 100, {wait, attempts: 3})).status, 'none');
  assert.equal((await pollForNewRun(async () => ten, 100, {wait, active: () => false})).status, 'stopped');
  await assert.rejects(pollForNewRun(async () => { throw new ApiError('server', 'x'); }, 0, {wait}), e => e.kind === 'server');
});
