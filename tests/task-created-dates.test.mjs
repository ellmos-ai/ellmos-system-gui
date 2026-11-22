import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readTaskFilters, taskFilterQuery, writeTaskFilters, readTaskPage} from '../src/lib/task-filters.mjs';
import {isTaskCalendarDate, taskCreatedDate} from '../src/lib/task-created-date.mjs';

test('calendar validation and display preserve the recorded day without timezone conversion', () => {
  for (const day of ['2024-02-29','0001-01-01','9999-12-31']) assert.equal(isTaskCalendarDate(day), true);
  for (const day of ['2026-02-29','2026-11-31','0000-01-01','2026-1-01','bad']) assert.equal(isTaskCalendarDate(day), false);
  assert.equal(taskCreatedDate('2026-11-17T00:05:00+14:00').label, '17.11.2026, 00:05');
  assert.equal(taskCreatedDate('2026-11-17 23:59:59.999999-10:00').label, '17.11.2026, 23:59');
  assert.equal(taskCreatedDate('2024-02-29').label, '29.02.2024');
  assert.equal(taskCreatedDate('0001-01-01').label, '01.01.0001');
  for (const value of [null, '', 'not-a-date', '2026-02-30T10:00:00', '2026-11-17T25:00:00', '2026-11-17<script>'])
    assert.equal(taskCreatedDate(value), null);
});

test('date range and sorting persist in links and every server page', () => {
  const filters = readTaskFilters('?created_from=2026-11-16&created_to=2026-11-17&sort=created_desc&status=review');
  assert.equal(filters.createdFrom, '2026-11-16');
  assert.equal(filters.createdTo, '2026-11-17');
  assert.equal(filters.sort, 'created_desc');
  const first = taskFilterQuery(filters,0), next = taskFilterQuery(filters,100);
  for (const key of ['created_from','created_to','sort','status'])
    assert.equal(first.get(key),next.get(key));
  assert.equal(next.get('offset'),'100');
  const url = writeTaskFilters('http://localhost/tasks?task=17&offset=100',filters);
  assert.equal(url.searchParams.get('task'),'17');
  assert.equal(url.searchParams.has('offset'),false);
  assert.deepEqual(readTaskFilters(url.search),filters);
  const reset = writeTaskFilters(url.href,readTaskFilters(''));
  assert.equal(reset.searchParams.has('created_from'),false);
  assert.equal(reset.searchParams.has('created_to'),false);
  assert.equal(readTaskFilters('').sort,'priority');
});

test('invalid filter inputs fail before loading a misleading page', () => {
  for (const search of ['?created_from=2026-02-29','?created_to=2026-1-01',
    '?created_from=2026-11-18&created_to=2026-11-17','?sort=unknown']) {
    assert.throws(() => taskFilterQuery(readTaskFilters(search)), /Datum|Zeitraum|Sortierung/);
  }
});

test('backend receipt is required for date and sort selections', () => {
  const filters = readTaskFilters('?created_from=2026-11-17&created_to=2026-11-17&sort=created_desc');
  const data = {success:true,tasks:[{id:1}],total:1,has_more:false,
    applied_filters:{status:'nonterminal',assignment_group:'all',q:'',
      created_from:'2026-11-17',created_to:'2026-11-17',sort:'created_desc',
      created_date_semantics:'stored_calendar'}};
  assert.equal(readTaskPage(data,filters).tasks[0].id,1);
  for (const key of ['created_from','created_to','sort','created_date_semantics']) {
    const broken={...data,applied_filters:{...data.applied_filters}};
    delete broken.applied_filters[key];
    assert.throws(() => readTaskPage(broken,filters), /Datumsfilter|Sortierung/);
  }
  assert.throws(() => readTaskPage({...data,applied_filters:{...data.applied_filters,created_to:'2026-11-18'}},filters), /Datumsfilter/);
  assert.throws(() => readTaskPage({...data,applied_filters:{...data.applied_filters,sort:'priority'}},filters), /Sortierung/);
});

test('task board exposes date column, labelled range controls and server sort options', () => {
  const page=readFileSync(new URL('../src/pages/tasks.astro',import.meta.url),'utf8');
  for (const id of ['tasks-created-from','tasks-created-to','tasks-sort']) assert.ok(page.includes('id="'+id+'"'));
  for (const value of ['priority','created_desc','created_asc']) assert.ok(page.includes('value="'+value+'"'));
  assert.match(page, /<th[^>]*>Erstellt<\/th>/);
  assert.match(page, /taskCreatedDate\(t\.created_at\)/);
  assert.match(page, /currentOffset = 0/);
  assert.match(page, /createdFrom/);
  assert.match(page, /createdTo/);
});
