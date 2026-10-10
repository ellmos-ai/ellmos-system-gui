import test from 'node:test';
import assert from 'node:assert/strict';
import {agentChoices, loadSocketSnapshot, modelCatalogue, saveSocketChange, socketSnapshot} from '../src/lib/model-sockets.mjs';
import {mountModelSockets} from '../src/lib/model-sockets-ui.mjs';

const A = 'a'.repeat(64), B = 'b'.repeat(64);
const target = 'model-' + '1'.repeat(24), binding = 'binding-' + '2'.repeat(24);
const config = (version=A) => ({schema:'bach.model-sockets.v1',configuration_version:version,
  host_id:'fixture-host',migration_required:false,source:'canonical_slots_config',runtime_verified:false,
  host_inference_limit:1,unbound_agent_ids:['external-agent'],sockets:[{id:target,backend:'ollama',model:'fixture:4b',
    host_id:'fixture-host',enabled:true,max_active_slots:1,residency_policy:'exclusive',capacity_verified:false,
    effective_max_active_slots:1,residency:'unknown',weight_bytes:null,resource_share:null,
    slots:[{id:binding,agent_id:'test-agent',socket_id:target,enabled:true,priority:'background',
      context_tokens:null,name:'Testagent',orphaned:false,running:null,resource_share:null}]}]});
const catalog = () => ({schema:'bach.local-model-catalog.v1',host_id:'fixture-host',
  source:'configured_native_provider_metadata',observed_at:new Date().toISOString(),runtime_verified:false,
  excluded:[],providers:[{backend:'ollama',status:'verified'},{backend:'lmstudio',status:'unknown',reason:'capability_adapter_pending'}],
  models:[{socket_id:target,backend:'ollama',model:'fixture:4b',host_id:'fixture-host',
    capabilities:['completion','tools'],chat_eligible:true,native_tools_capable:true,local_metadata_verified:true}]});
const response = (body,status=200) => ({ok:status>=200&&status<300,status,json:async()=>structuredClone(body)});
const ack = saved => ({...saved,ack:{configuration_saved:true,worker_started:false,runtime_verified:false}});
const operation = {kind:'socket',changes:{backend:'ollama',model:'fixture:4b',enabled:false,max_active_slots:2,residency_policy:'shared'}};
function changed() {const c=config(B);Object.assign(c.sockets[0],operation.changes);return c;}

test('strict configuration validation rejects cloud, identity, version and schema drift',()=>{
  for(const mutate of [c=>c.host_id=123,c=>c.configuration_version='unversioned',c=>c.source='example',
    c=>c.sockets[0].model='cloud:cloud',c=>c.sockets[0].backend='openrouter',c=>c.sockets[0].host_id='other',
    c=>c.sockets.push(structuredClone(c.sockets[0])),c=>c.sockets[0].slots[0].agent_id=123,
    c=>c.sockets[0].slots[0].context_tokens=0,c=>c.sockets[0].slots[0].socket_id='different']) {
    const c=config();mutate(c);assert.throws(()=>socketSnapshot(c));
  }
  const c=config(),copy=socketSnapshot(c);copy.sockets[0].enabled=false;assert.equal(c.sockets[0].enabled,true);
});

test('legacy projection reads never initialize, migrate or write',async()=>{
  const c=config();c.migration_required=true;c.source='legacy_projection';const calls=[];
  const fetcher=async(url,options)=>(calls.push({url,options}),response(c));
  const loaded=await loadSocketSnapshot(fetcher);assert.equal(loaded.migration_required,true);
  await assert.rejects(saveSocketChange(loaded,operation,fetcher),/nicht eingerichtet/);
  assert.equal(calls.length,1);assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'error');
});

test('catalogue validates native host and capabilities, retains embedding as non-chat',()=>{
  const c=catalog();const embedding={...c.models[0],socket_id:'model-'+'3'.repeat(24),model:'embedding:latest',
    capabilities:['embedding'],chat_eligible:false,native_tools_capable:false};c.models.push(embedding);
  assert.equal(modelCatalogue(c,'fixture-host').models[1].chat_eligible,false);
  assert.throws(()=>modelCatalogue(c,'other'));
  for(const change of [m=>m.model='glm:cloud',m=>m.backend='openrouter',m=>m.local_metadata_verified=false,
    m=>m.capabilities=['embedding'],m=>m.native_tools_capable=false]) {
    const value=catalog();change(value.models[0]);assert.throws(()=>modelCatalogue(value,'fixture-host'));
  }
});

test('agent choices combine existing and unbound IDs without inventing instances',()=>{
  assert.deepEqual(agentChoices(config()).map(a=>a.id).sort(),['external-agent','test-agent']);
  const c=config();c.sockets[0].slots[0].orphaned=true;
  assert.deepEqual(agentChoices(c).map(a=>a.id),['external-agent']);
});

test('socket write binds exact CAS, saves configuration only and verifies independent readback',async()=>{
  const calls=[],saved=changed();
  const result=await saveSocketChange(config(),operation,async(url,options)=>{
    calls.push({url,options});return response(options.method==='PUT'?ack(saved):saved);
  });
  assert.equal(result.configuration_version,B);assert.equal(calls.length,2);
  assert.equal(calls[0].url,'/api/system/model-sockets');
  assert.deepEqual(JSON.parse(calls[0].options.body),{configuration_version:A,changes:operation.changes});
  assert.ok(calls.every(c=>c.options.redirect==='error'));
  assert.equal(calls[1].options.method,'GET');
});

test('409 never retries with another CAS or changes the original draft',async()=>{
  const calls=[],c=config();
  await assert.rejects(saveSocketChange(c,operation,async(url,options)=>{
    calls.push({url,options});return response({detail:'conflict'},409);
  }),/inzwischen geändert/);
  assert.equal(calls.length,1);assert.equal(c.configuration_version,A);assert.equal(c.sockets[0].enabled,true);
});

test('unconfirmed ACK, cross-host and contradictory same-version readbacks cannot report success',async()=>{
  for(const bad of [saved=>saved.ack.worker_started=true,saved=>saved.ack.configuration_saved=false,
    saved=>saved.ack.runtime_verified=true,saved=>saved.host_id='other']) {
    const saved=ack(changed());bad(saved);
    await assert.rejects(saveSocketChange(config(),operation,async()=>response(saved)));
  }
  const contradict=changed();contradict.sockets[0].enabled=true;
  let n=0;await assert.rejects(saveSocketChange(config(),operation,async()=>response(n++?contradict:ack(changed()))),/stimmen nicht/);
  n=0;await assert.rejects(saveSocketChange(config(),operation,async()=>response(n++?config('c'.repeat(64)):ack(changed()))),/nach dem Speichern/);
});

test('binding writes preserve agent identity; removal preserves the profile in unbound IDs',async()=>{
  const op={kind:'bind',agent_id:'test-agent',socket_id:target,changes:{enabled:false,priority:'foreground',context_tokens:4096}};
  const saved=config(B);Object.assign(saved.sockets[0].slots[0],op.changes);
  const calls=[];await saveSocketChange(config(),op,async(url,options)=>(calls.push({url,options}),response(options.method==='PUT'?ack(saved):saved)));
  assert.equal(calls[0].url,'/api/system/model-sockets/bindings/test-agent/'+target);
  const removed=config(B);removed.sockets[0].slots=[];removed.unbound_agent_ids.push('test-agent');
  calls.length=0;
  const observed=await saveSocketChange(config(),{kind:'unbind',binding_id:binding},async(url,options)=>(calls.push({url,options}),response(options.method==='DELETE'?ack(removed):removed)));
  assert.equal(calls[0].options.method,'DELETE');assert.ok(agentChoices(observed).some(a=>a.id==='test-agent'));
});

test('external targets, arbitrary URLs and unsupported operations cannot dispatch a write',async()=>{
  let calls=0;const fetcher=async()=>{calls++;return response(config());};
  for(const op of [{...operation,changes:{...operation.changes,backend:'openrouter'}},
    {...operation,changes:{...operation.changes,url:'https://external.invalid'}},
    {kind:'migrate'},{kind:'bind',agent_id:'../../escape',socket_id:target,changes:{}},
    {kind:'unbind',binding_id:'../../escape'}]) await assert.rejects(saveSocketChange(config(),op,fetcher));
  assert.equal(calls,0);
});

class Element {
  constructor(tag='div') {this.tag=tag;this.children=[];this.handlers={};this.dataset={};this.value='';this.open=false;this.disabled=false;}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children=children;}
  addEventListener(type,handler) {this.handlers[type]=handler;}
  querySelector(selector) {const name=selector.match(/^\[name="([^"]+)"\]$/)?.[1];return flatten(this).find(n=>n.name===name);}
  showModal() {this.open=true;}
  close() {this.open=false;this.handlers.close?.({});}
  reportValidity() {return true;}
  set innerHTML(_) {throw new Error('Unsafe HTML rendering');}
}
function flatten(node) {return [node,...node.children.flatMap(flatten)];}
function harness(fetcher) {
  const names=['status','targets','catalogue-status','dialog','fields','form','feedback','save','add','title','close','refresh'];
  const elements=Object.fromEntries(names.map(name=>[name,new Element(name)]));
  const root={querySelector:selector=>elements[selector.match(/data-sockets-([^\]]+)/)[1]]};
  const handlers={};const window={confirm:()=>true,CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},
    addEventListener:(type,handler)=>handlers[type]=handler,dispatchEvent:event=>handlers[event.type]?.(event)};
  const app=mountModelSockets(root,{document:{createElement:tag=>new Element(tag)},window,fetcher});
  const click=label=>flatten(elements.targets).find(n=>n.tag==='button'&&n.textContent===label).handlers.click();
  return {app,elements,click,window};
}
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};

test('missing adapters and legacy migration leave configuration actions unavailable',async()=>{
  const missing=harness(async()=>response({},404));await missing.app.refresh();
  assert.match(missing.elements.status.textContent,/nicht angebunden/);assert.equal(missing.elements.add.disabled,true);
  const c=config();c.migration_required=true;c.source='legacy_projection';
  const legacy=harness(async(url)=>response(url.endsWith('/catalog')?catalog():c));await legacy.app.refresh();
  assert.ok(flatten(legacy.elements.targets).filter(n=>n.tag==='button').every(n=>n.disabled));
  assert.match(legacy.elements.status.textContent,/Vorschau/);
});

test('renderer uses text, collapses agent slots and never invents RAM or Running',async()=>{
  const c=config();c.sockets[0].slots[0].name='<img src=x onerror=attack()>';
  const h=harness(async url=>response(url.endsWith('/catalog')?catalog():c));await h.app.refresh();
  const all=flatten(h.elements.targets);
  assert.ok(all.some(n=>n.textContent==='<img src=x onerror=attack()>'));
  assert.ok(all.filter(n=>n.tag==='details').every(n=>!n.open));
  assert.ok(all.some(n=>n.textContent?.includes('nicht gemessen')));
  assert.ok(!all.some(n=>n.textContent==='Running'||n.textContent?.includes('0 GiB')));
  assert.match(h.elements['catalogue-status'].textContent,/LM Studio: Fähigkeiten nicht geprüft/);
});

test('UI preserves its loaded CAS and form draft across another profile editor change',async()=>{
  let current=config();const calls=[];
  const h=harness(async(url,options)=>{
    calls.push({url,options});return options.method==='PUT'?response({},409):response(url.endsWith('/catalog')?catalog():current);
  });await h.app.refresh();h.click('Modell bearbeiten');
  h.elements.fields.querySelector('[name="max-active"]').value='8';
  current=config(B);h.window.dispatchEvent({type:'bach:core-config-observed',detail:{configuration_version:B}});
  await h.app.refresh();
  assert.match(h.elements.feedback.textContent,/Entwurf bleibt sichtbar/);
  h.elements.form.handlers.submit({preventDefault(){}});await settle();
  const writes=calls.filter(c=>c.options.method==='PUT');assert.equal(writes.length,1);
  assert.equal(JSON.parse(writes[0].options.body).configuration_version,A);
  assert.equal(h.elements.fields.querySelector('[name="max-active"]').value,'8');
  assert.equal(h.elements.dialog.open,true);assert.match(h.elements.status.textContent,/inzwischen geändert/);
});

test('host refresh clears the old catalogue while new provider metadata is pending',async()=>{
  let current=config(), secondHost=false, resolveCatalogue;
  const old=catalog();old.models.push({...old.models[0],socket_id:'model-'+'3'.repeat(24),model:'fixture-extra:4b'});
  const h=harness(async url=>{
    if (!url.endsWith('/catalog')) return response(current);
    if (!secondHost) return response(old);
    return new Promise(resolve=>{resolveCatalogue=resolve;});
  });
  await h.app.refresh();assert.equal(h.elements.add.disabled,false);
  current=config(B);current.host_id='fixture-host-two';
  current.sockets.forEach(socket=>{socket.host_id=current.host_id;});secondHost=true;
  const refresh=h.app.refresh();await settle();
  assert.equal(h.elements.add.disabled,true);
  assert.match(h.elements['catalogue-status'].textContent,/wird neu geprüft/);
  assert.ok(flatten(h.elements.targets).some(n=>n.textContent==='Modellangebot und Fähigkeiten derzeit nicht bestätigt.'));
  const next=catalog();next.host_id=current.host_id;next.models=[];
  resolveCatalogue(response(next));await refresh;
  assert.equal(h.elements.add.disabled,true);
  assert.match(h.elements['catalogue-status'].textContent,/0 bestätigte Chatmodelle/);
});

test('an open draft cannot write after configuration becomes legacy or unavailable',async()=>{
  for (const unavailable of [false,true]) {
    let changedSource=false;const writes=[];
    const legacy=config(B);legacy.source='legacy_projection';legacy.migration_required=true;
    const h=harness(async(url,options)=>{
      if (options.method==='PUT') {writes.push(options);return response(ack(changed()));}
      if (url.endsWith('/catalog')) return response(catalog());
      return changedSource ? response(legacy,unavailable ? 503 : 200) : response(config());
    });
    await h.app.refresh();h.click('Modell bearbeiten');
    h.elements.fields.querySelector('[name="max-active"]').value='9';
    changedSource=true;await h.app.refresh();assert.equal(h.elements.save.disabled,true);
    h.elements.form.handlers.submit({preventDefault(){}});await settle();
    assert.equal(writes.length,0);assert.equal(h.elements.dialog.open,true);
    assert.equal(h.elements.fields.querySelector('[name="max-active"]').value,'9');
    assert.match(h.elements.feedback.textContent,/Entwurf bleibt erhalten/);
  }
});
