import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const page = readFileSync(new URL('src/pages/life.astro', root), 'utf8');

const paneStart = page.indexOf('<div class="tab-pane" id="pane-finanzen">');
const paneEnd = page.indexOf('<!-- TAB 6: LEBENSBEREICHE -->', paneStart);
const financePane = paneStart !== -1 && paneEnd !== -1 ? page.slice(paneStart, paneEnd) : '';

const fnStart = page.indexOf('async function loadFinanceSummary(');
const fnEnd = page.indexOf('function setupTabs(', fnStart);
const loaderBody = fnStart !== -1 && fnEnd !== -1 ? page.slice(fnStart, fnEnd) : '';

test('Finance pane exposes measured finance-summary container and status element', () => {
  assert.ok(financePane.length > 0, 'pane-finanzen block should exist');
  assert.match(financePane, /id="finance-summary-status"/);
  assert.match(financePane, /id="finance-summary"[^>]*data-source="measured"/);
});

test('life page calls lifeApiFetch for /api/financial/summary on finance tab', () => {
  assert.ok(loaderBody.includes("lifeApiFetch('/api/financial/summary')"));
  assert.ok(page.includes("if (tab === 'finanzen') loadFinanceSummary();"));
});

test('Finance loader contains all three German status texts', () => {
  assert.ok(loaderBody.includes('Lade Finanzübersicht …'));
  assert.ok(loaderBody.includes('Für die erfassten Zeiträume liegen noch keine Finanzdaten vor.'));
  assert.ok(loaderBody.includes('Finanzübersicht nicht erreichbar. Das Finanzmodul unter /financial bleibt nutzbar.'));
});

test('Finance loader does not log response data to console', () => {
  assert.ok(loaderBody.length > 0, 'loadFinanceSummary function should exist');
  assert.doesNotMatch(loaderBody, /console\.log\s*\(/);
  const consoleCalls = loaderBody.match(/console\.\w+\s*\([^)]*\)/g) || [];
  assert.deepEqual(consoleCalls, ["console.error('[life] finance summary unavailable')"]);
});
