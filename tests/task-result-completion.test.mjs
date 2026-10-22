import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildResultAcceptanceRequest, canConfirmTaskResult, resultAcceptanceConfirmed,
  taskResultCompletionMessage} from '../src/lib/task-result-contract.mjs';

const version = 'a'.repeat(64);
const revision = 'b'.repeat(64);
function target() {
  return {schema:'bach.task-result-readback.v1',verified:true,task_id:42,task_version:version,
    status:'review',status_revision:17,
    result:{schema:'bach.worker-result.v1',task_id:42,task_version:version,result_id:23,
      result_sha256:'c'.repeat(64),reason:'awaiting_review',accepted:false,
      generation:'generation-7',fence:4,completion_policy_version:1,result_revision:revision}};
}
function approved() {
  const data=target();
  Object.assign(data.result,{user_review_revision:revision,user_review_event_id:31,
    contract_attestation_revision:revision,contract_attestation_event_id:32});
  data.completion_evaluation={schema:'bach.worker-completion-evaluation.v1',availability:'available',
    task_id:42,result_id:23,result_revision:revision,status:data.status,
    result_sha256:data.result.result_sha256,task_version:data.task_version,status_revision:data.status_revision,
    decision:{state:'awaiting_review',completion_allowed:false}};
  return data;
}

test('managed approval explicitly binds full revision and confirms the task contract',()=>{
  assert.deepEqual(buildResultAcceptanceRequest(target()),{result_id:23,result_sha256:'c'.repeat(64),
    task_version:version,status_revision:17,result_revision:revision,task_contract_met:true});
  assert.equal(canConfirmTaskResult(approved()),false,'already confirmed revision is not sent again');
});

for (const marker of [null,2,'1',true]) {
  test(`unsupported completion marker ${JSON.stringify(marker)} cannot fall back to legacy approval`,()=>{
    const data=target();data.result.completion_policy_version=marker;
    assert.equal(canConfirmTaskResult(data),false);
    assert.throws(()=>buildResultAcceptanceRequest(data));
  });
}

test('missing or malformed full revision cannot authorize managed confirmation',()=>{
  for(const value of [null,undefined,'',revision.slice(1),'sha256:'+revision]) {
    const data=target();data.result.result_revision=value;
    assert.equal(canConfirmTaskResult(data),false);
  }
});

test('legacy results retain the existing request and completed-readback contract',()=>{
  const before=target();delete before.result.completion_policy_version;delete before.result.result_revision;
  assert.deepEqual(buildResultAcceptanceRequest(before),{result_id:23,result_sha256:'c'.repeat(64),
    task_version:version,status_revision:17});
  const answer=structuredClone(before);answer.status='done';answer.status_revision=18;answer.result.accepted=true;
  assert.equal(resultAcceptanceConfirmed(before,answer,structuredClone(answer)),true);
  assert.equal(resultAcceptanceConfirmed(before,before,before),false);
});

test('personal approval can be confirmed while another required gate keeps task in review',()=>{
  const answer=approved();
  assert.equal(resultAcceptanceConfirmed(target(),answer,structuredClone(answer)),true);
  assert.match(taskResultCompletionMessage(answer),/Freigabe ist gespeichert/);
  assert.match(taskResultCompletionMessage(answer),/Modellprüfung steht noch aus/);
  assert.doesNotMatch(taskResultCompletionMessage(answer),/· erledigt/);
});

for(const [name,mutate] of [
  ['wrong task',d=>{d.task_id=43;}],['changed task version',d=>{d.task_version='d'.repeat(64);}],
  ['different result',d=>{d.result.result_id++;}],['changed digest',d=>{d.result.result_sha256='d'.repeat(64);}],
  ['changed revision',d=>{d.result.result_revision='d'.repeat(64);}],
  ['missing user event',d=>{delete d.result.user_review_event_id;}],
  ['different user event',d=>{d.result.user_review_event_id++;}],
  ['stale approval',d=>{d.result.user_review_revision='d'.repeat(64);}],
  ['missing contract event',d=>{delete d.result.contract_attestation_event_id;}],
  ['different contract event',d=>{d.result.contract_attestation_event_id++;}],
  ['stale attestation',d=>{d.result.contract_attestation_revision='d'.repeat(64);}],
  ['wrong status cursor',d=>{d.status_revision++;}],['unverified',d=>{d.verified=false;}],
  ['accepted while still review',d=>{d.result.accepted=true;}],
  ['done without acceptance',d=>{d.status='done';}],
]) {
  test(`independent approval readback rejects ${name}`,()=>{
    const answer=approved(),fresh=structuredClone(answer);mutate(fresh);
    assert.equal(resultAcceptanceConfirmed(target(),answer,fresh),false);
  });
}

test('eligible completion from a read-only evaluation never becomes a displayed Done',()=>{
  const data=approved();data.completion_evaluation.decision={state:'completed',completion_allowed:true};
  assert.match(taskResultCompletionMessage(data),/Taskabschluss ist noch nicht bestätigt/);
  data.status='done';data.status_revision=18;data.result.accepted=true;data.result.reason='accepted';
  data.result.completion_decision={availability:'available',result_revision:revision,event_id:41,
    decision_sha256:'e'.repeat(64)};
  data.completion_evaluation.status='done';data.completion_evaluation.status_revision=18;
  assert.equal(taskResultCompletionMessage(data),'Abgenommen · erledigt.');
  assert.equal(resultAcceptanceConfirmed(target(),data,structuredClone(data)),true);
});

test('stale evaluation cannot describe another revision as successfully reviewed',()=>{
  const data=approved();data.completion_evaluation.result_revision='d'.repeat(64);
  data.completion_evaluation.decision.state='completed';
  assert.match(taskResultCompletionMessage(data),/noch nicht bestätigt/);
  assert.doesNotMatch(taskResultCompletionMessage(data),/erfüllt/);
});

test('completed review child does not imply personal acceptance of its target',()=>{
  const data=target();data.status='done';data.result.accepted=true;data.result.reason='accepted';
  data.result.completion_decision={availability:'administrative_review_child'};
  assert.equal(taskResultCompletionMessage(data),'Prüfaufgabe abgeschlossen.');
});

function acceptanceHarness(answer,fresh,onPost=null) {
  const before=target(),requests=[],errors=[];
  const button={disabled:false};let callback;let loaded=0;
  const context={selectedResult:before,selectedTask:{id:42,task_version:version},taskDetailRevision:1,
    taskResultReadback:null,activeKey:'fixture-operator',operatorKey:()=> context.activeKey,
    document:{getElementById:()=>({addEventListener:(kind,fn)=>{callback=fn;}})},
    detailError:message=>errors.push(message),taskResponseError:()=> 'request failed',
    buildResultAcceptanceRequest,resultAcceptanceConfirmed,
    fetch:async(url,init={})=>{
      requests.push({url,init});if(init.method==='POST'&&onPost)onPost(context);
      return {ok:true,json:async()=>init.method==='POST'?answer:fresh};
    },
    openTask:async()=>{
      context.taskDetailRevision++;
      const response=await context.fetch('/api/tasks/42/result');
      context.taskResultReadback=await response.json();
    },loadTasks:async()=>{loaded++;}};
  const source=readFileSync(new URL('../src/pages/tasks.astro',import.meta.url),'utf8');
  const start=source.indexOf("    document.getElementById('task-result-accept').addEventListener('click'");
  const end=source.indexOf('\n    async function openTask(',start);
  assert.ok(start>=0&&end>start);
  vm.createContext(context);new vm.Script(source.slice(start,end)).runInContext(context);
  return {requests,errors,run:()=>callback({currentTarget:button}),loaded:()=>loaded};
}

test('actual page handler posts a bound personal decision and independently reads pending gates',async()=>{
  const h=acceptanceHarness(approved(),approved());await h.run();
  assert.equal(h.requests.length,2);assert.equal(h.requests[0].init.method,'POST');
  assert.equal(JSON.parse(h.requests[0].init.body).result_revision,revision);
  assert.equal(h.requests[1].url,'/api/tasks/42/result');
  assert.deepEqual(h.errors.filter(Boolean),[]);assert.equal(h.loaded(),1);
});

test('actual page handler rejects an unconfirmed approval after the independent GET',async()=>{
  const fresh=approved();delete fresh.result.user_review_event_id;
  const h=acceptanceHarness(approved(),fresh);await h.run();
  assert.equal(h.requests.length,2);assert.equal(h.loaded(),0);
  assert.match(h.errors.filter(Boolean).at(-1),/Kontrollabruf nicht belegt/);
});

for(const [name,change] of [
  ['task',context=>{context.selectedTask={id:43};context.taskDetailRevision++;}],
  ['operator session',context=>{context.activeKey='different-fixture-operator';}],
]) {
  test(`actual page handler discards a POST after ${name} changes`,async()=>{
    const h=acceptanceHarness(approved(),approved(),change);await h.run();
    assert.equal(h.requests.length,1);assert.equal(h.loaded(),0);
    assert.deepEqual(h.errors.filter(Boolean),[]);
  });
}
