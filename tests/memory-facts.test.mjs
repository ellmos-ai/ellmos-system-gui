import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/pages/memory.astro',import.meta.url),'utf8');
const extract=(name,next)=>source.slice(source.indexOf(`  async function ${name}(`),source.indexOf(next,source.indexOf(`  async function ${name}(`)));
const submit=extract('factResponseError','  async function deleteFact(');
const load=extract('loadFactsTable','  async function factResponseError(');
function setup(fetch){
  const elements={
    'new-fact-cat':{value:'user'},'new-fact-key':{value:'Schlüssel'},'new-fact-val':{value:'Grüße'},
    'fact-error':{hidden:true,textContent:''},button:{disabled:false},'facts-table-container':{textContent:'',innerHTML:''},
  };
  let closed=0;
  const context={fetch,document:{getElementById:id=>elements[id],querySelector:()=>elements.button},
    toggleAddFactForm:()=>closed++,loadCognitiveState:()=>{},loadFactsTable:()=>{}};
  vm.createContext(context);vm.runInContext(submit,context);
  return {elements,context,closed:()=>closed};
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
  assert.equal(state.elements['new-fact-val'].value,'Grüße');assert.equal(state.closed(),0);assert.equal(state.elements.button.disabled,false);
});

test('Erfolgreiches Speichern schließt das Formular und leert den bestätigten Entwurf',async()=>{
  const state=setup(async()=>({ok:true}));await state.context.submitNewFact();
  assert.equal(state.closed(),1);assert.equal(state.elements['new-fact-key'].value,'');
  assert.equal(state.elements['new-fact-val'].value,'');assert.equal(state.elements['fact-error'].hidden,true);
  assert.equal(state.elements.button.disabled,false);
});

test('Unstrukturierte Fehlerantwort behält den Entwurf mit verständlicher Meldung',async()=>{
  const state=setup(async()=>({ok:false,json:async()=>null}));await state.context.submitNewFact();
  assert.equal(state.elements['fact-error'].textContent,'Fakt konnte nicht gespeichert werden.');
  assert.equal(state.elements['new-fact-val'].value,'Grüße');assert.equal(state.closed(),0);
});

test('Netzwerkfehler erhält Eingaben und gibt den Speichernknopf frei',async()=>{
  const state=setup(async()=>{throw Error('offline');});await state.context.submitNewFact();
  assert.match(state.elements['fact-error'].textContent,/Netzwerkfehler/);assert.equal(state.closed(),0);
  assert.equal(state.elements['new-fact-val'].value,'Grüße');assert.equal(state.elements.button.disabled,false);
});

test('Nicht verfügbarer Faktenspeicher wird nicht als leere Tabelle angezeigt',async()=>{
  const state=setup(async()=>({ok:false,json:async()=>({detail:{message:'Nicht verfügbar'}})}));
  vm.runInContext(load,state.context);await state.context.loadFactsTable();
  assert.equal(state.elements['facts-table-container'].textContent,'Fakten konnten nicht geladen werden.');
  assert.doesNotMatch(state.elements['facts-table-container'].innerHTML,/Keine Fakten/);
});
