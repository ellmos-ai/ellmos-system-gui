import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const tasks = read('src/pages/tasks.astro');
const routines = read('src/pages/routinen.astro');
const reads = JSON.parse(read('public/page-reads.v1.json'));

test('task status stays a compact badge and blocked tasks remain in the list', () => {
  assert.match(tasks, /data-task-status=/);
  assert.match(tasks, /statusLabel = status =>/);
  assert.match(tasks, /blocked:'Blockiert'/);
  assert.match(tasks, /task-board-layout/);
  assert.match(tasks, /classList\.add\('is-open'\)/);
  assert.match(tasks, /classList\.remove\('is-open'\)/);
});

test('task details use a responsive side-panel layout', () => {
  assert.match(tasks, /task-board-layout\.is-open \{grid-template-columns:minmax\(0,1fr\) minmax\(19rem,26rem\)/);
  assert.match(tasks, /position:sticky/);
  assert.match(tasks, /@media\(max-width:900px\)/);
});

test('Routinen & Jobs presents one filtered list with explicit source boundaries', () => {
  for (const label of ['BACH', 'Ocean', 'Modul', 'Life · persönlich', 'Planung', 'Nächster Lauf', 'Letzter Lauf', 'Run-Schalter', 'Wartungsherkunft'])
    assert.match(routines, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(routines, /id="routine-source-filter"/);
  assert.match(routines, /id="routine-kind-filter"/);
  assert.match(routines, /Adapter nicht verfügbar/);
  assert.match(routines, /Keine Jobs aus einer bestätigten Quelle verfügbar/);
  assert.match(routines, /fetch\('\/api\/routines'/);
  assert.match(routines, /\/api\/routines\/\$\{encodeURIComponent\(id\)\}\/complete/);
  assert.match(routines, /button\.disabled = true/);
});

test('Routinen page reads are declared and the old personal Life route stays available', () => {
  assert.ok(reads.pages['/routinen']);
  assert.deepEqual(reads.pages['/routinen'].map(item => `${item.method} ${item.path}`), [
    'GET /api/routines',
    'POST /api/routines/{id}/complete',
  ]);
  assert.ok(read('src/pages/life.astro').includes('/api/routines'));
});
