import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {sourceErrorMessage, sourceNotice, sourceReadOnlyState} from '../src/lib/usecase-source.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const page = readFileSync(resolve(root, 'src/pages/governance/usecases.astro'), 'utf8');
const ocean = {id: 'ellmos-tests', file: 'usecases.json', read_only: true, generated_at: '2026-06-22', source_db: null, derived: ['test_result', 'stats']};
const row = {id: 1, title: 'Eins', description: 'd', workflow_name: 'w', test_result: 'pass', test_score: 80, last_tested: null};
const fullRow = {id: 1, title: 'Beispiel', description: 'Beschreibung BACH', workflow_name: 'workflow-bach', test_result: 'pass',
  test_score: 80, last_tested: '2026-10-11T12:00:00Z', created_by: 'Testautor', updated_at: '2026-10-11T13:00:00Z',
  test_input: 'Eingabe', expected_output: 'Ausgabe'};
const list = source => ({success: true, usecases: [row], stats: {total: 1, pass: 1, fail: 0, pending: 0}, ...(source === undefined ? {} : {source})});

test('Ocean source: Herkunft, Datum und Ableitungshinweis', () => {
  const notice = sourceNotice(ocean);
  assert.equal(notice.line, 'Herkunft: ellmos-tests · Datenstand: 22.6.2026');
  assert.equal(notice.derivedNote, 'Prüfstatus aus Score abgeleitet');
  assert.equal(sourceNotice({...ocean, derived: ['stats']}).derivedNote, null);
  assert.equal(sourceReadOnlyState(ocean), 'read-only');
  assert.equal(sourceReadOnlyState({...ocean, source_db: 'C:/private/path/usecases.sqlite'}), 'read-only');
  assert.equal(sourceErrorMessage('source-missing'), 'Die Usecase-Quelle fehlt.');
  assert.equal(sourceErrorMessage('source-too-large'), 'Die Usecase-Quelle überschreitet die zulässige Größe.');
  assert.equal(sourceErrorMessage('source-unreadable'), 'Die Usecase-Quelle konnte nicht gelesen werden.');
  assert.equal(sourceErrorMessage('source-invalid'), 'Die Usecase-Quelle ist ungültig.');
  assert.equal(sourceErrorMessage('C:/private/path'), 'Die Usecase-Quelle ist derzeit nicht verfügbar.');
});

test('Nur der exakte Ocean-Read-only-Vertrag erlaubt eine Quellenanzeige als schreibgeschützt', () => {
  for (const source of [
    {...ocean, read_only: false}, {...ocean, read_only: 'false'}, {...ocean, read_only: 1},
    {...ocean, id: 'unknown-source'}, {...ocean, file: 'C:/private/usecases.json'},
    {...ocean, generated_at: 'ungültig'}, null, [],
  ]) assert.equal(sourceReadOnlyState(source), 'unknown', JSON.stringify(source));
});

test('negative control: fehlendes oder ungültiges source ergibt keine Anzeige', () => {
  for (const bad of [undefined, null, 'x', 5, [], {}, {id: 'a'}, {id: 'a', generated_at: 'kein Datum'},
    {id: 5, generated_at: '2026-06-22'}, {id: 'a', generated_at: null}, {id: '', generated_at: '2026-06-22'}])
    assert.equal(sourceNotice(bad), null, JSON.stringify(bad));
});

// Seite mit Fake-DOM ausfuehren; fetch can be controlled to reproduce stale responses.
function mount(fetchImpl, scriptOverride = null, confirmImpl = () => false) {
  const nodes = new Map();
  const make = () => new Proxy({children: [], events: {}, hidden: false, value: '', textContent: '', dataset: {}, classList: {add() {}},
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    addEventListener(name, handler) { this.events[name] = handler; }}, {
    get: (t, k) => k in t ? t[k] : (...a) => (k === 'querySelector' || k === 'createElement' ? make() : undefined),
    set: (t, k, v) => (t[k] = v, true),
  });
  const document = {getElementById: id => nodes.get(id) ?? nodes.set(id, make()).get(id), createElement: make};
  const script = scriptOverride ?? page.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*$/m, '');
  const context = {document, fetch: fetchImpl, sourceErrorMessage, sourceNotice, sourceReadOnlyState, confirm: confirmImpl,
    encodeURIComponent, Number, String, Array, Set, Object, Error, Promise, FormData: class {}};
  vm.runInNewContext(script, context);
  return nodes;
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function controlledFetch() {
  const calls = [];
  const fetch = (url, options) => new Promise((resolve, reject) => calls.push({url: String(url), options,
    success(body) { resolve({ok: true, status: 200, json: async () => body}); },
    failure(detail = 'API nicht erreichbar') { resolve({ok: false, status: 503, json: async () => ({success: false, detail})}); },
    unavailable(reason) { resolve({ok: false, status: 503, json: async () => ({available: false, reason})}); },
    reject}));
  return {calls, fetch};
}

function response(body, status = 200) {
  return {ok: status >= 200 && status < 300, status, json: async () => body};
}

function listRows(usecases, source) {
  return {success: true, usecases, stats: {total: usecases.length, pass: usecases.filter(item => item.test_result === 'pass').length,
    fail: usecases.filter(item => item.test_result === 'fail').length, pending: usecases.filter(item => !['pass','fail'].includes(item.test_result)).length},
    ...(source === undefined ? {} : {source})};
}

async function startPendingCheckThenSelectSecond() {
  const second = {...row, id: 2, title: 'Zwei', workflow_name: 'w2'};
  const pending = controlledFetch();
  const nodes = mount(pending.fetch, null, () => true);
  pending.calls[0].success(listRows([row, second]));
  await flush();
  const firstOpen = nodes.get('uc-list').children[0].events.click();
  await flush();
  pending.calls[1].success({success: true, usecase: row});
  await firstOpen;

  const check = nodes.get('uc-check').events.click();
  await flush();
  assert.equal(pending.calls[2].url, '/api/usecases/1/test');
  const secondOpen = nodes.get('uc-list').children[1].events.click();
  await flush();
  pending.calls[3].success({success: true, usecase: second});
  await secondOpen;
  assert.equal(nodes.get('uc-title').textContent, 'Zwei');
  assert.equal(nodes.get('uc-action-status').textContent, '');
  assert.equal(nodes.get('uc-action-status').hidden, true);
  return {pending, nodes, check};
}

async function startPendingCheckForFirst() {
  const second = {...row, id: 2, title: 'Zwei', workflow_name: 'w2'};
  const pending = controlledFetch();
  const nodes = mount(pending.fetch, null, () => true);
  pending.calls[0].success(listRows([row, second]));
  await flush();
  const firstOpen = nodes.get('uc-list').children[0].events.click();
  await flush();
  pending.calls[1].success({success: true, usecase: row});
  await firstOpen;

  const check = nodes.get('uc-check').events.click();
  await flush();
  assert.equal(pending.calls[2].url, '/api/usecases/1/test');
  return {pending, nodes, check, second};
}

function stateOf(nodes) {
  return Object.fromEntries([...nodes].map(([id, n]) => [id, [n.textContent, n.hidden]]));
}

async function render(body, scriptOverride = null, openDetail = false, detailBody = {success: true, usecase: row}) {
  const fetch = async url => response(String(url).endsWith('/1') ? detailBody : body);
  const nodes = mount(fetch, scriptOverride);
  await flush();
  if (openDetail) await nodes.get('uc-list').children[0].events.click();
  return stateOf(nodes);
}

test('BACH ohne source: Anzeige unverändert, keine leere Zeile', async () => {
  const state = await render(list());
  assert.deepEqual(state['uc-source'], ['', true]);
  assert.deepEqual(state['uc-total'], ['1', false]);
  const explicitNull = await render({...list(), source: null});
  assert.equal(explicitNull['uc-create'][1], true, 'an explicit null source is invalid, not legacy BACH');
  assert.match(explicitNull['uc-page-status'][0], /nicht verifiziert/);
});

test('strict ISO source date: reject normalized dates and non-ISO strings', () => {
  for (const generated_at of ['0', '12', 'June 22 2026', '2026-02-31', '2026-02-29',
    '2026-13-01', '2026-06-22T24:00:00Z', '2026-06-22T12:60:00Z',
    '2026-06-22T12:00:60Z', '2026-06-22T12:00:00+24:00', '2026-06-22T12:00:00'])
    assert.equal(sourceNotice({...ocean, generated_at}), null, generated_at);
  for (const generated_at of ['2024-02-29', '2026-06-22T12:00:00Z', '2026-06-22T12:00:00.123+02:00'])
    assert.ok(sourceNotice({...ocean, generated_at}), generated_at);
});

test('BACH ohne source bewahrt die vollständige Listen- und Detaildarstellung', async () => {
  const state = await render(listRows([fullRow]), null, true, {success: true, usecase: fullRow});
  assert.deepEqual(state['uc-source'], ['', true]);
  assert.deepEqual(state['uc-detail-source'], ['', true]);
  assert.deepEqual(state['uc-total'], ['1', false]);
  assert.deepEqual(state['uc-pass'], ['1', false]);
  assert.deepEqual(state['uc-fail'], ['0', false]);
  assert.deepEqual(state['uc-pending'], ['0', false]);
  assert.deepEqual(state['uc-count'], ['1 von 1 Definitionen', false]);
  assert.deepEqual(state['uc-empty'], ['', true]);
  assert.deepEqual(state['uc-detail-content'], ['', false]);
  for (const [id, expected] of Object.entries({
    'uc-id': 'Usecase #1', 'uc-title': 'Beispiel', 'uc-workflow': 'workflow-bach',
    'uc-result': 'Definition geprüft', 'uc-score': '80 %', 'uc-tested': '2026-10-11T12:00:00Z',
    'uc-author': 'Testautor', 'uc-updated': '2026-10-11T13:00:00Z', 'uc-description': 'Beschreibung BACH',
    'uc-input': 'Eingabe', 'uc-expected': 'Ausgabe',
  })) assert.deepEqual(state[id], [expected, false], id);
  assert.deepEqual(state['uc-result-note'], ['', true]);
  assert.deepEqual(state['uc-action-status'], ['', true]);
  assert.match(page, /#uc-result-note:not\(\[hidden\]\)\s*\{\s*display:block;/);
  assert.doesNotMatch(page, /#uc-result-note\s*\{\s*display:/);
});

test('Ocean opened detail displays the derived-status notice', async () => {
  const detail = await render(list(ocean), null, true);
  assert.deepEqual(detail['uc-result-note'], ['Prüfstatus aus Score abgeleitet', false]);
});

test('Ocean read-only source hides and disables every mutating control and blocks direct handlers', async () => {
  let confirms=0;
  const pending=controlledFetch();
  const nodes=mount(pending.fetch,null,()=>{confirms++;return true;});
  pending.calls[0].success(list(ocean));
  await flush();
  for (const id of ['uc-check-all','uc-create','uc-edit','uc-check','uc-delete']) {
    assert.equal(nodes.get(id).hidden,true,id);
    assert.equal(nodes.get(id).disabled,true,id);
  }
  assert.match(nodes.get('uc-page-status').textContent,/schreibgeschützt/);
  assert.match(nodes.get('uc-source').textContent,/Nur Lesezugriff/);

  const open=nodes.get('uc-list').children[0].events.click();
  await flush();
  pending.calls[1].success({success:true,usecase:row});
  await open;
  const before=pending.calls.length;
  nodes.get('uc-create').events.click();
  await nodes.get('uc-edit').events.click();
  await nodes.get('uc-check').events.click();
  await nodes.get('uc-check-all').events.click();
  await nodes.get('uc-delete').events.click();
  await nodes.get('uc-editor-form').events.submit({preventDefault(){},currentTarget:nodes.get('uc-editor-form')});
  assert.equal(pending.calls.length,before,'read-only handlers must not dispatch GET-after-mutation or write requests');
  assert.equal(confirms,0,'read-only handlers must stop before asking for mutation confirmation');
});

test('present but invalid or unknown source metadata never grants legacy write access', async () => {
  for (const source of [
    {...ocean, read_only: 'false'}, {...ocean, read_only: false}, {...ocean, id: 'unknown-source'},
    {...ocean, generated_at: 'invalid', source_db: 'C:/private/secret.sqlite'},
  ]) {
    const pending=controlledFetch();
    const nodes=mount(pending.fetch);
    pending.calls[0].success(list(source));
    await flush();
    assert.equal(nodes.get('uc-create').hidden,true,JSON.stringify(source));
    assert.equal(nodes.get('uc-check-all').disabled,true,JSON.stringify(source));
    assert.match(nodes.get('uc-page-status').textContent,/nicht verifiziert/);
    assert.doesNotMatch(nodes.get('uc-source').textContent,/unknown-source|private|secret/);
  }
});

test('BACH list without source keeps the legacy controls, but detail metadata can only tighten access', async () => {
  const pending=controlledFetch();
  const nodes=mount(pending.fetch);
  pending.calls[0].success(list());
  await flush();
  assert.equal(nodes.get('uc-create').hidden,false);
  assert.equal(nodes.get('uc-check-all').disabled,false);

  const open=nodes.get('uc-list').children[0].events.click();
  await flush();
  pending.calls[1].success({success:true,usecase:row,source:ocean});
  await open;
  assert.equal(nodes.get('uc-create').hidden,true,'a read-only detail source tightens legacy list access');
  assert.equal(nodes.get('uc-delete').disabled,true);
  const before=pending.calls.length;
  nodes.get('uc-create').events.click();
  assert.equal(pending.calls.length,before);
});

test('invalid detail source blocks a legacy BACH list without publishing detail provenance', async () => {
  for (const source of [
    {...ocean, id:'private-detail-source', generated_at:'2026-06-23'},
    {...ocean, read_only:false, generated_at:'2026-06-23'},
    {...ocean, read_only:'false', generated_at:'2026-06-23'},
  ]) {
    const pending=controlledFetch();
    const nodes=mount(pending.fetch);
    pending.calls[0].success(list());
    await flush();
    assert.equal(nodes.get('uc-create').hidden,false);
    const open=nodes.get('uc-list').children[0].events.click();
    await flush();
    pending.calls[1].success({success:true,usecase:row,source});
    await open;
    for (const id of ['uc-create','uc-edit','uc-delete','uc-check','uc-check-all']) {
      assert.equal(nodes.get(id).hidden,true,`${id} must stay blocked`);
      assert.equal(nodes.get(id).disabled,true,`${id} must stay disabled`);
    }
    assert.equal(nodes.get('uc-detail-source').textContent,'');
    assert.equal(nodes.get('uc-detail-source').hidden,true);
    assert.equal(nodes.get('uc-result-note').textContent,'');
    assert.equal(nodes.get('uc-result-note').hidden,true);
  }
});

test('Detail without source cannot loosen Ocean read-only list access', async () => {
  const pending=controlledFetch();
  const nodes=mount(pending.fetch);
  pending.calls[0].success(list(ocean));
  await flush();
  const open=nodes.get('uc-list').children[0].events.click();
  await flush();
  pending.calls[1].success({success:true,usecase:row});
  await open;
  assert.equal(nodes.get('uc-create').hidden,true);
  assert.equal(nodes.get('uc-check').disabled,true);
});

test('Controlled source 503 errors are translated and unknown reasons do not leak', async () => {
  for (const [reason,expected] of [
    ['source-missing','Die Usecase-Quelle fehlt.'],
    ['source-invalid','Die Usecase-Quelle ist ungültig.'],
    ['/Users/private/client/usecases.json','Die Usecase-Quelle ist derzeit nicht verfügbar.'],
  ]) {
    const pending=controlledFetch();
    const nodes=mount(pending.fetch);
    pending.calls[0].unavailable(reason);
    await flush();
    assert.equal(nodes.get('uc-list-error').textContent,expected);
    assert.equal(nodes.get('uc-create').hidden,true);
    assert.equal(nodes.get('uc-delete').disabled,true);
    assert.doesNotMatch(nodes.get('uc-list-error').textContent,/private|usecases\.json/);
  }
});

test('late check-all response cannot reload over a source change or re-enable its control', async () => {
  const pending=controlledFetch();
  const nodes=mount(pending.fetch,null,()=>true);
  pending.calls[0].success(list());
  await flush();

  const checkAll=nodes.get('uc-check-all').events.click();
  await flush();
  assert.equal(pending.calls[1].url,'/api/usecases/test-all');
  const refresh=nodes.get('uc-refresh').events.click();
  await flush();
  assert.equal(pending.calls[2].url,'/api/usecases');
  pending.calls[2].success(list(ocean));
  await refresh;

  pending.calls[1].success({success:true,total:1});
  await checkAll;
  assert.equal(pending.calls.length,3,'a late mutation result must not start another list read');
  assert.equal(nodes.get('uc-page-status').textContent,'Die verbundene Usecase-Quelle ist schreibgeschützt; Änderungen sind deaktiviert.');
  assert.equal(nodes.get('uc-check-all').hidden,true);
  assert.equal(nodes.get('uc-check-all').disabled,true);
});

test('failed list refresh clears old detail and source instead of leaving stale content visible', async () => {
  const pending = controlledFetch();
  const nodes = mount(pending.fetch);
  pending.calls[0].success(list(ocean));
  await flush();
  const openPromise = nodes.get('uc-list').children[0].events.click();
  await flush();
  pending.calls[1].success({success: true, usecase: row, source: ocean});
  await openPromise;
  assert.equal(nodes.get('uc-detail-content').hidden, false);
  assert.equal(nodes.get('uc-result-note').hidden, false);

  const refreshPromise = nodes.get('uc-refresh').events.click();
  await flush();
  assert.equal(nodes.get('uc-create').hidden,true,'refresh invalidates write permission until a current list is confirmed');
  assert.equal(nodes.get('uc-create').disabled,true);
  assert.equal(nodes.get('uc-detail-content').hidden, true);
  assert.equal(nodes.get('uc-result-note').hidden, true);
  assert.equal(nodes.get('uc-source').textContent, '');
  pending.calls[2].failure('Refresh fehlgeschlagen');
  await refreshPromise;
  assert.equal(nodes.get('uc-detail-content').hidden, true);
  assert.equal(nodes.get('uc-result-note').textContent, '');
  assert.equal(nodes.get('uc-source').textContent, 'Quelle nicht verifiziert; Änderungen deaktiviert');
  assert.equal(nodes.get('uc-list-error').textContent, 'Refresh fehlgeschlagen');
  assert.equal(nodes.get('uc-create').hidden,true);
});

test('fresh list source is retained when its automatic detail refresh fails', async () => {
  const nextSource = {...ocean, generated_at: '2026-06-23'};
  const pending = controlledFetch();
  const nodes = mount(pending.fetch);
  pending.calls[0].success(list(ocean));
  await flush();
  const openPromise = nodes.get('uc-list').children[0].events.click();
  await flush();
  pending.calls[1].success({success: true, usecase: row, source: ocean});
  await openPromise;

  const refreshPromise = nodes.get('uc-refresh').events.click();
  await flush();
  pending.calls[2].success(list(nextSource));
  await flush();
  assert.equal(nodes.get('uc-source').textContent, 'Herkunft: ellmos-tests · Datenstand: 23.6.2026 · Prüfstatus aus Score abgeleitet · Nur Lesezugriff');
  assert.equal(nodes.get('uc-detail-content').hidden, true);
  assert.equal(nodes.get('uc-result-note').hidden, true);
  pending.calls[3].failure('Detail nicht erreichbar');
  await refreshPromise;
  assert.equal(nodes.get('uc-detail-content').hidden, true);
  assert.equal(nodes.get('uc-result-note').textContent, '');
  assert.match(nodes.get('uc-source').textContent, /^Herkunft: ellmos-tests/);
});

test('out-of-order detail responses cannot replace the latest selected usecase', async () => {
  const second = {...row, id: 2, title: 'Zwei', workflow_name: 'w2'};
  const pending = controlledFetch();
  const nodes = mount(pending.fetch);
  pending.calls[0].success(listRows([row, second]));
  await flush();

  const firstRequest = nodes.get('uc-list').children[0].events.click();
  await flush();
  const secondRequest = nodes.get('uc-list').children[1].events.click();
  await flush();
  pending.calls[2].success({success: true, usecase: second});
  await secondRequest;
  assert.equal(nodes.get('uc-title').textContent, 'Zwei');

  pending.calls[1].success({success: true, usecase: {...row, title: 'Veraltet'}});
  await firstRequest;
  assert.equal(nodes.get('uc-title').textContent, 'Zwei');
  assert.equal(nodes.get('uc-id').textContent, 'Usecase #2');
});

test('a later list refresh invalidates pending detail and old list responses', async () => {
  const freshSource = {...ocean, generated_at: '2026-06-23'};
  const staleSource = {...ocean, generated_at: '2026-06-22'};
  const pending = controlledFetch();
  const nodes = mount(pending.fetch);
  pending.calls[0].success(list(ocean));
  await flush();
  const staleDetail = nodes.get('uc-list').children[0].events.click();
  await flush();

  const staleList = nodes.get('uc-refresh').events.click();
  await flush();
  const freshList = nodes.get('uc-refresh').events.click();
  await flush();
  pending.calls[3].success(list(freshSource));
  await flush();
  assert.equal(nodes.get('uc-source').textContent, 'Herkunft: ellmos-tests · Datenstand: 23.6.2026 · Prüfstatus aus Score abgeleitet · Nur Lesezugriff');
  pending.calls[4].success({success: true, usecase: {...row, title: 'Aktuell'}});
  await freshList;

  pending.calls[2].success(list(staleSource));
  await staleList;
  pending.calls[1].success({success: true, usecase: {...row, title: 'Altes Detail'}, source: staleSource});
  await staleDetail;
  assert.equal(nodes.get('uc-title').textContent, 'Aktuell');
  assert.match(nodes.get('uc-source').textContent, /^Herkunft: ellmos-tests/);
});

test('mismatched detail IDs do not expose detail fields or its source note', async () => {
  const unexpectedSource = {...ocean, id: 'wrong-response', derived: ['stats']};
  const pending = controlledFetch();
  const nodes = mount(pending.fetch);
  pending.calls[0].success(list(ocean));
  await flush();
  const openPromise = nodes.get('uc-list').children[0].events.click();
  await flush();
  pending.calls[1].success({success: true, usecase: {...row, id: 2, title: 'Falscher Datensatz'}, source: unexpectedSource});
  await openPromise;
  assert.equal(nodes.get('uc-detail-content').hidden, true);
  assert.equal(nodes.get('uc-result-note').hidden, true);
  assert.match(nodes.get('uc-source').textContent, /^Herkunft: ellmos-tests.*Nur Lesezugriff/);
});

test('Detailquelle bleibt getrennt von Listenquelle und steuert nur den passenden Hinweis', async () => {
  const listSource = {...ocean, generated_at: '2026-06-22', derived: ['test_result']};
  const detailSource = {...ocean, generated_at: '2026-06-23', derived: ['test_result']};
  for (const [detailBody, expectedDetail, expectedNote] of [
    [{success: true, usecase: row, source: detailSource}, 'Detailherkunft: ellmos-tests · Datenstand: 23.6.2026', 'Prüfstatus aus Score abgeleitet'],
    [{success: true, usecase: row, source: listSource}, '', 'Prüfstatus aus Score abgeleitet'],
    [{success: true, usecase: row}, '', 'Prüfstatus aus Score abgeleitet'],
    [{success: true, usecase: row, source: null}, '', ''],
  ]) {
    const pending = controlledFetch();
    const nodes = mount(pending.fetch);
    pending.calls[0].success(list(listSource));
    await flush();
    const openPromise = nodes.get('uc-list').children[0].events.click();
    await flush();
    pending.calls[1].success(detailBody);
    await openPromise;
    assert.equal(nodes.get('uc-detail-source').textContent, expectedDetail);
    assert.equal(nodes.get('uc-detail-source').hidden, !expectedDetail);
    assert.equal(nodes.get('uc-result-note').textContent, expectedNote);
    assert.equal(nodes.get('uc-result-note').hidden, !expectedNote);
    const listState=detailBody.source === null
      ? 'Herkunft: ellmos-tests · Datenstand: 22.6.2026 · Prüfstatus aus Score abgeleitet · Quelle nicht verifiziert; Änderungen deaktiviert'
      : 'Herkunft: ellmos-tests · Datenstand: 22.6.2026 · Prüfstatus aus Score abgeleitet · Nur Lesezugriff';
    assert.equal(nodes.get('uc-source').textContent, listState);
  }
});

test('Beim Wechsel der Detailauswahl verschwinden alter Aktionsstatus und alte Detailherkunft sofort', async () => {
  const second = {...row, id: 2, title: 'Zwei'};
  const listSource = {...ocean};
  const detailSource = {...ocean, generated_at: '2026-06-23'};
  const pending = controlledFetch();
  const nodes = mount(pending.fetch);
  pending.calls[0].success(listRows([row, second], listSource));
  await flush();
  const firstOpen = nodes.get('uc-list').children[0].events.click();
  await flush();
  pending.calls[1].success({success: true, usecase: row, source: detailSource});
  await firstOpen;
  nodes.get('uc-action-status').textContent='Vorherige Aktionsmeldung';
  nodes.get('uc-action-status').hidden=false;
  const secondOpen = nodes.get('uc-list').children[1].events.click();
  await flush();
  assert.equal(nodes.get('uc-action-status').textContent, '');
  assert.equal(nodes.get('uc-action-status').hidden, true);
  assert.equal(nodes.get('uc-detail-source').textContent, '');
  assert.equal(nodes.get('uc-detail-source').hidden, true);
  assert.equal(nodes.get('uc-result-note').textContent, '');
  assert.equal(nodes.get('uc-detail-content').hidden, true);
  pending.calls[2].success({success: true, usecase: second});
  await secondOpen;
  assert.equal(nodes.get('uc-title').textContent, 'Zwei');
});

test('late uc-check success cannot reload or mark a newly selected detail', async () => {
  const {pending, nodes, check} = await startPendingCheckThenSelectSecond();
  pending.calls[2].success({success: true, result: 'pass'});
  await check;
  assert.equal(pending.calls.length, 4, 'stale success must not issue a list/detail refresh');
  assert.equal(nodes.get('uc-title').textContent, 'Zwei');
  assert.equal(nodes.get('uc-id').textContent, 'Usecase #2');
  assert.equal(nodes.get('uc-action-status').textContent, '');
  assert.equal(nodes.get('uc-action-status').hidden, true);
});

test('late uc-check failure cannot overwrite the newly selected detail status', async () => {
  const {pending, nodes, check} = await startPendingCheckThenSelectSecond();
  pending.calls[2].failure('Veralteter Prüfungsfehler');
  await check;
  assert.equal(pending.calls.length, 4, 'stale failure must not issue another request');
  assert.equal(nodes.get('uc-title').textContent, 'Zwei');
  assert.equal(nodes.get('uc-action-status').textContent, '');
  assert.equal(nodes.get('uc-action-status').hidden, true);
  assert.equal(nodes.get('uc-list-error').textContent, '');
});

test('uc-check success refreshes the same list and detail before reporting status', async () => {
  const {pending, nodes, check, second} = await startPendingCheckForFirst();
  pending.calls[2].success({success: true, result: 'pass'});
  await flush();
  assert.equal(pending.calls[3].url, '/api/usecases');
  pending.calls[3].success(listRows([{...row, last_tested: '2026-10-12T12:00:00Z'}, second]));
  await flush();
  assert.equal(pending.calls[4].url, '/api/usecases/1');
  pending.calls[4].success({success: true, usecase: {...row, last_tested: '2026-10-12T12:00:00Z'}});
  await check;

  assert.deepEqual(pending.calls.map(call => call.url), [
    '/api/usecases', '/api/usecases/1', '/api/usecases/1/test', '/api/usecases', '/api/usecases/1',
  ]);
  assert.equal(nodes.get('uc-title').textContent, 'Eins');
  assert.equal(nodes.get('uc-id').textContent, 'Usecase #1');
  assert.equal(nodes.get('uc-action-status').textContent,
    'Definitionsprüfung gespeichert: Definition geprüft. Kein Workflow wurde ausgeführt.');
  assert.equal(nodes.get('uc-action-status').hidden, false);
  assert.equal(nodes.get('uc-check').disabled, false);
});

test('manual refresh during uc-check prevents its late success from changing status or reloading', async () => {
  const {pending, nodes, check} = await startPendingCheckForFirst();
  const refresh = nodes.get('uc-refresh').events.click();
  await flush();
  assert.equal(pending.calls[3].url, '/api/usecases');
  pending.calls[3].success(listRows([row]));
  await flush();
  assert.equal(pending.calls[4].url, '/api/usecases/1');
  pending.calls[4].success({success: true, usecase: row});
  await refresh;

  pending.calls[2].success({success: true, result: 'pass'});
  await check;
  assert.equal(pending.calls.length, 5, 'stale success must not start another refresh');
  assert.equal(nodes.get('uc-title').textContent, 'Eins');
  assert.equal(nodes.get('uc-action-status').textContent, '');
  assert.equal(nodes.get('uc-action-status').hidden, true);
  assert.equal(nodes.get('uc-check').disabled, false);
});

test('the adapted Usecase import and working-source hashes bind the exact page', () => {
  const path = 'src/pages/governance/usecases.astro';
  const testPath = 'tests/usecase-source.test.mjs';
  const provenance = JSON.parse(readFileSync(resolve(root, 'SOURCE_PROVENANCE.json'), 'utf8'));
  const hash = createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
  const testHash = createHash('sha256').update(readFileSync(resolve(root, testPath))).digest('hex');
  const imports = provenance.source_imports.map(group => group.files?.[path]).filter(Boolean);
  assert.equal(imports.length, 1);
  assert.equal(provenance.files_sha256[path], hash);
  assert.equal(imports[0].imported_sha256, 'e3a9357ee934736d7e7b50735695f4b2d8aa8bf7160d99ac3fe416c70c661241');
  assert.equal(imports[0].adapted, true);
  assert.equal(imports[0].source_sha256, '82cb21703924d21941b73bfb6dfc7cd73a493e69e2fe9c3be5fdaa7c66cdd15b');
  const taskChange = provenance.followup_changes.find(change => change.scope === 'Task2137: stale-safe Usecase refresh and detail binding');
  assert.ok(taskChange);
  const taskFiles = Object.fromEntries(taskChange.files.map(file => [file.path, file]));
  assert.equal(taskFiles[path].sha256, 'e3a9357ee934736d7e7b50735695f4b2d8aa8bf7160d99ac3fe416c70c661241');
  assert.equal(taskFiles[testPath].sha256, '621d4e34352001b8430ae37290e0275a619eb422c8c34c8e91916cfb42b4d15f');
  const sourcePath = 'src/lib/usecase-source.mjs';
  const task2140 = provenance.followup_changes.find(change => change.scope === 'Task2140: Ocean read-only usecases and safe source errors');
  assert.ok(task2140);
  const task2140Files = Object.fromEntries(task2140.files.map(file => [file.path, file]));
  assert.equal(task2140Files[path].sha256, hash);
  assert.equal(task2140Files[sourcePath].sha256,
    createHash('sha256').update(readFileSync(resolve(root, sourcePath))).digest('hex'));
  assert.equal(task2140Files[testPath].sha256, testHash);
});

test('Ocean mit source: Zeile sichtbar, übrige Anzeige identisch zu BACH', async () => {
  const state = await render(list(ocean));
  assert.deepEqual(state['uc-source'], ['Herkunft: ellmos-tests · Datenstand: 22.6.2026 · Prüfstatus aus Score abgeleitet · Nur Lesezugriff', false]);
  const strip = ({'uc-source': _s, 'uc-page-status': _p, 'uc-check-all': _a, 'uc-create': _c,
    'uc-edit': _e, 'uc-check': _k, 'uc-delete': _d, ...rest}) => rest;
  assert.deepEqual(strip(state), strip(await render(list())));
});

test('Ungültige Ocean-Quelle bleibt sichtbar gesperrt, ohne Quelltext offenzulegen', async () => {
  const state = await render(list({id: 'ellmos-tests', generated_at: 'gestern'}));
  assert.deepEqual(state['uc-source'], ['Quelle nicht verifiziert; Änderungen deaktiviert', false]);
  assert.equal(state['uc-list-error'][1], true);
  assert.deepEqual(state['uc-create'], ['', true]);
  assert.match(state['uc-page-status'][0], /nicht verifiziert/);
});
