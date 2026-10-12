import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
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
async function render(body, scriptOverride = null, openDetail = false) {
  const nodes = new Map();
  const make = () => new Proxy({children: [], events: {}, hidden: false, value: '', textContent: '', dataset: {}, classList: {add() {}},
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    addEventListener(name, handler) { this.events[name] = handler; }}, {
    get: (t, k) => k in t ? t[k] : (...a) => (k === 'querySelector' || k === 'createElement' ? make() : undefined),
    set: (t, k, v) => (t[k] = v, true),
  });
  const document = {getElementById: id => nodes.get(id) ?? nodes.set(id, make()).get(id), createElement: make};
  const script = scriptOverride ?? page.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*$/m, '');
  const fetch = async url => ({ok: true, status: 200, json: async () => (String(url).endsWith('/1') ? {success: true, usecase: row} : body)});
  const context = {document, fetch, sourceNotice, confirm: () => false, encodeURIComponent, Number, String, Array, Set, Object, Error, Promise, FormData: class {}};
  vm.runInNewContext(script, context);
  await new Promise(r => setTimeout(r, 20));
  if (openDetail) await nodes.get('uc-list').children[0].events.click();
  return Object.fromEntries([...nodes].map(([id, n]) => [id, [n.textContent, n.hidden]]));
}

test('BACH ohne source: Anzeige unverändert, keine leere Zeile', async () => {
  const state = await render(list());
  assert.deepEqual(state['uc-source'], ['', true]);
  assert.deepEqual(state['uc-total'], ['1', false]);
  const { 'uc-source': _a, ...withoutOcean } = state;
  assert.deepEqual(withoutOcean, (({ 'uc-source': _b, ...rest }) => rest)(await render(list(null))));
});

test('strict ISO source date: reject normalized dates and non-ISO strings', () => {
  for (const generated_at of ['0', '12', 'June 22 2026', '2026-02-31', '2026-02-29',
    '2026-13-01', '2026-06-22T24:00:00Z', '2026-06-22T12:60:00Z',
    '2026-06-22T12:00:60Z', '2026-06-22T12:00:00+24:00', '2026-06-22T12:00:00'])
    assert.equal(sourceNotice({...ocean, generated_at}), null, generated_at);
  for (const generated_at of ['2024-02-29', '2026-06-22T12:00:00Z', '2026-06-22T12:00:00.123+02:00'])
    assert.ok(sourceNotice({...ocean, generated_at}), generated_at);
});

// Recover only the explicitly added source-notice operations. Its hash must match the
// actual inline script read from the released daac428 source, without requiring git in CI.
function releasedBachScript() {
  const script = page.replaceAll('\r\n', '\n').match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^    import .*\n/m, '')
    .replace('      let notice = null;\n', '')
    .replace('          notice = sourceNotice(body.source);\n', '')
    .replace("          message('uc-source', notice ? notice.line + (notice.derivedNote ? ' · ' + notice.derivedNote : '') : '');\n", '')
    .replace("          rows=[];notice=null;message('uc-source','');", '          rows=[];')
    .replace('          const note = notice && notice.derivedNote;\n', '')
    .replace("          byId('uc-result-note').textContent = note || '';byId('uc-result-note').hidden = !note;\n", '');
  assert.equal(createHash('sha256').update(script).digest('hex'),
    '30e5977965e46044c9252972d956abd080554a3432dd718be77b5ea8fed4db64');
  return script;
}

test('BACH list and opened detail match the actual released daac428 script', async () => {
  const strip = ({'uc-source': _source, 'uc-result-note': _note, ...rest}) => rest;
  for (const detail of [false, true]) {
    assert.deepEqual(strip(await render(list(), null, detail)), await render(list(), releasedBachScript(), detail));
  }
  const detail = await render(list(), null, true);
  assert.deepEqual(detail['uc-result-note'], ['', true]);
  assert.match(page, /#uc-result-note:not\(\[hidden\]\)\s*\{\s*display:block;/);
  assert.doesNotMatch(page, /#uc-result-note\s*\{\s*display:/);
});

test('Ocean opened detail displays the derived-status notice', async () => {
  const detail = await render(list(ocean), null, true);
  assert.deepEqual(detail['uc-result-note'], ['Prüfstatus aus Score abgeleitet', false]);
});

test('the adapted Usecase import and working-source hashes bind the exact page', () => {
  const path = 'src/pages/governance/usecases.astro';
  const provenance = JSON.parse(readFileSync(resolve(root, 'SOURCE_PROVENANCE.json'), 'utf8'));
  const hash = createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
  const imports = provenance.source_imports.map(group => group.files?.[path]).filter(Boolean);
  assert.equal(imports.length, 1);
  assert.equal(provenance.files_sha256[path], hash);
  assert.equal(imports[0].imported_sha256, hash);
  assert.equal(imports[0].adapted, true);
  assert.equal(imports[0].source_sha256, '82cb21703924d21941b73bfb6dfc7cd73a493e69e2fe9c3be5fdaa7c66cdd15b');
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
