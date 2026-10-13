import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/pages/memory.astro',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('  function escapeHtml('),source.indexOf('  function toggleAddLessonForm('));
const candidates=source.slice(source.indexOf('  async function loadHermesCandidates('),source.indexOf('  async function submitHermesDistill('));
const modal=source.slice(source.indexOf('  async function viewCandidateModal('),source.indexOf('  function closeCandidateModal('));

function contextFor(fetch,elements={}){
  const document={
    getElementById:id=>elements[id]??null,
    createElement:()=>({
      _text:'',
      set textContent(value){this._text=String(value??'');},
      get innerHTML(){return this._text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');},
    }),
  };
  const context={fetch,document,alert:()=>{}};
  vm.createContext(context);
  vm.runInContext(helpers,context);
  return context;
}

test('Hermes-Kandidaten zeigen neue und historische Konfidenz ohne Fallback',async()=>{
  const container={innerHTML:'',textContent:''};
  const context=contextFor(async()=>({ok:true,json:async()=>({candidates:[
    {id:1,name:'Neue Lesson',version:'1.0.0',status:'pending',confidence:null,confidence_status:'not_measured'},
    {id:2,name:'Legacy Zero',version:'1.0.0',status:'pending',confidence:0,confidence_status:'legacy_heuristic_unvalidated'},
  ]})}),{'hermes-candidates-container':container});
  vm.runInContext(candidates,context);
  await context.loadHermesCandidates();
  assert.match(container.innerHTML,/Nicht erhoben/);
  assert.match(container.innerHTML,/Heuristischer Altwert 0\.00 · nicht validiert/);
  const confidenceLabels = [...container.innerHTML.matchAll(/Konfidenz: <strong>([^<]*)<\/strong>/g)].map(match => match[1]);
  assert.deepEqual(confidenceLabels,['Nicht erhoben','Heuristischer Altwert 0.00 · nicht validiert']);
  assert.doesNotMatch(confidenceLabels.join(' '),/0\.85|1\.00|gemessen/i);
});

test('Kandidaten-Detail zeigt denselben Status ohne den SKILL-Inhalt zu verändern',async()=>{
  const elements={
    'hermes-candidate-modal':{style:{display:'none'}},
    'hermes-modal-title':{textContent:''},
    'hermes-modal-content':{textContent:''},
    'hermes-modal-confidence':{textContent:''},
  };
  const context=contextFor(async()=>({ok:true,json:async()=>({
    id:7,name:'unknown-confidence',version:'1.2.3',content:'confidence: null\n',
    confidence:null,confidence_status:'not_measured',
  })}),elements);
  vm.runInContext(modal,context);
  await context.viewCandidateModal(7);
  assert.equal(elements['hermes-modal-confidence'].textContent,'Konfidenz: Nicht erhoben');
  assert.equal(elements['hermes-modal-content'].textContent,'confidence: null\n');
  assert.equal(elements['hermes-candidate-modal'].style.display,'flex');
});

test('Unbekannte und ungültige Confidence-DTOs werden nicht als gemessen ausgegeben',()=>{
  const context=contextFor(async()=>({}));
  assert.equal(context.confidenceLabel(undefined,undefined),'Nicht verfügbar');
  assert.equal(context.confidenceLabel(true,'legacy_heuristic_unvalidated'),'Nicht verifiziert');
  assert.equal(context.confidenceLabel(Number.NaN,'legacy_heuristic_unvalidated'),'Nicht verifiziert');
  assert.equal(context.confidenceLabel(Number.POSITIVE_INFINITY,'legacy_heuristic_unvalidated'),'Nicht verifiziert');
});
