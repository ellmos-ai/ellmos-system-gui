import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {scan} from '../scripts/page-reads-scan.mjs';

// Every API call the pages make must exist in the backend route snapshot (tests/fixtures/backend-routes.v1.json, written by
// BACH tools/export_gui_route_snapshot.py). B-02: /chat posted to /api/chat/send, a route the backend never had.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const snapshot = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/backend-routes.v1.json'), 'utf8'));
const routes = new Set(snapshot.routes);

// Findings that predate PB-2: calls without a backend route (or composed paths the scanner cannot resolve).
// Each one is a bug or an optional feature of its own; the list may only shrink (a fixed entry must be removed).
const KNOWN_MISSING = new Map([
  ['POST /api/fackel', 'Header.astro: Fackel-Schalter, kein Backend-Pfad (Befund)'],
  ['POST /api/slots', 'Header.astro: Slots anlegen, kein Backend-Pfad (Befund)'],
  ['GET /api/agent-triggers', 'agent-triggers.mjs: Backend-Pfad fehlt (Befund)'],
  ['POST /api/system/workers/{}/{}', 'running.astro: Aktionspfad zusammengesetzt, vom Scanner nicht aufgelöst'],
  ['GET {}', 'zusammengesetzter Pfad ohne /api/-Kopf (blueprint-studio, daemon-chains): Scanner löst ihn nicht auf'],
  ['PUT {}', 'daemon-chains: wie oben'], ['PUT {}/toggle', 'daemon-chains: wie oben'], ['DELETE {}', 'daemon-chains: wie oben'],
  ['POST {}/run', 'daemon-chains: wie oben'], ['GET {}/runs', 'daemon-chains: wie oben'],
  ['null /api/agent-triggers', 'agent-triggers.mjs: Methode vom Scanner nicht bestimmt'], ['null {}', 'agent-triggers.mjs: wie oben'],
]);

function calls() {
  const found = scan(root), seen = new Map();
  const add = c => { const key = `${c.method} ${c.pattern}`; if (!seen.has(key)) seen.set(key, `${c.file}:${c.line}`); };
  found.calls.layout.forEach(add);
  Object.values(found.calls.pages).forEach(list => list.forEach(add));
  return seen;
}

test('every API call in the pages exists in the backend route snapshot', () => {
  const missing = [...calls()].filter(([key]) => !routes.has(key) && !KNOWN_MISSING.has(key)).map(([key, where]) => `${key} (${where})`);
  assert.deepEqual(missing, []);
});

test('the known-missing list holds no entry that is fixed or no longer called', () => {
  const seen = calls();
  const stale = [...KNOWN_MISSING.keys()].filter(key => !seen.has(key) || routes.has(key));
  assert.deepEqual(stale, []);
});

test('negative control: the invented chat route is not in the snapshot, the real one is', () => {
  assert.equal(routes.has('POST /api/chat/send'), false);
  assert.equal(routes.has('POST /api/chat-control/chat'), true);
});
