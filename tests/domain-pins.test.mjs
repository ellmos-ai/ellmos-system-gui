import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePins,pinMenuRoute,validatePinAck,loadDomainPins,setDomainPin,subscribePins} from '../src/lib/domain-pins.mjs';
const pin=id=>({id,name:'Grüße '+id,icon:'🧩',workbench_url:'/domains/'+id});
const snapshot=(ids=['ati'],version='a'.repeat(64))=>({schema:'bach.domain-pins.v1',version,persisted:true,pins:ids.map(pin),total:ids.length});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
test('schema, unique stable IDs and version are required',()=>{
  assert.deepEqual(validatePins(snapshot()),snapshot());
  for(const data of [{pins:[]},{...snapshot(),schema:'other'},{...snapshot(),version:'bad'},
    {...snapshot(),persisted:null},{...snapshot(),total:2},{...snapshot(['ati','ati'])},
    snapshot(['../escape']),{...snapshot(),pins:[{id:'ati',name:3,icon:'🧩'}]}])assert.throws(()=>validatePins(data));
});
test('menu resolves only actual handlers and catalog selections',()=>{
  assert.equal(pinMenuRoute({...pin('ati'),workbench_url:'/ati'}),'/ati');
  for(const url of ['/domains/ai-media-editor','/foerderplaner','javascript:alert(1)','https://foreign.test/ati','/ati?redirect=evil'])
    assert.equal(pinMenuRoute({...pin('ai-media-editor'),workbench_url:url}),'/domains?domain=ai-media-editor');
  assert.throws(()=>pinMenuRoute(pin('../escape')));
});
test('ack must confirm exact domain, state and persisted list',()=>{
  const good={...snapshot(['ati','new'],'b'.repeat(64)),success:true,id:'new',pinned:true};
  assert.equal(validatePinAck(good,'new',true),good);
  for(const data of [{...good,id:'other'},{...good,pinned:false},{...good,success:false},
    {...good,persisted:false},{...good,pins:[pin('ati')],total:1}])assert.throws(()=>validatePinAck(data,'new',true));
});
test('native mutation binds version, updates subscribers and keeps other pins',async()=>{
  const old=globalThis.fetch;const requests=[],events=[];
  globalThis.fetch=async(url,options)=>{
    if(options?.method==='POST'){requests.push(JSON.parse(options.body));return response({...snapshot(['ati','new'],'b'.repeat(64)),success:true,id:'new',pinned:true});}
    return response(snapshot());
  };
  const stop=subscribePins((data,busy)=>events.push({version:data?.version,busy}));
  try{
    await loadDomainPins();await setDomainPin('new',true);
    assert.deepEqual(requests,[{pinned:true,version:'a'.repeat(64)}]);
    assert.equal(events.at(-1).version,'b'.repeat(64));assert.equal(events.at(-1).busy,false);
    assert.ok(events.some(e=>e.busy));
  }finally{stop();globalThis.fetch=old;}
});
test('late GET cannot replace the acknowledged pin mutation',async()=>{
  const old=globalThis.fetch;let release;
  globalThis.fetch=async()=>response(snapshot());await loadDomainPins();
  globalThis.fetch=(url,options)=>options?.method==='POST'
    ?Promise.resolve(response({...snapshot(['ati','new'],'b'.repeat(64)),success:true,id:'new',pinned:true}))
    :new Promise(resolve=>release=()=>resolve(response(snapshot())));
  try{
    const delayed=loadDomainPins();await setDomainPin('new',true);release();
    assert.equal((await delayed).version,'b'.repeat(64));
  }finally{globalThis.fetch=old;}
});
test('unconfirmed ACK invalidates writable state and is never retried automatically',async()=>{
  const old=globalThis.fetch;let writes=0;
  globalThis.fetch=async()=>response(snapshot());await loadDomainPins();
  globalThis.fetch=async(url,options)=>{if(options?.method==='POST'){writes++;return response({success:true});}return response(snapshot());};
  try{
    await assert.rejects(setDomainPin('new',true),/nicht bestätigt/);
    await assert.rejects(setDomainPin('new',true),/zuerst laden/);
    assert.equal(writes,1);await loadDomainPins();
  }finally{globalThis.fetch=old;}
});
test('conflict has no optimistic changes or automatic overwrite',async()=>{
  const old=globalThis.fetch;let writes=0;
  globalThis.fetch=async()=>response(snapshot());await loadDomainPins();
  globalThis.fetch=async(url,options)=>{if(options?.method==='POST'){writes++;return response({detail:'Pins geändert'},409);}return response(snapshot(['ati','foreign'],'c'.repeat(64)));};
  try{
    await assert.rejects(setDomainPin('new',true),/409/);assert.equal(writes,1);
    const current=await loadDomainPins();assert.deepEqual(current.pins.map(p=>p.id),['ati','foreign']);
  }finally{globalThis.fetch=old;}
});
test('second mutation is blocked while first is pending',async()=>{
  const old=globalThis.fetch;let finish;
  globalThis.fetch=async()=>response(snapshot());await loadDomainPins();
  globalThis.fetch=()=>new Promise(resolve=>finish=()=>resolve(response({...snapshot(['ati','new'],'b'.repeat(64)),success:true,id:'new',pinned:true})));
  try{
    const first=setDomainPin('new',true);await assert.rejects(setDomainPin('other',true),/bereits geprüft/);finish();await first;
  }finally{globalThis.fetch=old;}
});
test('header and page subscribe to the same native pin state',()=>{
  const header=readFileSync(new URL('../src/components/Header.astro',import.meta.url),'utf8');
  const page=readFileSync(new URL('../src/pages/domains.astro',import.meta.url),'utf8');
  const studio=readFileSync(new URL('../src/scripts/domain-studio.mjs',import.meta.url),'utf8');
  assert.match(header,/domain-pins-menu/);assert.match(header,/initializeDomainMenu/);
  assert.match(page,/domain-studio.mjs/);assert.match(studio,/subscribePins/);assert.match(studio,/setDomainPin/);
  assert.doesNotMatch(studio,/innerHTML/);
});
