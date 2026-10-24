import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {consumerApiHeaders} from '../src/lib/consumer-api-auth.mjs';
const script=readFileSync(new URL('../public/device-fetch.js',import.meta.url),'utf8');
function harness({blocked=false,status=200}={}) {
  const calls=[], notices=[];
  const location={origin:'https://gui.example.test',href:'https://gui.example.test/tasks'};
  const document={body:{prepend(node){notices.push(node);}},getElementById(){return notices[0]||null;},
    createElement(tag){return {tag,children:[],setAttribute(){},append(...items){this.children.push(...items);}};}};
  const window={fetch:async(input,options)=>{calls.push({input,options});return {status};}};
  const context=vm.createContext({window,location,document,URL,Request,Headers,
    localStorage:{getItem(){if(blocked)throw Error('Storage unavailable');throw Error('device token must not be read from localStorage');}}});
  vm.runInContext(script,context);
  return {window,calls,notices,context};
}
test('same-origin API requests rely on the browser-managed cookie, including Request inputs',async()=>{
  const h=harness();
  await h.window.fetch('/api/tasks');
  await h.window.fetch(new Request('https://gui.example.test/api/system/core-agents'));
  for(const call of h.calls)assert.equal(call.options.headers.has('Authorization'),false);
  for(const url of ['https://external.example.test/api/tasks','http://gui.example.test/api/tasks','/assets/image.png'])
    await h.window.fetch(url);
  for(const call of h.calls.slice(2))assert.equal(call.options.headers,undefined);
});
test('explicit authorization is preserved and caller headers are not mutated',async()=>{
  const h=harness(), headers={Authorization:'Explicit fixture',Accept:'application/json'};
  await h.window.fetch('/api/tasks',{headers});
  assert.equal(h.calls[0].options.headers.get('Authorization'),'Explicit fixture');
  assert.deepEqual(headers,{Authorization:'Explicit fixture',Accept:'application/json'});
});
test('blocked storage does not affect cookie transport or invent an authorization header',async()=>{
  for(const options of [{blocked:true},{}]){
    const h=harness(options);await h.window.fetch('/api/tasks');
    assert.equal(h.calls[0].options.headers.has('Authorization'),false);
  }
});
test('authentication failures create one local login notice without disclosing credentials',async()=>{
  const h=harness({status:401});await h.window.fetch('/api/tasks');await h.window.fetch('/api/tasks');
  assert.equal(h.notices.length,1);
  assert.equal(h.notices[0].children[1].href,'/token-dashboard');
  assert.doesNotMatch(JSON.stringify(h.notices),/synthetic-device-fixture/);
});
test('reloading the script keeps one fetch wrapper',()=>{
  const h=harness(),original=h.window.fetch;vm.runInContext(script,h.context);assert.equal(h.window.fetch,original);
});

test('policy headers ignore stale or blocked browser storage and preserve caller authority',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  try {
    for (const blocked of [false,true]) {
      let reads=0;
      Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){
        reads++;if(blocked)throw Error('Storage unavailable');
        return {getItem:()=> 'obsolete-fixture-device-token'};
      }});
      assert.equal(consumerApiHeaders().has('Authorization'),false);
      for (const initial of [
        {Accept:'application/json','X-BACH-Result-Operator':'temporary-fixture-operator'},
        new Headers({Authorization:'Explicit fixture','X-BACH-Result-Operator':'temporary-fixture-operator'}),
        [['Accept','application/json'],['X-BACH-Result-Operator','temporary-fixture-operator']],
      ]) {
        const before=new Headers(initial),headers=consumerApiHeaders(initial);
        assert.deepEqual([...headers],[...before]);
        headers.set('Accept','changed');
        assert.deepEqual([...new Headers(initial)],[...before],'caller headers remain unchanged');
      }
      assert.equal(reads,0,'legacy storage must not override the browser session cookie');
    }
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);
    else delete globalThis.localStorage;
  }
});
