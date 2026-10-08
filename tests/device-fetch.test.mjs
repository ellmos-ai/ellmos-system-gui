import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('../public/device-fetch.js',import.meta.url),'utf8');
function harness({credential='synthetic-device-fixture',blocked=false,status=200}={}) {
  const calls=[], notices=[];
  const location={origin:'https://gui.example.test',href:'https://gui.example.test/tasks'};
  const document={body:{prepend(node){notices.push(node);}},getElementById(){return notices[0]||null;},
    createElement(tag){return {tag,children:[],setAttribute(){},append(...items){this.children.push(...items);}};}};
  const window={fetch:async(input,options)=>{calls.push({input,options});return {status};}};
  const context=vm.createContext({window,location,document,URL,Request,Headers,
    localStorage:{getItem(){if(blocked)throw Error('Storage unavailable');return credential;}}});
  vm.runInContext(script,context);
  return {window,calls,notices,context};
}
test('device credential is attached only to a same-origin API, including Request inputs',async()=>{
  const h=harness();
  await h.window.fetch('/api/tasks');
  await h.window.fetch(new Request('https://gui.example.test/api/system/core-agents'));
  for(const call of h.calls)assert.equal(call.options.headers.get('Authorization'),'Bearer synthetic-device-fixture');
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
test('missing or blocked storage does not invent an authorization header',async()=>{
  for(const options of [{credential:''},{blocked:true}]){
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
