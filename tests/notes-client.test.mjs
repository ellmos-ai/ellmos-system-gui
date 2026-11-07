import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {
  archiveNote, createBody, createNote, describeFailure, listQuery, loadNotes, readNotes, unarchiveNote,
} from '../src/lib/notes-client.mjs';

const root = process.cwd();
const page = file => readFileSync(join(root, 'src', 'pages', file), 'utf8');

const sample = {
  backend: 'llm-note',
  entries: [{id: 3, entry_type: 'logbook', title: 'T', content: 'C', category: 'x', created_at: '2026-02-19 08:00', is_archived: false}],
  count: 1,
  stats: {total: 1, archived: 0, logbook: 1, note: 0},
  categories: [{name: 'x', count: 1}],
};

function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({url: String(url), method: options.method || 'GET', body: options.body});
    return handler(String(url), options);
  };
  return {calls, restore: () => { globalThis.fetch = original; }};
}
const json = (status, data) => ({ok: status < 400, status, json: async () => data});

test('listQuery maps the German filter to llm-note types and keeps the archive switch', () => {
  assert.equal(listQuery({kind: 'all'}).toString(), 'limit=200');
  assert.equal(listQuery({kind: 'gedanken'}).get('entry_type'), 'note');
  assert.equal(listQuery({kind: 'logbuch'}).get('entry_type'), 'logbook');
  assert.equal(listQuery({kind: 'all', search: ' foo '}).get('search'), 'foo');
  assert.equal(listQuery({kind: 'all', includeArchived: true}).get('include_archived'), 'true');
  assert.equal(listQuery({kind: 'all'}).has('include_archived'), false);
});

test('createBody turns the form into the /api/notes payload', () => {
  assert.deepEqual(createBody({kind: 'logbuch', tag: ' Alltag ', title: ' T ', body: ' B '}),
    {entry_type: 'logbook', category: 'Alltag', title: 'T', content: 'B', source: 'web'});
  assert.equal(createBody({kind: 'gedanken', tag: '', title: 'T', body: 'B'}).category, 'note');
  assert.throws(() => createBody({kind: 'gedanken', tag: '', title: '', body: 'B'}), /Titel und Inhalt/);
});

test('readNotes validates the response shape instead of showing an empty list', () => {
  assert.equal(readNotes(sample).entries[0].id, 3);
  assert.throws(() => readNotes({entries: 'nope'}), /ungültig/);
  assert.throws(() => readNotes(null), /ungültig/);
});

test('describeFailure names the status and the backend reason honestly', () => {
  assert.match(describeFailure(503, {detail: 'llm-note nicht verfügbar'}), /503.*llm-note nicht verfügbar/);
  assert.match(describeFailure(503, {reason_code: 'ocean_api_adapter_unbound'}), /ocean_api_adapter_unbound/);
  assert.match(describeFailure(0, null), /nicht erreichbar/);
});

test('loadNotes reads GET /api/notes and fails loudly on HTTP errors', async () => {
  const ok = stubFetch(() => json(200, sample));
  try {
    const data = await loadNotes({kind: 'logbuch'});
    assert.equal(data.entries.length, 1);
    assert.match(ok.calls[0].url, /^\/api\/notes\?/);
    assert.match(ok.calls[0].url, /entry_type=logbook/);
  } finally { ok.restore(); }
  const bad = stubFetch(() => json(503, {detail: 'weg'}));
  try { await assert.rejects(loadNotes({kind: 'all'}), /503.*weg/); } finally { bad.restore(); }
  const down = stubFetch(() => { throw new TypeError('network'); });
  try { await assert.rejects(loadNotes({kind: 'all'}), /nicht erreichbar/); } finally { down.restore(); }
});

test('create, archive and unarchive hit the notes routes with the right methods', async () => {
  const stub = stubFetch(() => json(200, {ok: true, entry: sample.entries[0]}));
  try {
    await createNote({kind: 'gedanken', tag: 't', title: 'T', body: 'B'});
    await archiveNote(7, 'weg');
    await unarchiveNote(7);
  } finally { stub.restore(); }
  assert.deepEqual(stub.calls.map(c => `${c.method} ${c.url}`),
    ['POST /api/notes', 'POST /api/notes/7/archive', 'POST /api/notes/7/unarchive']);
  assert.equal(JSON.parse(stub.calls[1].body).reason, 'weg');
});

test('notizen page no longer uses localStorage or built-in demo notes', () => {
  const notizen = page('notizen.astro');
  assert.doesNotMatch(notizen, /localStorage/);
  assert.doesNotMatch(notizen, /defaultNotes|bach\.notizen\.items/);
  assert.match(notizen, /Archiv einblenden/);
  assert.match(notizen, /notizen-page\.mjs/);
});

test('denkarium is a redirect to the single /notizen route', () => {
  const denkarium = page('denkarium.astro');
  assert.match(denkarium, /\/notizen/);
  assert.match(denkarium, /http-equiv="refresh"/);
  assert.doesNotMatch(denkarium, /LegacyRouteFallback/);
});
