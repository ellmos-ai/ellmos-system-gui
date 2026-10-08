import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {KEEP_BINDING, assignmentCatalogue, assignmentOptions, assignmentPayload, createAssignmentController, taskResponseError} from '../src/lib/task-assignment.mjs';

const slot = {id:'slot:synthetic-worker', type:'system-slot', name:'Lokaler Testworker', slot_id:'synthetic-worker',
  model:'synthetic-model', backend:'ollama', enabled:true, living:true, running:false, runtime_verified:false, assignable:true,
  binding:{assigned_slot:'synthetic-worker', assigned_to:'synthetic-agent', required_model:'synthetic-model'}};
const body = (targets = [slot], version = 'version-one') => ({schema:'bach.task-assignees.v1',
  source:'native_control_and_blueprints', configuration_version:version, targets});
const catalogue = () => assignmentCatalogue(body());

test('the canonical binding and catalogue CAS version are copied exactly', () => {
  assert.deepEqual(assignmentPayload(catalogue(), slot.id), {...slot.binding, assignment_configuration_version:'version-one'});
});

test('missing or ambiguous catalogue contracts fail closed', () => {
  for (const invalid of [null, {}, {...body(),schema:'legacy'}, {...body(),configuration_version:''},
    {...body(),source:'other'}, body([slot,slot])]) assert.throws(() => assignmentCatalogue(invalid), /Backendvertrag|Zielkatalog/);
});

test('disabled, unassignable and inconsistent targets cannot create a binding', () => {
  for (const patch of [{assignable:false}, {enabled:false}, {slot_id:'different'},
    {binding:{...slot.binding, required_model:'different'}}, {binding:{assigned_slot:'synthetic-worker'}}]) {
    const c = assignmentCatalogue(body([{...slot,...patch}]));
    assert.equal(c.targets[0].assignable,false);
    assert.throws(() => assignmentPayload(c,slot.id), /nicht zuweisbar/);
    assert.equal(assignmentOptions(c).at(-1).disabled,true);
  }
});

test('a blueprint without an instance remains visible but disabled', () => {
  const c = assignmentCatalogue(body([{id:'blueprint:7',type:'blueprint',blueprint_id:7,
    name:'Testblueprint',enabled:true,assignable:false,reason:'blueprint_requires_instance'}]));
  assert.match(assignmentOptions(c).at(-1).label,/Instanz erforderlich/);
  assert.equal(assignmentOptions(c).at(-1).disabled,true);
  assert.throws(() => assignmentPayload(c,'blueprint:7'),/nicht zuweisbar/);
});

test('the real BACH integer blueprint DTO with a current instance stays selectable', async () => {
  const binding={assigned_slot:'system-blueprint-7',assigned_to:'OLLAMA',required_model:'synthetic-model'};
  const instance={...slot,id:'slot:system-blueprint-7',slot_id:'system-blueprint-7',blueprint_id:7,
    blueprint_version:'1.0.0',runtime_verified:true,binding};
  // project_targets keeps SQLite blueprint_id as integer and projects a current instance binding.
  const blueprint={...instance,id:'blueprint:7',type:'blueprint',name:'Aktueller Testblueprint',reason:''};
  for (const blueprint_id of [7,'7']) {
    const dto=body([instance,{...blueprint,blueprint_id}]);
    const c=assignmentCatalogue(dto);
    assert.equal(c.targets[1].assignable,true);
    assert.equal(assignmentOptions(c).find(option=>option.value==='blueprint:7').disabled,false);
    assert.deepEqual(assignmentPayload(c,'blueprint:7'),{...binding,assignment_configuration_version:'version-one'});
    const h=harness(async()=>ok(dto));await h.controller.reload(binding);
    assert.equal(h.select.value,KEEP_BINDING);
    assert.doesNotMatch(h.select.options[0].textContent,/Nicht verfügbar/);
    h.select.value='blueprint:7';h.select.handlers.change();
    assert.equal(h.assignee.value,'OLLAMA');assert.equal(h.model.value,'synthetic-model');
    assert.deepEqual(h.controller.payload(),{...binding,assignment_configuration_version:'version-one'});
  }
});

test('invalid, negative and noncanonical blueprint IDs are rejected', () => {
  for (const blueprint_id of [-7,0,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,true,null,{},[],
    '', '-7','0','07',' 7','7 ','+7','7.0','7e0','NaN','Infinity','synthetic','9007199254740992']) {
    assert.throws(()=>assignmentCatalogue(body([{...slot,id:'blueprint:'+String(blueprint_id),
      type:'blueprint',blueprint_id}])),/ungültige ID/,String(blueprint_id));
  }
  const mismatched=assignmentCatalogue(body([{...slot,id:'blueprint:8',type:'blueprint',blueprint_id:7}]));
  assert.equal(mismatched.targets[0].assignable,false);
  assert.throws(()=>assignmentPayload(mismatched,'blueprint:8'),/nicht zuweisbar/);
});

test('an unknown current slot is preserved visibly and deletion needs current CAS', () => {
  const current = {assigned_slot:'retired-slot',assigned_to:'old-agent',required_model:'old-model'};
  const row = assignmentOptions(null,current)[0];
  assert.equal(row.value,KEEP_BINDING); assert.match(row.label,/retired-slot.*Nicht verfügbar/);
  assert.deepEqual(assignmentPayload(null,KEEP_BINDING,current),{});
  assert.throws(() => assignmentPayload(null,'',current),/neu geladen/);
  assert.deepEqual(assignmentPayload(catalogue(),'',current),{assigned_slot:'',assignment_configuration_version:'version-one'});
  assert.deepEqual(assignmentPayload(null,'',{}),{});
});

test('configured targets do not pretend runtime readiness and conflicts request a new choice', () => {
  assert.match(assignmentOptions(catalogue()).at(-1).label,/Live-Status nicht bestätigt/);
  assert.doesNotMatch(assignmentOptions(catalogue()).at(-1).label,/Ready|Bereit/);
  assert.match(taskResponseError({detail:{message:'Version geändert'}},409),/Version geändert.*neu laden/);
});

function harness(fetchImpl, options={}) {
  function field(value='') {return {value,disabled:false,readOnly:false,options:[],handlers:{},
    addEventListener(type,handler){this.handlers[type]=handler;},
    replaceChildren(){this.options=[];},append(option){this.options.push(option);}};}
  const select=field(),assignee=field('user'),model=field(),note={textContent:''},reload=field();
  assignee.options=[{value:'user'}];
  const form={elements:{assigned_to:assignee,required_model:model},ownerDocument:{createElement:()=>({})},
    querySelector:query=>({'[data-task-target]':select,'[data-task-target-status]':note,'[data-task-target-reload]':reload})[query]};
  const controller=createAssignmentController(form,{fetchImpl,...options});
  return {controller,select,assignee,model,note};
}
const ok = value => ({ok:true,json:async()=>value});

test('the form preserves unknown bindings even when catalogue fetch fails', async () => {
  const h=harness(async()=>({ok:false,status:404}));
  await h.controller.reload({assigned_slot:'retired-slot',assigned_to:'old-agent',required_model:'old-model'});
  assert.equal(h.select.value,KEEP_BINDING); assert.match(h.select.options[0].textContent,/Nicht verfügbar/);
  assert.equal(h.assignee.value,'old-agent'); assert.equal(h.assignee.disabled,true); assert.equal(h.model.readOnly,true);
  assert.deepEqual(h.controller.payload(),{});
});

test('the form locks canonical fields and a CAS conflict never silently retries', async () => {
  const h=harness(async()=>ok(body())); await h.controller.reload();
  h.select.value=slot.id; h.select.handlers.change();
  assert.equal(h.assignee.value,'synthetic-agent'); assert.equal(h.assignee.disabled,true);
  assert.equal(h.model.value,'synthetic-model'); assert.equal(h.model.readOnly,true);
  assert.deepEqual(h.controller.payload(),{...slot.binding,assignment_configuration_version:'version-one'});
  h.controller.invalidate(); assert.throws(()=>h.controller.payload(),/Neu laden/);
  await h.controller.reload(); assert.equal(h.select.value,'');
  assert.equal(h.assignee.disabled,false);
});

test('a late older catalogue response cannot overwrite the newer version', async () => {
  let resolveOld, calls=0;
  const old = new Promise(resolve=>{resolveOld=resolve;});
  const h=harness(async()=>++calls===1 ? old : ok(body([slot],'version-two')));
  const first=h.controller.reload(); await h.controller.reload();
  resolveOld(ok(body())); await first;
  h.select.value=slot.id; h.select.handlers.change();
  assert.equal(h.controller.payload().assignment_configuration_version,'version-two');
});

test('personal tasks keep manual assignment while native selection stays disabled', async () => {
  let calls=0; const h=harness(async()=>{calls++;return ok(body());},{fixedAssignee:true}); await h.controller.reload();
  assert.equal(calls,0);assert.equal(h.select.disabled,true);
  h.assignee.value='user';h.model.value='';
  assert.deepEqual(h.controller.payload(),{assigned_to:'user'});
});

test('both task forms use the shared controller and readback excludes request-only CAS', () => {
  const files=['src/components/TaskCreateForm.astro','src/pages/tasks.astro'];
  for (const name of files) {
    const source=readFileSync(new URL('../'+name,import.meta.url),'utf8');
    assert.match(source,/data-task-target/);assert.match(source,/createAssignmentController/);
    assert.doesNotMatch(source,/<input[^>]*name="assigned_slot"/);
    assert.match(source,/assignment_configuration_version/);
    assert.match(source,/agenten\/blueprints/);
    for (const match of source.matchAll(/<script>([\s\S]*?)<\/script>/g))
      new vm.Script(match[1].replace(/^\s*import[^;]+;/gm,''));
  }
});
