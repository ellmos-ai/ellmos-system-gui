import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateQueueStatus,createQueueDetails,appendQueueDetails} from '../src/lib/worker-queue-ui.mjs';

const empty={schema:'bach.worker-queue.v1',source:'canonical_task_api',authority_mode:'local',
  state:'waiting',reason:'empty_queue',observed_at:'2026-10-10T03:00:00+00:00',scan_complete:true,
  candidate_count:0,matched_count:0,attempted_count:0,scanned_pages:1,rejected_counts:{}};
const excluded={...empty,reason:'selection_excluded',candidate_count:154,
  rejected_counts:{explicit_slot_required:154},scanned_pages:2};
const denied={...empty,reason:'acquire_denied',candidate_count:2,matched_count:1,attempted_count:1,
  rejected_counts:{ownership:1,not_claimable:1}};
const acquired={...empty,state:'acquired',reason:'task_acquired',candidate_count:1,matched_count:1,
  attempted_count:1,scan_complete:false,scanned_pages:0,selected_task_id:42};

class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.handlers={};this.open=false;this._text='';this.className='';}
  set textContent(text){this._text=String(text);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  addEventListener(name,fn){this.handlers[name]=fn;}
  remove(){this.parent.children=this.parent.children.filter(child=>child!==this);}
  querySelectorAll(selector){return this.children.flatMap(child=>[
    ...(selector==='.'+child.className.split(' ')[0]?[child]:[]),...child.querySelectorAll(selector)]);}
}
const document={createElement:tag=>new Element(tag)};

test('canonical observations validate without private fields',()=>{
  for(const fixture of [empty,excluded,denied,acquired,{...denied,scan_complete:false,rejected_counts:{ownership:1,conflict:1}},
    {...acquired,authority_mode:'remote'}, {...empty,state:'error',reason:'selection_error',scan_complete:false,scanned_pages:0}])
    assert.deepEqual(validateQueueStatus(fixture),fixture);
  const value=validateQueueStatus({...acquired,task_prompt:'private',lease_id:'private',holder:'private'});
  assert.equal(value.selected_task_id,42);assert.doesNotMatch(JSON.stringify(value),/private/);
});

test('invalid schemas, types, state pairs, pages and rejection totals fail closed',()=>{
  for(const fixture of [null,[],{...empty,schema:'fake'},{...empty,state:['waiting']},{...empty,state:'acquired'},
    {...empty,reason:'task_acquired'},{...empty,candidate_count:true},{...empty,observed_at:'2026-10-10T03:00:00'},
    {...empty,scanned_pages:0},{...empty,scanned_pages:2},{...excluded,rejected_counts:{}},
    {...denied,rejected_counts:{ownership:2}},{...denied,attempted_count:0},
    {...acquired,candidate_count:2},{...acquired,selected_task_id:'42'},
    {...denied,rejected_counts:{unknown:2}},{...acquired,scan_complete:true}])assert.equal(validateQueueStatus(fixture),null);
});

test('collapsed receipt gives specific waiting reasons, counts and source time',()=>{
  const details=createQueueDetails(document,excluded);
  assert.equal(details.tagName,'details');assert.equal(details.open,false);
  assert.match(details.children[0].textContent,/Letzte Aufgabenauswahl: Kandidaten durch Auswahl ausgeschlossen/);
  assert.match(details.textContent,/154 Kandidaten/);assert.match(details.textContent,/Ausdrückliche Slotzuordnung fehlt: 154/);
  assert.match(details.textContent,/lokale Autorität/);assert.match(details.textContent,/kein Nachweis aktueller Inferenz/);
  const time=details.children[1].children[0];assert.equal(time.tagName,'time');assert.equal(time.dateTime,empty.observed_at);
});

test('a read or projection failure never becomes an empty or active queue',()=>{
  assert.equal(createQueueDetails(document,null).textContent,'Aufgabenauswahl nicht bestätigt');
  assert.equal(createQueueDetails(document,null,{available:false}).textContent,'Aufgabenauswahl nicht verfügbar');
  const failure=createQueueDetails(document,{...empty,state:'error',reason:'selection_error',scan_complete:false});
  assert.match(failure.textContent,/Auswahl fehlgeschlagen/);assert.doesNotMatch(failure.textContent,/Queue ist leer|RUNNING/);
});

test('only validated numeric task IDs become a same-origin task link',()=>{
  const node=createQueueDetails(document,{...acquired,task_prompt:'<script>bad()</script>',reason_text:'<img src=x>'});
  const link=node.children.find(child=>child.tagName==='a');
  assert.equal(link.href,'/tasks?task=42');assert.equal(link.textContent,'Task #42');
  assert.doesNotMatch(node.textContent,/script|img/);
  const source=readFileSync(new URL('../src/lib/worker-queue-ui.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/innerHTML|insertAdjacentHTML|fetch\(|localStorage|clipboard/);
});

test('refresh preserves user expansion and replaces old receipts with unknown',()=>{
  const card=new Element('article');
  appendQueueDetails(document,card,denied,{key:'test-worker'});
  card.children[0].open=true;card.children[0].handlers.toggle();
  appendQueueDetails(document,card,acquired,{key:'test-worker'});
  assert.equal(card.children.length,1);assert.equal(card.children[0].open,true);
  appendQueueDetails(document,card,null,{key:'test-worker',available:false});
  assert.equal(card.children.length,1);assert.equal(card.textContent,'Aufgabenauswahl nicht verfügbar');
});

test('Buddha card consumes the verified native worker snapshot, not saved configuration',()=>{
  const page=readFileSync(new URL('../src/pages/agenten/running.astro',import.meta.url),'utf8');
  const start=page.indexOf('function renderCoreQueueDiagnostics('),end=page.indexOf('function workerReadiness(',start);
  const card=new Element('article');card.dataset.coreAgentId='buddha_always_on';
  const context={document:{...document,querySelectorAll:()=>[card]},workerQueueAvailable:true,
    workerQueueSnapshots:new Map([['buddha_always_on',{runtime_verified:true,system:true,queue_status:excluded}]]),
    window:{BachWorkerQueue:{appendQueueDetails}}};
  const render=vm.runInNewContext('('+page.slice(start,end).trim()+')',context);render();
  assert.match(card.textContent,/Slotzuordnung fehlt: 154/);
  context.workerQueueSnapshots=new Map([['buddha_always_on',{runtime_verified:false,system:true,queue_status:excluded}]]);render();
  assert.equal(card.textContent,'Aufgabenauswahl nicht bestätigt');
  context.workerQueueAvailable=false;context.workerQueueSnapshots=new Map();render();
  assert.equal(card.textContent,'Aufgabenauswahl nicht verfügbar');
});

test('missing or reclassified non-Buddha system workers cannot retain an old receipt',()=>{
  const page=readFileSync(new URL('../src/pages/agenten/running.astro',import.meta.url),'utf8');
  const start=page.indexOf('function renderCoreQueueDiagnostics('),end=page.indexOf('function workerReadiness(',start);
  const card=new Element('article');card.dataset.coreAgentId='another-system-worker';
  const context={document:{...document,querySelectorAll:()=>[card]},workerQueueAvailable:true,
    workerQueueSnapshots:new Map([['another-system-worker',{runtime_verified:true,system:true,queue_status:denied}]]),
    window:{BachWorkerQueue:{appendQueueDetails}}};
  const render=vm.runInNewContext('('+page.slice(start,end).trim()+')',context);render();
  assert.match(card.textContent,/Übernahme nicht bestätigt/);
  context.workerQueueAvailable=false;context.workerQueueSnapshots=new Map();render();
  assert.equal(card.textContent,'Aufgabenauswahl nicht verfügbar');
  context.workerQueueAvailable=true;render();assert.equal(card.textContent,'Aufgabenauswahl nicht bestätigt');
  context.workerQueueSnapshots=new Map([['another-system-worker',{runtime_verified:true,system:false,queue_status:acquired}]]);render();
  assert.equal(card.textContent,'Aufgabenauswahl nicht bestätigt');
});
