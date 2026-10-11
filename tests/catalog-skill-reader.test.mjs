import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkillReader, MAX_SOURCE_BYTES} from '../src/lib/catalog-skill-reader.mjs';

const REV = 'a'.repeat(64);
const rows = [
  {key: 'skill:x:note', id: 'skill:x:note', name: 'Ganz Anderer Anzeigename', candidate: 'note'},
  {key: 'skill:x:ghost', id: 'skill:x:ghost', name: 'ghost', candidate: 'ghost'},
  {key: 'skill:a:dup', id: 'skill:a:dup', name: 'dup', candidate: 'dup'},
  {key: 'skill:b:dup', id: 'skill:b:dup', name: 'dup', candidate: 'dup'},
  {key: 'skill:x:nopath', id: 'skill:x:nopath', name: 'nopath', candidate: null},
];
const json = (status, body) => ({ok: status < 400, status, json: async () => body});

// Records every URL. The library knows note and dup; source endpoints answer per id.
function fakeFetch(overrides = {}) {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    if (url === '/api/capabilities/skills/library') return overrides.library ? overrides.library() : json(200, {skills: [{id: 'note'}, {id: 'dup'}]});
    const id = decodeURIComponent(url.split('/')[4]);
    if (overrides[id]) return overrides[id]();
    return json(200, {id, content: 'Volltext von ' + id, source_version: REV});
  };
  return {fetcher, calls};
}
const clip = () => { const writes = []; return {writes, writeText: async v => { writes.push(v); }}; };

test('display name differs from the library id: the path-derived id is read, never the name', async () => {
  const {fetcher, calls} = fakeFetch();
  const reader = createSkillReader({fetcher, clipboard: clip()});
  reader.setRows(rows);
  const result = await reader.open(rows[0]);
  assert.equal(result.state, 'loaded');
  assert.equal(result.id, 'note');
  assert.equal(result.source.content, 'Volltext von note');
  assert.ok(calls.includes('/api/capabilities/skills/note/source'));
  assert.ok(!calls.some(u => u.includes('Anderer')));
});

test('lazy: nothing is fetched before open; the library is fetched once', async () => {
  const {fetcher, calls} = fakeFetch();
  const reader = createSkillReader({fetcher, clipboard: clip()});
  reader.setRows(rows);
  assert.equal(calls.length, 0);
  await reader.open(rows[0]);
  await reader.open(rows[1]);
  assert.equal(calls.filter(u => u.endsWith('/library')).length, 1);
});

test('repeated and concurrent opens load the source exactly once', async () => {
  const {fetcher, calls} = fakeFetch();
  const reader = createSkillReader({fetcher, clipboard: clip()});
  reader.setRows(rows);
  const [a, b] = await Promise.all([reader.open(rows[0]), reader.open(rows[0])]);
  await reader.open(rows[0]);
  assert.equal(a.state, 'loaded');
  assert.equal(b.state, 'loaded');
  assert.equal(calls.filter(u => u.endsWith('/note/source')).length, 1);
});

test('unknown, ambiguous and path-less skills are disabled with a reason and never hit the source endpoint', async () => {
  const {fetcher, calls} = fakeFetch();
  const reader = createSkillReader({fetcher, clipboard: clip()});
  reader.setRows(rows);
  for (const [row, pattern] of [[rows[1], /Nicht in der Skill-Bibliothek/], [rows[2], /Mehrdeutig/], [rows[4], /Kein Bibliothekspfad/]]) {
    const result = await reader.open(row);
    assert.equal(result.state, 'disabled');
    assert.match(result.reason, pattern);
  }
  assert.ok(!calls.some(u => u.endsWith('/source')));
});

test('HTTP errors are reported and not cached: a later retry can succeed', async () => {
  let fail = true;
  const {fetcher} = fakeFetch({note: () => (fail ? json(404, {detail: 'Keine aktuelle SKILL.md-Quelle'}) : json(200, {id: 'note', content: 'ok', source_version: REV}))});
  const reader = createSkillReader({fetcher, clipboard: clip()});
  reader.setRows(rows);
  const first = await reader.open(rows[0]);
  assert.equal(first.state, 'error');
  assert.match(first.message, /Keine aktuelle SKILL\.md-Quelle/);
  fail = false;
  assert.equal((await reader.open(rows[0])).state, 'loaded');
});

test('a failing library request is an error, not "disabled", and is retried', async () => {
  let fail = true;
  const {fetcher} = fakeFetch({library: () => (fail ? json(503, {detail: 'Aktuelle Skill-Bibliothek nicht lesbar'}) : json(200, {skills: [{id: 'note'}]}))});
  const reader = createSkillReader({fetcher, clipboard: clip()});
  reader.setRows(rows);
  assert.equal((await reader.open(rows[0])).state, 'error');
  fail = false;
  assert.equal((await reader.open(rows[0])).state, 'loaded');
});

test('a source answering for a different id is rejected', async () => {
  const {fetcher} = fakeFetch({note: () => json(200, {id: 'other', content: 'x', source_version: REV})});
  const reader = createSkillReader({fetcher, clipboard: clip()});
  reader.setRows(rows);
  assert.equal((await reader.open(rows[0])).state, 'error');
});

test('size limit: more than MAX_SOURCE_BYTES (counted in bytes) is refused, exactly the limit is fine', async () => {
  const big = 'ä'.repeat(MAX_SOURCE_BYTES / 2 + 1); // two bytes each
  const refused = createSkillReader({fetcher: fakeFetch({note: () => json(200, {id: 'note', content: big, source_version: REV})}).fetcher, clipboard: clip()});
  refused.setRows(rows);
  const result = await refused.open(rows[0]);
  assert.equal(result.state, 'error');
  assert.match(result.message, /überschreitet 200000 Byte/);
  const exact = createSkillReader({fetcher: fakeFetch({note: () => json(200, {id: 'note', content: 'a'.repeat(MAX_SOURCE_BYTES), source_version: REV})}).fetcher, clipboard: clip()});
  exact.setRows(rows);
  assert.equal((await exact.open(rows[0])).state, 'loaded');
});

test('clipboard: loaded text, library id or catalog id; never the display name; failures are reported', async () => {
  const clipboard = clip();
  const reader = createSkillReader({fetcher: fakeFetch().fetcher, clipboard});
  reader.setRows(rows);
  assert.deepEqual(await reader.copyFullText(rows[0]), {ok: true, message: 'Volltext kopiert.'});
  assert.deepEqual(await reader.copyLibraryId(rows[0]), {ok: true, message: 'Bibliotheks-ID kopiert.'});
  assert.deepEqual(await reader.copyCatalogId(rows[0]), {ok: true, message: 'Katalog-ID kopiert.'});
  assert.deepEqual(clipboard.writes, ['Volltext von note', 'note', 'skill:x:note']);
  assert.equal((await reader.copyLibraryId(rows[1])).ok, false);
  assert.equal(clipboard.writes.length, 3);
  const blocked = createSkillReader({fetcher: fakeFetch().fetcher, clipboard: {writeText: async () => { throw new Error('denied'); }}});
  blocked.setRows(rows);
  assert.match((await blocked.copyCatalogId(rows[0])).message, /gesperrt/);
  const none = createSkillReader({fetcher: fakeFetch().fetcher, clipboard: null});
  assert.match((await none.copyCatalogId(rows[0])).message, /keine Zwischenablage/);
});

test('a failed full-text load copies nothing', async () => {
  const clipboard = clip();
  const reader = createSkillReader({fetcher: fakeFetch({note: () => json(500, {detail: 'kaputt'})}).fetcher, clipboard});
  reader.setRows(rows);
  assert.equal((await reader.copyFullText(rows[0])).ok, false);
  assert.deepEqual(clipboard.writes, []);
});
