import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ApiError, failureOf, parsePromptList, parsePromptDetail, createPromptClient, storeChatDraft, createLatest, createDebouncer, listState,
  emptyToNull, DRAFT_KEY, MAX_DRAFT_LENGTH} from '../src/lib/prompt-library.mjs';

const json = (status, body) => ({ok: status < 400, status, json: async () => body});
const listBody = () => ({prompts: [
  {id: 7, name: '42', category: 'Recherche', purpose: 'Zweck', tags: 'a, b', created_at: '2026-10-10T10:00:00', updated_at: null},
  {id: 3, name: 'Alpha', category: null, purpose: null, tags: null, created_at: null, updated_at: null}], categories: ['Recherche']});
const detailBody = () => ({prompt: {id: 7, name: '42', text: 'Hallo', category: 'Recherche', purpose: null, tags: 'a, b', created_at: null, updated_at: null},
  versions: [{id: 1, version_number: 2, text: 'alt', tags: null, created_at: '2026-10-09T00:00:00'}]});
function recorder(responder) {
  const calls = [];
  const fetcher = async (url, options = {}) => { calls.push({url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined}); return responder(url, options); };
  return {fetcher, calls};
}

test('failures are classified into separate kinds', () => {
  assert.equal(failureOf(0).kind, 'network');
  assert.equal(failureOf(401).kind, 'auth');
  assert.equal(failureOf(403).kind, 'auth');
  assert.equal(failureOf(404).kind, 'notfound');
  assert.equal(failureOf(409).kind, 'conflict');
  assert.equal(failureOf(400).kind, 'invalid');
  assert.equal(failureOf(422).kind, 'invalid');
  assert.equal(failureOf(503).kind, 'unavailable');
  assert.equal(failureOf(500).kind, 'server');
  assert.equal(failureOf(409, {detail: 'Name existiert bereits: x'}).detail, 'Name existiert bereits: x');
});

test('the list parser keeps ids as API integers and rejects contract violations', () => {
  const parsed = parsePromptList(listBody());
  assert.deepEqual(parsed.prompts.map(p => p.id), [7, 3]);
  assert.equal(parsed.prompts[0].name, '42'); // a numeric-looking name is still just a name
  assert.deepEqual(parsed.categories, ['Recherche']);
  const bad = mutate => () => { const b = listBody(); mutate(b); parsePromptList(b); };
  assert.throws(bad(b => { b.prompts[0].id = '7'; }), /positive Ganzzahl/);
  assert.throws(bad(b => { b.prompts[0].id = 0; }), /positive Ganzzahl/);
  assert.throws(bad(b => { b.prompts[1].id = 7; }), /doppelte/);
  assert.throws(bad(b => { b.prompts[0].name = ''; }), /Name/);
  assert.throws(bad(b => { delete b.categories; }), /fehlen/);
  assert.throws(bad(b => { b.categories = [1]; }), /Kategorie/);
  assert.throws(bad(b => { b.prompts[0].tags = 5; }), /tags/);
});

test('the detail parser requires text and numbered versions', () => {
  const d = parsePromptDetail(detailBody());
  assert.equal(d.prompt.id, 7);
  assert.equal(d.versions[0].versionNumber, 2);
  const bad = mutate => () => { const b = detailBody(); mutate(b); parsePromptDetail(b); };
  assert.throws(bad(b => { delete b.prompt.text; }), /Text/);
  assert.throws(bad(b => { b.versions[0].version_number = 0; }), /version_number/);
  assert.throws(bad(b => { b.versions = null; }), /fehlen/);
});

test('list: query only carries non-empty filters and the result is validated', async () => {
  const {fetcher, calls} = recorder(() => json(200, listBody()));
  const client = createPromptClient(fetcher);
  await client.list();
  await client.list({q: '  ', category: ''});
  await client.list({q: ' suche ', category: 'Recherche'});
  assert.deepEqual(calls.map(c => c.url), ['/api/prompt-library', '/api/prompt-library', '/api/prompt-library?q=suche&category=Recherche']);
});

test('get/update/remove only accept integer ids and never touch the network otherwise', async () => {
  const {fetcher, calls} = recorder(() => json(200, detailBody()));
  const client = createPromptClient(fetcher);
  for (const bad of ['7', '../etc', 0, -1, 1.5, null, undefined, 'Alpha']) {
    await assert.rejects(client.get(bad), e => e instanceof ApiError && e.kind === 'invalid');
    await assert.rejects(client.update(bad, {text: 'x'}), e => e.kind === 'invalid');
    await assert.rejects(client.remove(bad), e => e.kind === 'invalid');
  }
  assert.equal(calls.length, 0);
  await client.get(7);
  assert.equal(calls[0].url, '/api/prompt-library/7');
});

test('create validates locally, sends null for empty optional fields and returns the id from the API', async () => {
  const {fetcher, calls} = recorder(() => json(200, {ok: true, id: 12}));
  const client = createPromptClient(fetcher);
  await assert.rejects(client.create({name: '  ', text: 'x'}), e => e.kind === 'invalid');
  await assert.rejects(client.create({name: 'n', text: '   '}), e => e.kind === 'invalid');
  assert.equal(calls.length, 0);
  assert.equal(await client.create({name: ' Neu ', text: 'Text', category: ' ', purpose: '', tags: 'x'}), 12);
  assert.deepEqual(calls[0].body, {name: 'Neu', text: 'Text', category: null, purpose: null, tags: 'x'});
  const bad = createPromptClient(recorder(() => json(200, {ok: true, id: 'abc'})).fetcher);
  await assert.rejects(bad.create({name: 'n', text: 't'}), e => e.kind === 'contract');
});

test('HTTP errors keep their kind and server detail; 409 means the name exists', async () => {
  const conflict = createPromptClient(recorder(() => json(409, {detail: 'Name existiert bereits: Neu'})).fetcher);
  await assert.rejects(conflict.create({name: 'Neu', text: 't'}), e => e.kind === 'conflict' && /existiert bereits/.test(e.message));
  const missing = createPromptClient(recorder(() => json(404, {detail: 'Prompt nicht gefunden'})).fetcher);
  await assert.rejects(missing.get(99), e => e.kind === 'notfound' && e.status === 404);
  const auth = createPromptClient(recorder(() => json(401, {error: 'Geräteanmeldung erforderlich'})).fetcher);
  await assert.rejects(auth.list(), e => e.kind === 'auth');
  const down = createPromptClient(recorder(() => json(503, {detail: 'BACH-DB nicht gefunden'})).fetcher);
  await assert.rejects(down.list(), e => e.kind === 'unavailable' && /BACH-DB/.test(e.message));
  const broken = createPromptClient(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(broken.list(), e => e.kind === 'network');
});

test('a non-JSON or malformed success response is a contract error, not an empty library', async () => {
  const noJson = createPromptClient(async () => ({ok: true, status: 200, json: async () => { throw new SyntaxError('x'); }}));
  await assert.rejects(noJson.list(), e => e.kind === 'contract');
  const wrong = createPromptClient(recorder(() => json(200, {prompts: 'none'})).fetcher);
  await assert.rejects(wrong.list(), e => e.kind === 'contract');
});

test('update archives a version and returns its number; import reports the counts', async () => {
  const {fetcher, calls} = recorder(url => (url.endsWith('/import-promptboard') ? json(200, {imported: 3, skipped: 1, invalid: 0, source: 'library.json'}) : json(200, {ok: true, archived_version: 4})));
  const client = createPromptClient(fetcher);
  assert.deepEqual(await client.update(7, {text: 'neu', tags: ' '}), {archivedVersion: 4});
  assert.deepEqual(calls[0].body, {text: 'neu', tags: null});
  await assert.rejects(client.update(7, {text: ' '}), e => e.kind === 'invalid');
  assert.deepEqual(await client.importPromptBoard(), {imported: 3, skipped: 1, invalid: 0, source: 'library.json'});
  const bad = createPromptClient(recorder(() => json(200, {ok: true})).fetcher);
  await assert.rejects(bad.update(7, {text: 'x'}), e => e.kind === 'contract');
});

test('chat draft: same key and payload as BachChatDraft, size-limited, empty refused', () => {
  const store = new Map();
  const storage = {setItem: (k, v) => store.set(k, v), getItem: k => store.get(k) ?? null};
  storeChatDraft('Hallo Welt', storage);
  const payload = JSON.parse(store.get('bach.chat.draft.v1'));
  assert.equal(DRAFT_KEY, 'bach.chat.draft.v1');
  assert.equal(payload.text, 'Hallo Welt');
  assert.equal(typeof payload.createdAt, 'number');
  assert.throws(() => storeChatDraft('   ', storage), TypeError);
  assert.throws(() => storeChatDraft(5, storage), TypeError);
  assert.throws(() => storeChatDraft('x'.repeat(MAX_DRAFT_LENGTH + 1), storage), RangeError);
  storeChatDraft('x'.repeat(MAX_DRAFT_LENGTH), storage);
});

test('latest wins: an older response is never current', () => {
  const latest = createLatest();
  const first = latest.next();
  const second = latest.next();
  assert.equal(latest.isCurrent(first), false);
  assert.equal(latest.isCurrent(second), true);
});

test('debouncer collapses bursts into one call and can be cancelled', () => {
  const pending = new Map(); let id = 0; const fired = [];
  const timers = {setTimeout: (fn, ms) => { pending.set(++id, {fn, ms}); return id; }, clearTimeout: h => pending.delete(h)};
  const d = createDebouncer(v => fired.push(v), 300, timers);
  d.call('a'); d.call('b'); d.call('c');
  assert.equal(pending.size, 1);
  [...pending.values()][0].fn();
  assert.deepEqual(fired, ['c']);
  d.call('x'); d.cancel();
  assert.equal(pending.size, 0);
});

test('the list state separates loading, error kinds, empty store and empty filter result', () => {
  const base = {loading: false, error: null, prompts: [], filtered: false};
  assert.equal(listState({...base, loading: true}), 'loading');
  assert.equal(listState({...base, error: {kind: 'auth'}}), 'error:auth');
  assert.equal(listState({...base, error: {kind: 'unavailable'}}), 'error:unavailable');
  assert.equal(listState(base), 'empty');
  assert.equal(listState({...base, filtered: true}), 'no-match');
  assert.equal(listState({...base, prompts: [{id: 1}]}), 'list');
  assert.equal(emptyToNull('  '), null);
  assert.equal(emptyToNull(' x '), 'x');
});

test('the UI never writes API text through innerHTML or inline handlers and only calls the library client', () => {
  for (const file of ['../src/lib/prompt-library-ui.mjs', '../src/components/PromptLibrary.astro', '../src/pages/prompt-library.astro']) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /innerHTML|outerHTML|insertAdjacentHTML|set:html|<iframe|document\.write|\son[a-z]+\s*=/, file);
  }
  const ui = readFileSync(new URL('../src/lib/prompt-library-ui.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /fetch\(/); // all requests go through prompt-library.mjs
  assert.match(ui, /Das ist ein Fehler, kein leerer Bestand/);
});
