import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {
  buildCorrectionRequest, correctionAttemptMatchesView, createCorrectionAttempt,
  isCurrentCorrectionTarget, normalizeCorrectionNote, parseTaskResultMaxCharsInput, resultMaxCharsCreateChange,
  resultMaxCharsEditChange, resultOperatorCapabilities, supportsTaskResultMaxChars, taskResultMaxCharsReadback,
  transitionCorrectionAttempt, validateCorrectionAcknowledgement, validateResultHistoryPage
} from '../src/lib/task-result-contract.mjs';

const taskId = 23;
const version = 'a'.repeat(64);
const nextVersion = 'b'.repeat(64);
const resultHash = 'c'.repeat(64);
const requestId = '3b12f1df-5232-4804-897e-917bf397618a';
const correctionTarget = () => ({schema:'bach.task-result-readback.v1', task_id:taskId, verified:true,
  status:'review', status_revision:17, task_version:version,
  result:{schema:'bach.worker-result.v1', task_id:taskId, result:'Original', reason:'awaiting_review',
    accepted:false, result_id:41, result_sha256:resultHash, generation:'generation-9', fence:7001,
    task_version:version}});
const submitted = (event_id, extra={}) => ({event_id, type:'result_submitted', occurred_at:'2026-10-12T12:00:00Z',
  result:{result_id:41, result_sha256:resultHash, text:'Original result', generation:'generation-9', fence:7001,
    task_version:version, ...extra}});
const accepted = event_id => ({event_id, type:'result_accepted', occurred_at:'2026-10-12T12:01:00Z',
  result:{result_id:41, result_sha256:resultHash}});
const correction = (event_id, extra={}) => ({event_id, type:'correction_requested', occurred_at:'2026-10-12T12:02:00Z',
  correction:{correction_id:52, correction_round:1, source_result_id:41, source_result_sha256:resultHash,
    note:'Bitte die Kriterien ergänzen.', request_id:requestId, ...extra}});
const history = (events, patch={}) => ({schema:'bach.task-result-history.v1', task_id:taskId, events,
  next_before_event_id:null, has_more:false, ...patch});

test('result-length limits require the explicit capability DTO and preserve null versus omitted', () => {
  const capability={schema:'bach.task-capabilities.v1',result_max_chars:{supported:true,min:1,max:3000,nullable:true}};
  assert.equal(supportsTaskResultMaxChars(capability),true);
  for (const invalid of [null, {}, {schema:'bach.task-capabilities.v1',result_max_chars:{...capability.result_max_chars,supported:'true'}},
    {schema:'bach.task-capabilities.v1',result_max_chars:{...capability.result_max_chars,max:3001}},
    {schema:'bach.task-capabilities.v1',result_max_chars:{...capability.result_max_chars,extra:true}},
    {...capability,provider:'unexpected'}]) {
    assert.equal(supportsTaskResultMaxChars(invalid),false);
  }
  assert.deepEqual(taskResultMaxCharsReadback({id:taskId}),{supported:false,value:null});
  assert.deepEqual(taskResultMaxCharsReadback({id:taskId,result_max_chars:null}),{supported:true,value:null});
  assert.deepEqual(taskResultMaxCharsReadback({id:taskId,result_max_chars:3000}),{supported:true,value:3000});
  for (const value of [true, '300', 0, 3001, 1.5]) {
    assert.equal(taskResultMaxCharsReadback({result_max_chars:value}).supported,false);
  }
  assert.deepEqual(parseTaskResultMaxCharsInput(''),{valid:true,present:false,value:null});
  assert.deepEqual(parseTaskResultMaxCharsInput(' 1200 '),{valid:true,present:true,value:1200});
  for (const value of ['0','3001','1.5','1e3','Infinity']) {
    assert.equal(parseTaskResultMaxCharsInput(value).valid,false);
  }
  assert.deepEqual(parseTaskResultMaxCharsInput('  '),{valid:true,present:false,value:null});
  assert.equal(parseTaskResultMaxCharsInput(true).valid,false);
});

test('create and edit only send a changed result limit when the explicit capability is valid', () => {
  const capabilities={schema:'bach.task-capabilities.v1',result_max_chars:{supported:true,min:1,max:3000,nullable:true}};
  assert.deepEqual(resultMaxCharsCreateChange(capabilities,''),
    {supported:true,valid:true,include:false,value:null});
  assert.deepEqual(resultMaxCharsCreateChange(capabilities,'1'),
    {supported:true,valid:true,include:true,value:1});
  assert.equal(resultMaxCharsCreateChange(capabilities,'3001').valid,false);
  assert.equal(resultMaxCharsCreateChange(null,'100').supported,false);

  const unlimited={id:taskId,result_max_chars:null};
  assert.deepEqual(resultMaxCharsEditChange(capabilities,unlimited,''),
    {supported:true,valid:true,changed:false,value:null});
  assert.deepEqual(resultMaxCharsEditChange(capabilities,unlimited,'3000'),
    {supported:true,valid:true,changed:true,value:3000});
  assert.deepEqual(resultMaxCharsEditChange(capabilities,{id:taskId,result_max_chars:3000},''),
    {supported:true,valid:true,changed:true,value:null});
  assert.equal(resultMaxCharsEditChange(capabilities,{id:taskId},'250').supported,false);
  assert.equal(resultMaxCharsEditChange(null,unlimited,'250').supported,false);
});

test('legacy readbacks keep accept compatibility but never infer correction capability from a token', () => {
  assert.deepEqual(resultOperatorCapabilities(correctionTarget()),
    {valid:true, legacy:true, accept_result:true, request_correction:false});
  assert.deepEqual(resultOperatorCapabilities({...correctionTarget(), operator_capabilities:{accept_result:true,request_correction:false}}),
    {valid:true, legacy:false, accept_result:true, request_correction:false});
  for (const invalid of [null, {accept_result:true}, {accept_result:true,request_correction:'yes', extra:true}]) {
    assert.equal(resultOperatorCapabilities({...correctionTarget(),operator_capabilities:invalid}).request_correction,false);
    assert.equal(resultOperatorCapabilities({...correctionTarget(),operator_capabilities:invalid}).accept_result,false);
  }
});

test('correction submission is bound to the current pending result and preserves Unicode within the codepoint limit', () => {
  const readback = correctionTarget();
  assert.equal(isCurrentCorrectionTarget(readback,taskId),true);
  const note = `  ${'🙂'.repeat(1200)}  `;
  assert.equal(Array.from(normalizeCorrectionNote(note)).length,1200);
  assert.equal(normalizeCorrectionNote('🙂'.repeat(1201)),null);
  assert.equal(normalizeCorrectionNote('   '),null);
  const body = buildCorrectionRequest(readback,taskId,note,requestId);
  assert.deepEqual(body,{result_id:41,result_sha256:resultHash,generation:'generation-9',fence:7001,
    task_version:version,status_revision:17,request_id:requestId,correction_note:'🙂'.repeat(1200)});
  assert.deepEqual(Object.keys(body).sort(),['correction_note','fence','generation','request_id','result_id','result_sha256','status_revision','task_version'].sort());
  for (const invalidRequestId of [23, null, {toString:()=>requestId}, 'not-a-uuid']) {
    assert.throws(()=>buildCorrectionRequest(readback,taskId,'note',invalidRequestId));
  }
});

test('correction target rejects stale task, result, status, digest, generation, or lease fence', () => {
  const patches = [
    [r=>{r.task_id++;}], [r=>{r.status='pending';}], [r=>{r.status_revision=0;}],
    [r=>{r.task_version='legacy-version';}], [r=>{r.result.result_sha256='bad';}],
    [r=>{r.result.generation='';}], [r=>{r.result.fence=0;}], [r=>{r.result.task_version=nextVersion;}],
    [r=>{r.result.accepted=true;}], [r=>{r.result.reason='legacy_result_without_acceptance';}]
  ];
  for (const [mutate] of patches) { const readback=correctionTarget(); mutate(readback); assert.equal(isCurrentCorrectionTarget(readback,taskId),false); }
  assert.throws(()=>buildCorrectionRequest(correctionTarget(),taskId,'note','not-a-uuid'));
});

test('correction attempts bind the selected task and require a fresh open after an unknown acknowledgement', () => {
  const readback=correctionTarget();
  const attempt=createCorrectionAttempt(readback,taskId,8,'Bitte die Kriterien ergänzen.',requestId);
  assert.equal(correctionAttemptMatchesView(attempt,readback,taskId,8),true);
  assert.equal(correctionAttemptMatchesView(attempt,readback,taskId+1,8),false);
  assert.equal(correctionAttemptMatchesView(attempt,readback,taskId,9),false);

  const unknown=transitionCorrectionAttempt(attempt,200,{schema:'bach.task-result-correction-request.v1',
    request_id:requestId,task_id:taskId,status:'pending'});
  assert.equal(unknown.state,'reopen_required');
  assert.equal(correctionAttemptMatchesView({...attempt,state:unknown.state},readback,taskId,8),false);

  // A deliberate reopen supplies a new readback context and a new request ID; no retry reuses the unknown attempt.
  const reopened=correctionTarget(); reopened.status_revision=18;
  const nextRequestId='7a4b2f9c-1f15-4a3c-92c8-5f7dca0a6151';
  const nextAttempt=createCorrectionAttempt(reopened,taskId,9,'Bitte präzisieren.',nextRequestId);
  assert.equal(correctionAttemptMatchesView(nextAttempt,reopened,taskId,9),true);
  assert.notEqual(nextAttempt.request_id,attempt.request_id);
});

test('correction acknowledgement confirms the exact request, original result, and next pending task version', () => {
  const expected={task_id:taskId,request_id:requestId,result_id:41,result_sha256:resultHash,task_version:version};
  const answer={schema:'bach.task-result-correction-request.v1',request_id:requestId,task_id:taskId,
    correction_id:52,correction_round:1,source_result_id:41,source_result_sha256:resultHash,status:'pending',
    next_task_version:nextVersion,replayed:false};
  assert.equal(validateCorrectionAcknowledgement(answer,expected),true);
  for (const patch of [{request_id:'other'}, {task_id:taskId+1}, {source_result_id:42},
    {source_result_sha256:'d'.repeat(64)}, {status:'review'}, {next_task_version:version}, {replayed:'false'}]) {
    assert.equal(validateCorrectionAcknowledgement({...answer,...patch},expected),false);
  }
});

test('history pages validate event types, ordering, exclusive cursor, page size, and privacy projection', () => {
  const first = validateResultHistoryPage(history([submitted(12,{secret:'discard me'}),correction(11)],
    {has_more:true,next_before_event_id:11}),taskId,{limit:2});
  assert.deepEqual(first.events.map(item=>item.event_id),[12,11]);
  assert.equal(first.events[0].result.secret,undefined);
  assert.equal(first.events[1].correction.note,'Bitte die Kriterien ergänzen.');
  const second = validateResultHistoryPage(history([accepted(9),submitted(8)],{}),taskId,{limit:2,beforeEventId:11});
  assert.deepEqual(second.events.map(item=>item.event_id),[9,8]);
  for (const invalid of [
    history([submitted(12),submitted(12)]),
    history([submitted(11),submitted(12)]),
    history([{event_id:12,type:'operator_action',occurred_at:'2026-10-12T12:00:00Z'}]),
    history([correction(12,{request_id:'not-a-uuid'})]),
    history([submitted(12)],{has_more:true,next_before_event_id:11}),
    history([submitted(12)],{next_before_event_id:12}),
    history([submitted(12)],{task_id:taskId+1}),
    history([submitted(12)],{events:[submitted(12),accepted(11)]})
  ]) assert.equal(validateResultHistoryPage(invalid,taskId,{limit:2,beforeEventId:11}),null);
  for (const occurred_at of ['2026-02-31T00:00:00Z','2026-02-29T00:00:00Z','2026-13-01T00:00:00Z',
    '2026-10-12T24:00:00Z','2026-10-12T12:00:00+24:00']) {
    assert.equal(validateResultHistoryPage(history([{...submitted(12),occurred_at}]),taskId),null);
  }
  assert.notEqual(validateResultHistoryPage(history([{...submitted(12),occurred_at:'2024-02-29T00:00:00Z'}]),taskId),null);
  assert.notEqual(validateResultHistoryPage(history([{...submitted(12),occurred_at:'2024-02-29T00:00:00Z'}]),taskId),null);
});

test('history validator accepts the frozen BACH v1 fixture shape and source/result bindings', () => {
  const resultText='Früheres Ergebnis mit nachvollziehbaren Belegen.';
  const resultSha=createHash('sha256').update(resultText,'utf8').digest('hex');
  assert.equal(resultSha,'805de72ec26df2dacd107b21835c618357554a768c2a11f227f5de49bbcdc7ef');
  const backendFixture={schema:'bach.task-result-history.v1',task_id:42001,events:[
    {event_id:7002,type:'correction_requested',occurred_at:'2026-10-12T11:30:00Z',correction:{
      correction_id:8,correction_round:1,source_result_id:59,source_result_sha256:resultSha,
      note:'Quellen und Grenzen ergänzen.',request_id:'a6b7c8d9-e001-4002-8003-a4b5c6d7e8f9'}},
    {event_id:7001,type:'result_submitted',occurred_at:'2026-10-12T11:20:00Z',result:{
      result_id:59,result_sha256:resultSha,text:resultText,generation:'fixture-generation-1',fence:7,
      task_version:'a'.repeat(64)}}
  ],next_before_event_id:null,has_more:false};
  const page=validateResultHistoryPage(backendFixture,42001);
  assert.ok(page);
  assert.deepEqual(page.events.map(event=>event.event_id),[7002,7001]);
  assert.equal(page.events[0].correction.source_result_id,page.events[1].result.result_id);
  assert.equal(page.events[0].correction.source_result_sha256,page.events[1].result.result_sha256);
  assert.equal(page.events[1].result.text,resultText);
  assert.equal(page.has_more,false);
  assert.equal(page.next_before_event_id,null);
});


function resultLoaderHarness(initialKey='operator-key', gate={}) {
  let activeKey = initialKey;
  const requests = [];
  const submit = {disabled:false};
  const textarea = {value:''};
  const correctionForm = {
    hidden:true,
    querySelector(selector) {
      if (selector === 'button[type="submit"]') return submit;
      if (selector === 'textarea') return textarea;
      throw new Error('unexpected selector: ' + selector);
    }
  };
  const nodes = {
    'task-result-status':{textContent:'',hidden:false},
    'task-result-content':{textContent:'',hidden:true},
    'task-result-meta':{textContent:'',hidden:true},
    'task-result-accept':{hidden:true,disabled:true},
    'task-result-correction':correctionForm,
    'task-result-key-status':{textContent:''}
  };
  const context = {
    document:{getElementById(id) {
      if (!nodes[id]) throw new Error('unexpected node: ' + id);
      return nodes[id];
    }},
    fetch:(url, init) => new Promise(resolve => requests.push({url,init,resolve})),
    selectedTask:{id:taskId,task_version:version},
    taskDetailRevision:8,
    selectedResult:null,
    taskResultReadback:null,
    taskResultCapabilities:{valid:false,accept_result:false,request_correction:false},
    correctionRequiresRefresh:gate.requiresRefresh === true,
    correctionPostInFlight:gate.inFlight === true,
    correctionGateTaskId:gate.taskId ?? null,
    taskResultReadGeneration:0,
    taskResultStatusMessage:'',
    operatorKey:() => activeKey,
    resultKeyStatus:() => {},
    resultOperatorCapabilities,
    isCurrentCorrectionTarget,
    updateCorrectionCount:() => {}
  };
  const page = readFileSync(new URL('../src/pages/tasks.astro',import.meta.url),'utf8');
  const start = page.indexOf('    function correctionGateActive(taskId) {');
  const end = page.indexOf('\n    function resetTaskResultHistory()',start);
  assert.ok(start >= 0 && end > start, 'current result loader/helper block must be present');
  vm.createContext(context);
  new vm.Script(page.slice(start,end)
    + '\nglobalThis.__loadTaskResult = loadTaskResult;'
    + '\nglobalThis.__state = () => ({generation:taskResultReadGeneration, readback:taskResultReadback,'
    + ' capabilities:taskResultCapabilities, requiresRefresh:correctionRequiresRefresh,'
    + ' postInFlight:correctionPostInFlight, gateTaskId:correctionGateTaskId});').runInContext(context);
  return {
    context,nodes,submit,requests,
    setKey(value) { activeKey=value; },
    resolve(index,data) { requests[index].resolve({ok:true,json:async()=>data}); }
  };
}

function resultReadback(text, requestCorrection) {
  return {schema:'bach.task-result-readback.v1',task_id:taskId,verified:true,status:'review',
    status_revision:17,task_version:version,
    operator_capabilities:{accept_result:false,request_correction:requestCorrection},
    result:{schema:'bach.worker-result.v1',task_id:taskId,result:text,reason:'awaiting_review',
      accepted:false,result_id:41,result_sha256:resultHash,generation:'generation-9',fence:7001,
      task_version:version}};
}

test('operator-key reload responses are generation-bound when they arrive out of order', async () => {
  const h=resultLoaderHarness('old-key');
  const oldRead=h.context.__loadTaskResult(taskId,8);
  h.setKey('new-key');
  const newRead=h.context.__loadTaskResult(taskId,8);
  assert.equal(h.requests.length,2);
  assert.equal(h.requests[0].init.headers['X-BACH-Result-Operator'],'old-key');
  assert.equal(h.requests[1].init.headers['X-BACH-Result-Operator'],'new-key');

  h.resolve(1,resultReadback('new-key result',true));
  await newRead;
  assert.equal(h.nodes['task-result-content'].textContent,'new-key result');
  assert.equal(h.context.__state().capabilities.request_correction,true);
  assert.equal(h.nodes['task-result-correction'].hidden,false);

  h.resolve(0,resultReadback('old-key result',false));
  await oldRead;
  assert.equal(h.nodes['task-result-content'].textContent,'new-key result');
  assert.equal(h.context.__state().capabilities.request_correction,true);
  assert.equal(h.nodes['task-result-correction'].hidden,false);
});

test('a key reload after an unknown correction acknowledgement keeps the reopen gate closed', async () => {
  // This is the settled state after an unconfirmed POST acknowledgement: the task must be fully reopened.
  const h=resultLoaderHarness('replacement-key',{requiresRefresh:true,taskId});
  const reload=h.context.__loadTaskResult(taskId,8);
  assert.equal(h.requests[0].init.headers['X-BACH-Result-Operator'],'replacement-key');
  h.resolve(0,resultReadback('same original result',true));
  await reload;

  assert.equal(h.context.__state().requiresRefresh,true);
  assert.equal(h.context.__state().gateTaskId,taskId);
  assert.equal(h.nodes['task-result-correction'].hidden,true);
  assert.equal(h.submit.disabled,true);
  assert.match(h.nodes['task-result-status'].textContent,/nicht erneut senden/);
});

test('the task page uses the declared result endpoints and renders server text without HTML interpretation', () => {
  const page=readFileSync(new URL('../src/pages/tasks.astro',import.meta.url),'utf8');
  const createForm=readFileSync(new URL('../src/components/TaskCreateForm.astro',import.meta.url),'utf8');
  const manifest=JSON.parse(readFileSync(new URL('../public/page-reads.v1.json',import.meta.url),'utf8'));
  const routes=manifest.pages['/tasks'];
  assert.ok(routes.some(route=>route.method==='GET' && route.path==='/api/tasks/{id}/result/history'
    && route.dynamic===true && route.found_in==='src/pages/tasks.astro#loadTaskResultHistory'));
  assert.ok(routes.some(route=>route.method==='POST' && route.path==='/api/tasks/{id}/result/correction'
    && route.dynamic===true));
  assert.ok(routes.some(route=>route.method==='GET' && route.path==='/api/task-capabilities'
    && route.required===false));
  assert.ok(manifest.pages['/life'].some(route=>route.method==='GET' && route.path==='/api/task-capabilities'));
  assert.ok(manifest.pages['/agenten/sessions'].some(route=>route.method==='GET' && route.path==='/api/task-capabilities'));
  assert.doesNotMatch(JSON.stringify(manifest),/\/api\/tasks\/capabilities/);
  assert.match(page,/fetch\('\/api\/task-capabilities'/);
  assert.match(page,/resultMaxCharsEditChange/);
  assert.match(createForm,/fetch\('\/api\/task-capabilities'/);
  assert.match(createForm,/resultMaxCharsCreateChange/);
  assert.match(page,/\/result\/correction/);
  assert.match(page,/\/result\/history\?/);
  assert.match(page,/X-BACH-Result-Operator/);
  assert.match(page,/createCorrectionAttempt/);
  assert.match(page,/transitionCorrectionAttempt/);
  assert.match(page,/content\.textContent\s*=\s*event\.result\.text/);
  assert.doesNotMatch(page,/innerHTML\s*=\s*event\.(?:result|correction)/);
  for (const sourceFile of [page,createForm]) for (const match of sourceFile.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    const source=match[1].replace(/^\s*import[^;]+;/gm,'');
    new vm.Script(source);
  }
});

test('Task2138 provenance binds the five delivered files and preserves pinned BACH source hashes', () => {
  const provenance = JSON.parse(readFileSync(new URL('../SOURCE_PROVENANCE.json', import.meta.url), 'utf8'));
  const paths = [
    'public/page-reads.v1.json',
    'src/components/TaskCreateForm.astro',
    'src/pages/tasks.astro',
    'src/lib/task-result-contract.mjs',
    'tests/task-result-history.test.mjs'
  ];
  const hash = path => createHash('sha256')
    .update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex');
  for (const path of paths) assert.equal(provenance.files_sha256[path], hash(path), path);

  const originalBach = provenance.source_imports.find(group =>
    group.source_repository === 'ellmos-ai/bach'
      && group.source_commit === '8884fcd2277f5db89e1a267a81042b33358278b8');
  assert.ok(originalBach);
  const importedHistory = {
    'src/components/TaskCreateForm.astro': 'fcfbad55ec1a3a1b4324db717a4ef2e0d7149dba6724d1bfbe95a34b3daf1852',
    'src/pages/tasks.astro': 'cf776e1a6e562fa5800fe55fa4137e509313bbcaaf5a1565c1cfa460316321d9'
  };
  for (const [path, sourceSha] of Object.entries(importedHistory)) {
    assert.equal(originalBach.files[path].source_sha256, sourceSha);
    assert.equal(originalBach.files[path].imported_sha256, hash(path));
    assert.equal(originalBach.files[path].adapted, true);
  }
  for (const path of ['public/page-reads.v1.json', 'src/lib/task-result-contract.mjs', 'tests/task-result-history.test.mjs']) {
    assert.equal(provenance.source_imports.some(group => group.files?.[path]), false, path);
  }

  const followup = provenance.followup_changes.find(change =>
    change.scope === 'Task2138: version-bound task result history, correction requests, and result-length limits');
  assert.ok(followup);
  assert.deepEqual(followup.files.map(file => file.path).sort(), [...paths].sort());
  for (const file of followup.files) assert.equal(file.sha256, hash(file.path), file.path);
});
