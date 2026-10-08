import test from 'node:test';
import assert from 'node:assert/strict';
import {readTaskFilters,taskFilterQuery,writeTaskFilters,readTaskPage,taskCountLabel} from '../src/lib/task-filters.mjs';
test('personal and automated assignment combine independently with every status and priority',()=>{
  for(const assignment of ['all','user','auto','unassigned']) for(const status of ['open','done','all']) {
    const filters={assignment,status,priority:'P2'};
    const first=taskFilterQuery(filters,0), next=taskFilterQuery(filters,100);
    assert.equal(first.get('assignment_group'),assignment);
    assert.equal(first.get('status'),status==='open'?'nonterminal':status);
    assert.equal(first.get('priority'),'P2');
    assert.equal(next.get('offset'),'100');
    for(const key of ['assignment_group','status','priority'])assert.equal(next.get(key),first.get(key));
  }
});
test('links, refresh and reset preserve independent selections and task deep links',()=>{
  assert.deepEqual(readTaskFilters('?assigned_to=user'),{assignment:'user',status:'open',priority:''});
  const filters={assignment:'user',status:'done',priority:'P1'};
  const url=writeTaskFilters('http://localhost/tasks?task=17&offset=100',filters);
  assert.equal(url.searchParams.get('task'),'17');assert.equal(url.searchParams.has('offset'),false);
  assert.deepEqual(readTaskFilters(url.search),filters);
  assert.deepEqual(readTaskFilters('?status=completed&assignment_group=auto'),{assignment:'auto',status:'done',priority:''});
});
test('count describes the whole filtered result before pagination',()=>{
  const filters={assignment:'user',status:'open',priority:''};
  const rows=Array.from({length:100},(_,id)=>({id}));
  const page=readTaskPage({success:true,tasks:rows,total:120,has_more:true,applied_filters:{assignment_group:'user'}},filters);
  assert.equal(page.total,120);assert.equal(page.hasMore,true);
  assert.equal(taskCountLabel(100,page.total,0),'1–100 von 120 passenden Aufgaben');
  assert.equal(taskCountLabel(20,page.total,100),'101–120 von 120 passenden Aufgaben');
  assert.equal(taskCountLabel(0,0,0),'0 von 0 passenden Aufgaben');
  assert.throws(()=>readTaskPage({success:true,tasks:rows,total:100},filters),/kombinierte Zuordnung/);
});
