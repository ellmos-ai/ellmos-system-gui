import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const page = readFileSync(new URL('src/pages/life.astro', root), 'utf8');

const paneStart = page.indexOf('<div class="tab-pane" id="pane-finanzen">');
const paneEnd = page.indexOf('<!-- TAB 6: LEBENSBEREICHE -->', paneStart);
const financePane = paneStart !== -1 && paneEnd !== -1 ? page.slice(paneStart, paneEnd) : '';

const fnStart = page.indexOf('async function loadFinanceSummary(');
const fnEnd = page.indexOf('function setupTabs(', fnStart);
const loaderBody = fnStart !== -1 && fnEnd !== -1 ? page.slice(fnStart, fnEnd) : '';

test('Finance pane marks its data as unchecked before reading the backend', () => {
  assert.ok(financePane.length > 0, 'pane-finanzen block should exist');
  assert.match(financePane, /id="finance-summary-status"/);
  assert.match(financePane, /id="finance-summary"[^>]*data-source="unchecked"/);
});

test('life page calls lifeApiFetch for /api/financial/summary on finance tab', () => {
  assert.ok(loaderBody.includes("lifeApiFetch('/api/financial/summary')"));
  assert.ok(page.includes("if (tab === 'finanzen') loadFinanceSummary();"));
});

test('Finance loader contains all three German status texts', () => {
  assert.ok(loaderBody.includes('Lade Finanzübersicht …'));
  assert.ok(loaderBody.includes('Für die erfassten Zeiträume liegen noch keine Finanzdaten vor.'));
  assert.ok(loaderBody.includes('Die Finanzquelle hat keine verlässliche Übersicht geliefert.'));
});

test('Finance loader does not log response data to console', () => {
  assert.ok(loaderBody.length > 0, 'loadFinanceSummary function should exist');
  assert.doesNotMatch(loaderBody, /console\.\w+\s*\(/);
});

test('category column shows name and measured amount pairs', () => {
  const start = page.indexOf('function financeCategoryText(');
  const end = page.indexOf('async function loadFinanceSummary(', start);
  assert.ok(start !== -1 && end !== -1, 'financeCategoryText should exist before the loader');
  const categoryText = vm.runInNewContext('(' + page.slice(start, end).trim() + ')');
  const fmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  assert.equal(categoryText('{}', fmt), '–');
  assert.equal(categoryText('not json', fmt), '–');
  assert.equal(categoryText(null, fmt), '–');
  assert.equal(categoryText('[1, 2]', fmt), '–');
  assert.equal(categoryText('{"fehlt": null}', fmt), '–');
  const text = categoryText('{"Software": 12.5, "Buero": 40}', fmt);
  assert.equal(text, `Buero: ${fmt.format(40)} · Software: ${fmt.format(12.5)}`);
  assert.doesNotMatch(text, /[{}"]/);
  assert.ok(loaderBody.includes('financeCategoryText(item.summen_kategorie, eurFmt)'));
});

function financeHarness(responses) {
  class Element {
    children = [];
    style = {};
    dataset = {};
    textContent = '';
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
  }
  const summary = new Element(), status = new Element();
  const elements = {'finance-summary': summary, 'finance-summary-status': status};
  const context = vm.createContext({
    document: {getElementById: id => elements[id], createElement: () => new Element()},
    lifeApiFetch: async () => ({ok: true, json: () => responses.shift()}),
  });
  const start = page.indexOf('let _financeSummaryLoaded');
  vm.runInContext(page.slice(start, fnEnd), context);
  return {load: context.loadFinanceSummary, summary, status};
}

test('unavailable sources and partial rows never render zero; the next request can show measured zero', async () => {
  const schema = 'bach.financial_summary.v1';
  const row = {jahr: 2026, monat: 11, summen_kategorie: '{}', total_ausgaben: 0,
    total_abos: 0, total_steuer_relevant: 0, anzahl_rechnungen: 0, anzahl_abos: 0};
  const valid = {schema, status: 'ok', data_source: 'measured', source_checked: true,
    duplicate_subscription_rows: 0, summaries: [row, {...row, monat: null}]};
  const {load, summary, status} = financeHarness([
    {schema, status: 'unavailable', data_source: 'unavailable', summaries: []},
    {...valid, source_checked: undefined},
    {...valid, summaries: [{...row, total_ausgaben: null}]}, valid,
  ]);
  for (let i = 0; i < 3; i++) {
    await load();
    assert.equal(summary.dataset.source, 'unavailable');
    assert.deepEqual(summary.children, []);
    assert.match(status.textContent, /keine verlässliche Übersicht/);
  }
  await load();
  assert.equal(summary.dataset.source, 'measured');
  assert.equal(status.textContent, '');
  const [monthly, annual] = summary.children[0].children[1].children;
  assert.equal(monthly.children[0].textContent, '11/2026');
  assert.equal(monthly.children[2].textContent, new Intl.NumberFormat('de-DE', {style: 'currency', currency: 'EUR'}).format(0));
  assert.equal(annual.children[0].textContent, '2026 bis heute');
});
