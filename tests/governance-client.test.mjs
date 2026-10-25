import test from 'node:test';
import assert from 'node:assert/strict';
import {createGovernanceRequest} from '../src/lib/governance-request.mjs';
import {parseRegistry,parseEffective,parseCapabilities,describeFailure} from '../src/lib/governance-readers.mjs';
const URL='/api/governance/policy-registry';
const entry=()=>({id:'p1',kind:'policy',extension:{nested:['kept']}});
const registry=(tag='current')=>({schema:'bach.policy-registry.v1',availability:'available',entries:[entry()],count:1,registry_version:tag,provider:{id:'policy-registry',extra:tag},extension:{tag,list:[{unknown:true}]}});
const response=(body,status=200)=>({ok:status>=200&&status<300,status,text:async()=>typeof body==='string'?body:JSON.stringify(body)});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const client=()=>{const states=[];return {states,reader:createGovernanceRequest(s=>states.push(s))};};
const last=states=>states.at(-1);
const cleared=s=>{assert.equal(s.model,null);assert.equal(s.payload,null);};

test('success preserves full registry and effective payloads including unknown fields',async()=>{
 const {states,reader}=client(),raw=registry();
 await reader.load(URL,parseRegistry,async()=>response(raw));
 let state=last(states);assert.equal(state.state,'ok');assert.deepEqual(state.payload,raw);
 assert.strictEqual(state.model.raw,state.payload);assert.strictEqual(state.model.rows[0].raw,state.payload.entries[0]);
 assert.deepEqual(state.model.rows[0].raw.extension,{nested:['kept']});
 const eff={...registry(),effective:{status:'selected',reason:'fixture',selected:entry(),candidate_ids:['p1'],governance_binding:{extra:[1]},external_effect_gates:{future:true},unknown:{kept:true}}};
 await reader.load('/api/governance/effective-policy?scope=fixture',parseEffective,async()=>response(eff));
 state=last(states);assert.deepEqual(state.payload,eff);assert.strictEqual(state.model.effective.raw,state.payload.effective);
 assert.deepEqual(state.model.effective.selected.raw.extension,{nested:['kept']});
});
for(const code of ['policy_provider_not_configured','policy_provider_provenance_mismatch','policy_provider_import_mismatch','policy_provider_unavailable','policy_registry_missing','policy_registry_too_large','policy_registry_read_failed']){
 test('503 public code '+code,async()=>{
  const {states,reader}=client();await reader.load(URL,parseRegistry,async()=>response({detail:code},503));
  assert.equal(last(states).state,'unavailable');assert.equal(last(states).failure.detail,code);cleared(last(states));
 });
}
for(const detail of ['private fixture /synthetic/secret','unknown_future_code',{trace:'fixture-private'}]){
 test('503 hides arbitrary detail '+JSON.stringify(detail),async()=>{
  const {states,reader}=client();await reader.load(URL,parseRegistry,async()=>response({detail},503));
  assert.equal(last(states).state,'unavailable');assert.equal(last(states).failure.detail,null);cleared(last(states));
  assert.ok(!JSON.stringify(last(states)).includes('/synthetic/secret'));assert.ok(!JSON.stringify(last(states)).includes('fixture-private'));
  assert.equal(describeFailure(503,{error:detail}).detail,null);
 });
}
for(const [detail,state] of [['policy_registry_changed_during_read','changed'],['other_conflict','conflict']]){
 test('409 clears data without retry: '+state,async()=>{
  const {states,reader}=client();await reader.load(URL,parseRegistry,async()=>response(registry()));let calls=0;
  await reader.load(URL,parseRegistry,async()=>{calls++;return response({detail},409);});
  assert.equal(calls,1);assert.equal(last(states).state,state);assert.equal(last(states).failure.detail,state==='changed'?detail:null);
  cleared(last(states));assert.equal(states.at(-2).state,'loading');cleared(states.at(-2));
 });
}
for(const older of ['success','error','conflict','network'])for(const newer of ['success','conflict']){
 test('late '+older+' headers cannot replace newer '+newer,async()=>{
  const {states,reader}=client(),pending=deferred();let signal;
  const old=reader.load(URL,parseRegistry,async(_url,options)=>{signal=options.signal;return pending.promise;});
  await reader.load(URL,parseRegistry,async()=>newer==='success'?response(registry('new')):response({detail:'policy_registry_changed_during_read'},409));
  assert.equal(signal.aborted,true);const settled=last(states),count=states.length;
  if(older==='network')pending.reject(new Error('fixture offline'));
  else pending.resolve(older==='success'?response(registry('old')):response({detail:'policy_registry_changed_during_read'},older==='error'?503:409));
  await old;assert.strictEqual(last(states),settled);assert.equal(states.length,count);
  assert.equal(settled.state,newer==='success'?'ok':'changed');if(newer==='success')assert.equal(settled.payload.registry_version,'new');
 });
}
for(const newer of ['success','conflict']){
 test('late body cannot replace newer '+newer,async()=>{
  const {states,reader}=client(),body=deferred(),started=deferred();
  const old=reader.load(URL,parseRegistry,async()=>({ok:true,status:200,text(){started.resolve();return body.promise;}}));
  await started.promise;await reader.load(URL,parseRegistry,async()=>newer==='success'?response(registry('new')):response({detail:'policy_registry_changed_during_read'},409));
  const settled=last(states),count=states.length;body.resolve(JSON.stringify(registry('old')));await old;
  assert.strictEqual(last(states),settled);assert.equal(states.length,count);
 });
}
test('cancel invalidates pending read and publishes cleared idle',async()=>{
 const {states,reader}=client(),pending=deferred();let signal;
 const load=reader.load(URL,parseRegistry,async(_url,options)=>{signal=options.signal;return pending.promise;});
 reader.cancel();assert.equal(signal.aborted,true);assert.equal(last(states).state,'idle');cleared(last(states));
 const count=states.length;pending.resolve(response(registry('cancelled')));await load;assert.equal(states.length,count);
 await reader.load(URL,parseRegistry,async()=>response(registry('after-cancel')));assert.equal(last(states).state,'ok');
});
test('network failure clears success and never retries',async()=>{
 const {states,reader}=client();await reader.load(URL,parseRegistry,async()=>response(registry()));let calls=0;
 await reader.load(URL,parseRegistry,async()=>{calls++;throw new Error('private fixture');});
 assert.equal(calls,1);assert.equal(last(states).state,'network');cleared(last(states));assert.ok(!JSON.stringify(last(states)).includes('private fixture'));
});
for(const body of ['','  ','{invalid','null','{}','[]']){
 test('bad success body '+JSON.stringify(body),async()=>{
  const {states,reader}=client();await reader.load(URL,parseRegistry,async()=>response(registry()));
  await reader.load(URL,parseRegistry,async()=>response(body));assert.equal(last(states).state,'contract');cleared(last(states));
 });
}
for(const [status,state] of [[401,'auth'],[403,'auth'],[404,'route']]){
 test('HTTP '+status+' with null body remains '+state,async()=>{
  const {states,reader}=client();await reader.load(URL,parseRegistry,async()=>response('null',status));
  assert.equal(last(states).state,state);cleared(last(states));assert.equal(last(states).failure.detail,null);
 });
}
for(const url of ['https://example.invalid/api/governance/locks','//example.invalid/api/governance/locks','/api/tasks','/api/governance/locks/extra','/api/governance/locks#fragment','/api/governance/locks/../status','/api/governance/%6cocks','relative/path',null]){
 test('reject non-whitelisted URL '+String(url),async()=>{
  const {states,reader}=client();let calls=0;await reader.load(url,parseRegistry,async()=>{calls++;return response(registry());});
  assert.equal(calls,0);assert.equal(last(states).state,'contract');cleared(last(states));
 });
}
for(const url of ['/api/governance/locks','/api/governance/decisions','/api/governance/policies',URL,'/api/governance/effective-policy?scope=fixture','/api/gui/capabilities']){
 test('GET/no-store/AbortSignal for '+url,async()=>{
  const {states,reader}=client();let calls=0;
  await reader.load(url,raw=>raw,async(actual,options)=>{
   calls++;assert.equal(actual,url);assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');
   assert.ok(options.signal instanceof AbortSignal);assert.equal(options.signal.aborted,false);
   assert.deepEqual(Object.keys(options).sort(),['cache','method','signal']);return response({fixture:true});
  },()=> 'ok');assert.equal(calls,1);assert.equal(last(states).state,'ok');
 });
}
test('capability classification preserves nullable availability and false runtime despite verified kit',async()=>{
 const {states,reader}=client(),raw={schema:'ellmos.gui.capabilities.v1',kit:{verified:true,extension:{kept:true}},modules:{'policy-registry':{adapter_registered:true,available:null,runtime_verified:false,extra:[1]}},future:{preserved:true}};
 let classified=0;await reader.load('/api/gui/capabilities',parseCapabilities,async()=>response(raw),model=>{classified++;assert.equal(model.kit.verified,true);return 'ok';});
 assert.equal(classified,1);const state=last(states);assert.equal(state.state,'ok');assert.deepEqual(state.payload,raw);
 assert.strictEqual(state.model.raw,state.payload);assert.strictEqual(state.model.kit,state.payload.kit);
 assert.strictEqual(state.model.policy,state.payload.modules['policy-registry']);assert.equal(state.model.policy.available,null);assert.equal(state.model.policy.runtime_verified,false);
 assert.equal(parseCapabilities({...raw,modules:{}}).policy,null);
});
test('optional capability failure never clears independent registry success',async()=>{
 const reg=client(),cap=client(),pending=deferred();
 const load=cap.reader.load('/api/gui/capabilities',parseCapabilities,()=>pending.promise,()=> 'ok');
 await reg.reader.load(URL,parseRegistry,async()=>response(registry()));const settled=last(reg.states),count=reg.states.length;
 pending.resolve(response({detail:'private fixture diagnostic'},503));await load;
 assert.equal(last(cap.states).state,'unavailable');assert.equal(last(cap.states).failure.detail,null);
 assert.strictEqual(last(reg.states),settled);assert.equal(reg.states.length,count);assert.equal(settled.state,'ok');
});

test('backslash URL cannot escape the relative endpoint origin',async()=>{
 const {states,reader}=client();let calls=0;
 await reader.load(String.raw`/\example.invalid/api/governance/locks`,parseRegistry,async()=>{calls++;return response(registry());});
 assert.equal(calls,0);assert.equal(last(states).state,'contract');cleared(last(states));
});
