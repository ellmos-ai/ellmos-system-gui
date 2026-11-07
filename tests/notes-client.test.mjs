import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {
  LEGACY_STORAGE_KEY, archiveNote, createBody, createNote, describeFailure, findBrowserNotes, importBrowserNotes,
  listQuery, loadNotes, pendingNotice, readNotes, unarchiveNote,
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

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    has: key => data.has(key),
  };
};
const demo = [
  {id: 'n-1', kind: 'gedanken', tag: 'Fokus & ADHS', title: 'Demo 1', body: 'demo', createdAt: '2026-10-31 09:00'},
  {id: 'n-2', kind: 'logbuch', tag: 'Ocean & BACH', title: 'Demo 2', body: 'demo', createdAt: '2026-10-31 12:30'},
];
const own = [
  {id: 'n-1762500000000', kind: 'logbuch', tag: 'Alltag', title: 'Eigene Notiz', body: 'Text A', createdAt: '2026-11-01 10:00'},
  {id: 'n-1762500000001', kind: 'gedanken', tag: '', title: 'Zweite', body: 'Text B', createdAt: '2026-11-02 11:00'},
];

test('readNotes carries the pending-migration flags from the backend', () => {
  const data = readNotes({...sample, backend: 'denkarium-legacy', pending_migration: true, pending_count: 14});
  assert.deepEqual([data.backend, data.pendingMigration, data.pendingCount], ['denkarium-legacy', true, 14]);
  assert.equal(readNotes(sample).pendingMigration, false);
});

test('pendingNotice explains the migration instead of showing a silent empty list', () => {
  assert.match(pendingNotice({backend: 'denkarium-legacy', pendingMigration: true, pendingCount: 14}), /werden übernommen.*noch im Denkarium/);
  assert.match(pendingNotice({backend: 'llm-note', pendingMigration: true, pendingCount: 2}), /2 Einträge.*Denkarium/);
  assert.equal(pendingNotice({backend: 'llm-note', pendingMigration: false, pendingCount: 0}), '');
});

test('findBrowserNotes ignores the two old demo notes and invalid entries', () => {
  assert.deepEqual(findBrowserNotes(memoryStorage()), []);
  assert.deepEqual(findBrowserNotes(memoryStorage({[LEGACY_STORAGE_KEY]: JSON.stringify(demo)})), []);
  assert.deepEqual(findBrowserNotes(memoryStorage({[LEGACY_STORAGE_KEY]: 'kaputt{'})), []);
  const found = findBrowserNotes(memoryStorage({[LEGACY_STORAGE_KEY]: JSON.stringify([...demo, ...own, {id: 'x', title: '', body: ''}])}));
  assert.deepEqual(found.map(n => n.title), ['Eigene Notiz', 'Zweite']);
});

test('importBrowserNotes posts each note once, then removes the browser key', async () => {
  const storage = memoryStorage({[LEGACY_STORAGE_KEY]: JSON.stringify([...demo, ...own])});
  const stub = stubFetch(() => json(200, {ok: true, entry: {id: 1}}));
  try {
    const result = await importBrowserNotes(storage);
    assert.deepEqual(result, {imported: 2, failed: 0});
  } finally { stub.restore(); }
  assert.deepEqual(stub.calls.map(c => `${c.method} ${c.url}`), ['POST /api/notes', 'POST /api/notes']);
  const bodies = stub.calls.map(c => JSON.parse(c.body));
  assert.deepEqual(bodies.map(b => [b.entry_type, b.category, b.title]), [['logbook', 'Alltag', 'Eigene Notiz'], ['note', 'note', 'Zweite']]);
  assert.equal(storage.has(LEGACY_STORAGE_KEY), false);
});

test('a failed import keeps the key and only the notes that were not imported yet', async () => {
  const storage = memoryStorage({[LEGACY_STORAGE_KEY]: JSON.stringify(own)});
  let n = 0;
  const stub = stubFetch(() => (++n === 1 ? json(200, {ok: true}) : json(503, {detail: 'weg'})));
  try {
    const result = await importBrowserNotes(storage);
    assert.deepEqual(result, {imported: 1, failed: 1});
  } finally { stub.restore(); }
  const left = JSON.parse(storage.getItem(LEGACY_STORAGE_KEY));
  assert.deepEqual(left.map(note => note.title), ['Zweite']);
});

test('the page offers the import by click and never imports on its own', () => {
  const notizen = page('notizen.astro');
  assert.match(notizen, /id="notes-import"/);
  assert.match(notizen, /id="notes-import-button"/);
  assert.match(notizen, /id="notes-notice"/);
  const script = readFileSync(join(root, 'src', 'scripts', 'notizen-page.mjs'), 'utf8');
  assert.match(script, /notes-import-button'\)\?\.addEventListener\('click'/);
});
