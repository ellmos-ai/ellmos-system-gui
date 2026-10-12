import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {sourceNotice} from '../src/lib/usecase-source.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const page = readFileSync(resolve(root, 'src/pages/governance/usecases.astro'), 'utf8');
const ocean = {id: 'ellmos-tests', file: 'usecases.json', read_only: true, generated_at: '2026-06-22', source_db: null, derived: ['test_result', 'stats']};
const row = {id: 1, title: 'Eins', description: 'd', workflow_name: 'w', test_result: 'pass', test_score: 80, last_tested: null};
const list = source => ({success: true, usecases: [row], stats: {total: 1, pass: 1, fail: 0, pending: 0}, ...(source === undefined ? {} : {source})});

test('Ocean source: Herkunft, Datum und Ableitungshinweis', () => {
  const notice = sourceNotice(ocean);
  assert.equal(notice.line, 'Herkunft: ellmos-tests · Datenstand: 22.6.2026');
  assert.equal(notice.derivedNote, 'Prüfstatus aus Score abgeleitet');
  assert.equal(sourceNotice({...ocean, derived: ['stats']}).derivedNote, null);
});

test('negative control: fehlendes oder ungültiges source ergibt keine Anzeige', () => {
  for (const bad of [undefined, null, 'x', 5, [], {}, {id: 'a'}, {id: 'a', generated_at: 'kein Datum'},
    {id: 5, generated_at: '2026-06-22'}, {id: 'a', generated_at: null}, {id: '', generated_at: '2026-06-22'}])
    assert.equal(sourceNotice(bad), null, JSON.stringify(bad));
});

// Seite mit Fake-DOM ausfuehren; liefert den sichtbaren Zustand aller Knoten.
async function render(body) {
  const nodes = new Map();
  const make = () => new Proxy({children: [], hidden: false, value: '', textContent: '', dataset: {}, classList: {add() {}}}, {
    get: (t, k) => k in t ? t[k] : (...a) => (k === 'querySelector' || k === 'createElement' ? make() : undefined),
    set: (t, k, v) => (t[k] = v, true),
  });
  const document = {getElementById: id => nodes.get(id) ?? nodes.set(id, make()).get(id), createElement: make};
  const script = page.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*$/m, '');
  const fetch = async url => ({ok: true, status: 200, json: async () => (String(url).endsWith('/1') ? {success: true, usecase: row} : body)});
  const context = {document, fetch, sourceNotice, confirm: () => false, encodeURIComponent, Number, String, Array, Set, Object, Error, Promise, FormData: class {}};
  vm.runInNewContext(script, context);
  await new Promise(r => setTimeout(r, 20));
  return Object.fromEntries([...nodes].map(([id, n]) => [id, [n.textContent, n.hidden]]));
}

test('BACH ohne source: Anzeige unverändert, keine leere Zeile', async () => {
  const state = await render(list());
  assert.deepEqual(state['uc-source'], ['', true]);
  assert.deepEqual(state['uc-total'], ['1', false]);
  const { 'uc-source': _a, ...withoutOcean } = state;
  assert.deepEqual(withoutOcean, (({ 'uc-source': _b, ...rest }) => rest)(await render(list(null))));
});

test('Ocean mit source: Zeile sichtbar, übrige Anzeige identisch zu BACH', async () => {
  const state = await render(list(ocean));
  assert.deepEqual(state['uc-source'], ['Herkunft: ellmos-tests · Datenstand: 22.6.2026 · Prüfstatus aus Score abgeleitet', false]);
  const strip = ({'uc-source': _s, ...rest}) => rest;
  assert.deepEqual(strip(state), strip(await render(list())));
});

test('Ocean mit ungültigem source: wie BACH, ohne Fehler', async () => {
  const state = await render(list({id: 'ellmos-tests', generated_at: 'gestern'}));
  assert.deepEqual(state['uc-source'], ['', true]);
  assert.equal(state['uc-list-error'][1], true);
});
