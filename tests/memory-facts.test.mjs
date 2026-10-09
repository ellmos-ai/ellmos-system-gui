import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/pages/memory.astro',import.meta.url),'utf8');
const extract=(name,next)=>source.slice(source.indexOf(`  async function ${name}(`),source.indexOf(next,source.indexOf(`  async function ${name}(`)));
const submit=extract('factResponseError','  async function deleteFact(');
const load=extract('loadFactsTable','  async function factResponseError(');
const formControls=source.slice(source.indexOf('  let factSavePending = false;'),source.indexOf('  function escapeHtml('));
const ack=(overrides={})=>({ok:true,json:async()=>({status:'created',id:1,key:'Schlüssel',category:'user',...overrides})});
function setup(fetch){
  const elements={
    'new-fact-cat':{value:'user',disabled:false},'new-fact-key':{value:'Schlüssel',disabled:false},'new-fact-val':{value:'Grüße',disabled:false},
    'fact-error':{hidden:true,textContent:''},button:{disabled:false},cancel:{disabled:false},'btn-add-fact':{disabled:false},
    'facts-table-container':{textContent:'',innerHTML:''},
  };
  const controls=[elements['new-fact-cat'],elements['new-fact-key'],elements['new-fact-val'],elements.button,elements.cancel];
  const attrs={};
  elements['form-add-fact']={style:{display:'block'},querySelectorAll:()=>controls,
    setAttribute:(name,value)=>attrs[name]=value,removeAttribute:name=>delete attrs[name]};
  const context={fetch,document:{getElementById:id=>elements[id]},loadCognitiveState:()=>{},loadFactsTable:()=>{}};
  vm.createContext(context);vm.runInContext(formControls+submit,context);
  return {elements,context,attrs,controls:[...controls,elements['btn-add-fact']],closed:()=>elements['form-add-fact'].style.display==='none'};
}

test('Facts-Kategorien entsprechen dem kanonischen Vertrag; Lessons bleiben frei',()=>{
  const select=source.match(/<select id="new-fact-cat"[\s\S]*?<\/select>/)?.[0];
  assert.ok(select);assert.deepEqual([...select.matchAll(/option value="([^"]+)"/g)].map(m=>m[1]),['user','project','system','domain']);
  assert.match(source,/<input type="text" id="new-lesson-cat"/);
  assert.doesNotMatch(select,/architektur|general|pytest/);
});

test('Facts-Fehler bleibt lesbar im Formular und bewahrt den Entwurf',async()=>{
  let body;
  const state=setup(async(url,options)=>{body=JSON.parse(options.body);return {ok:false,json:async()=>({detail:{message:'Kategorie ungültig <b>Text</b>'}})};});
  await state.context.submitNewFact();
  assert.equal(body.category,'user');assert.equal(body.value,'Grüße');
  assert.equal(state.elements['fact-error'].textContent,'Kategorie ungültig <b>Text</b>');
  assert.equal(state.elements['fact-error'].hidden,false);assert.equal(state.elements['new-fact-key'].value,'Schlüssel');
  assert.equal(state.elements['new-fact-val'].value,'Grüße');assert.equal(state.closed(),false);assert.equal(state.elements.button.disabled,false);
});

test('Erfolgreiches Speichern schließt das Formular und leert den bestätigten Entwurf',async()=>{
  const state=setup(async()=>ack());await state.context.submitNewFact();
  assert.equal(state.closed(),true);assert.equal(state.elements['new-fact-key'].value,'');
  assert.equal(state.elements['new-fact-val'].value,'');assert.equal(state.elements['fact-error'].hidden,true);
  assert.equal(state.elements.button.disabled,false);
});

test('Unstrukturierte Fehlerantwort behält den Entwurf mit verständlicher Meldung',async()=>{
  const state=setup(async()=>({ok:false,json:async()=>null}));await state.context.submitNewFact();
  assert.equal(state.elements['fact-error'].textContent,'Fakt konnte nicht gespeichert werden.');
  assert.equal(state.elements['new-fact-val'].value,'Grüße');assert.equal(state.closed(),false);
});

test('Netzwerkfehler erhält Eingaben und gibt den Speichernknopf frei',async()=>{
  const state=setup(async()=>{throw Error('offline');});await state.context.submitNewFact();
  assert.match(state.elements['fact-error'].textContent,/Netzwerkfehler/);assert.equal(state.closed(),false);
  assert.equal(state.elements['new-fact-val'].value,'Grüße');assert.equal(state.elements.button.disabled,false);
});

test('Verzögerte Antwort sperrt Eingaben und Formularwechsel und verhindert doppelte Requests',async()=>{
  let resolve,calls=0;
  const state=setup(()=>{calls++;return new Promise(done=>resolve=done);});
  const pending=state.context.submitNewFact();
  assert.ok(state.controls.every(control=>control.disabled));assert.equal(state.attrs['aria-busy'],'true');
  state.context.toggleAddFactForm();assert.equal(state.closed(),false);
  await state.context.submitNewFact();assert.equal(calls,1);
  resolve(ack());await pending;
  assert.equal(state.closed(),true);assert.ok(state.controls.every(control=>!control.disabled));
  assert.equal(state.attrs['aria-busy'],undefined);
  state.context.toggleAddFactForm();assert.equal(state.closed(),false);
});

test('Fehlerantwort gibt alle Formularaktionen frei und erhält zuvor gesperrte Controls',async()=>{
  const state=setup(async()=>({ok:false,json:async()=>({detail:'Konflikt'})}));
  state.elements['btn-add-fact'].disabled=true;
  await state.context.submitNewFact();
  assert.ok(state.controls.slice(0,-1).every(control=>!control.disabled));
  assert.equal(state.elements['btn-add-fact'].disabled,true);assert.equal(state.closed(),false);
  assert.equal(state.elements['new-fact-val'].value,'Grüße');
  state.context.toggleAddFactForm();assert.equal(state.closed(),true);
});

for (const response of [null,{}, {status:'created',id:1,key:'Anderer Entwurf',category:'user'},
  {status:'created',id:1,key:'Schlüssel',category:'system'}, {status:'created',id:0,key:'Schlüssel',category:'user'}]) {
  test(`Unbestätigte Erfolgsantwort löscht den Entwurf nicht: ${JSON.stringify(response)}`,async()=>{
    const state=setup(async()=>({ok:true,json:async()=>response}));await state.context.submitNewFact();
    assert.equal(state.closed(),false);assert.equal(state.elements['new-fact-val'].value,'Grüße');
    assert.match(state.elements['fact-error'].textContent,/nicht bestätigt/);
    assert.ok(state.controls.every(control=>!control.disabled));
  });
}

test('Nicht verfügbarer Faktenspeicher wird nicht als leere Tabelle angezeigt',async()=>{
  const state=setup(async()=>({ok:false,json:async()=>({detail:{message:'Nicht verfügbar'}})}));
  vm.runInContext(load,state.context);await state.context.loadFactsTable();
  assert.equal(state.elements['facts-table-container'].textContent,'Fakten konnten nicht geladen werden.');
  assert.doesNotMatch(state.elements['facts-table-container'].innerHTML,/Keine Fakten/);
});
