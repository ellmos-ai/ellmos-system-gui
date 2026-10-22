import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validatePublicTaskLease, leaseCountdown, sortTaskLeaseRows, loadTaskLeaseRows}
  from '../src/lib/task-lease-panel.mjs';

const version = 'a'.repeat(64);
const task = {id:42, title:'Manuell übernommene Aufgabe', status:'in_progress', task_version:version, claim_fence:7};
const observed = {task_id:42, status:'in_progress', leased:true, legacy:false, fence:7,
  task_version:version, server_now:'2026-10-15T18:00:00+00:00', expires_at:'2026-10-15T18:05:00+00:00'};

test('public task and lease readbacks give a bounded countdown without a bearer ID', () => {
  const lease = validatePublicTaskLease(task, observed, 100000);
  assert.equal(lease.state, 'active');
  assert.equal(leaseCountdown(lease, 100000), '5 min 0 s');
  assert.equal(leaseCountdown(lease, 221000), null); // a stale observation is no longer a live claim
  assert.equal('lease_id' in lease, false);
  assert.equal('holder' in lease, false);
});

test('changed task revision, fence, foreign task, expired and capability-bearing replies fail closed', () => {
  for (const reply of [
    {...observed, task_id:43}, {...observed, task_version:'b'.repeat(64)},
    {...observed, fence:8}, {...observed, expires_at:observed.server_now},
    {...observed, lease_id:'private-secret'}, {...observed, own:true},
  ]) assert.equal(validatePublicTaskLease(task, reply, 100000).state, 'unavailable');
  assert.equal(validatePublicTaskLease({...task, task_version:'b'.repeat(64)}, observed).state, 'unavailable');
  assert.equal(validatePublicTaskLease(task, {...observed, leased:false}, 100000).state, 'unleased');
});

test('paged task reader includes manual claims, caps work and marks partial observations honestly', async () => {
  const urls = [];
  const fetcher = async url => {
    urls.push(url);
    if (url.startsWith('/api/tasks?')) return {ok:true, json:async () => ({success:true,
      applied_filters:{status:'in_progress,progress'}, tasks:[task], has_more:true})};
    return {ok:true, json:async () => observed};
  };
  const result = await loadTaskLeaseRows(fetcher, {maxPages:1, concurrency:1});
  assert.equal(result.rows[0].lease.state, 'active');
  assert.equal(result.partial, true); // more pages were explicitly not read
  assert.deepEqual(urls, ['/api/tasks?status=in_progress,progress&limit=100&offset=0', '/api/tasks/42/lease']);
  assert.ok(!JSON.stringify(result).includes('private-secret'));
  const bad = await loadTaskLeaseRows(async url => url.startsWith('/api/tasks?')
    ? {ok:true, json:async () => ({success:true, applied_filters:{status:'all'}, tasks:[task], has_more:false})}
    : {ok:true, json:async () => observed});
  assert.deepEqual(bad, {rows:[], partial:true, complete:false, scanned:0});
});

test('sorting uses verified deadlines; Agenten/Running no longer owns Task-Lease controls', () => {
  const lease = validatePublicTaskLease(task, observed, 100000);
  const rows = [{task:{id:1}, lease:{state:'unleased'}}, {task:{id:42}, lease}];
  assert.deepEqual(sortTaskLeaseRows(rows, true).map(row => row.task.id), [42,1]);
  const running = readFileSync(fileURLToPath(new URL('../src/pages/agenten/running.astro', import.meta.url)), 'utf8');
  const tasks = readFileSync(fileURLToPath(new URL('../src/pages/tasks.astro', import.meta.url)), 'utf8');
  assert.doesNotMatch(running, /running-lease-controls|appendLeaseCountdown/);
  assert.match(running, /Kein Agentenlauf aktiv\./);
  assert.match(tasks, /<TaskLeasePanel\s*\/>/);
});
