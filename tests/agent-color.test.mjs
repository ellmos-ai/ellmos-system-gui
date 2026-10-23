import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeAgentColor, applyAgentColor, colorReadbackMatches} from '../src/scripts/agent-color.mjs';
const running = readFileSync(new URL('../src/pages/agenten/running.astro', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../src/scripts/blueprint-studio.mjs', import.meta.url), 'utf8');

test('only six-digit hex is accepted; CSS injection, types and partial hashes stay inert', () => {
  assert.equal(normalizeAgentColor('#A1b2C3'), '#a1b2c3');
  for (const value of [undefined,null,{},true,0,'red','#fff','#aabbcc;display:none','#aabbcc\n',' #aabbcc','#aabbccff'])
    assert.equal(normalizeAgentColor(value), null, String(value));
});
function cardFixture() {
  const values = new Map([['color','var(--text)'],['background','var(--bg-card)'],['border-color','var(--error)']]);
  const card = {dataset:{},children:[],ownerDocument:{createElement:()=>({dataset:{},style:{setProperty(){}},remove(){card.children=card.children.filter(c=>c!==this);}})},
    style:{setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k)},
    querySelector:()=>card.children.find(c=>'agentColorNote' in c.dataset),
    append:node=>card.children.push(node)};
  return {card,values};
}
test('blueprint/instance accents preserve text, surface and runtime status, refresh clears old accents', () => {
  const {card,values} = cardFixture();
  card.dataset.status='error';
  applyAgentColor(card,{color:'#123ABC',color_source:'blueprint'});
  assert.equal(values.get('border-inline-start'),'6px solid #123abc');
  assert.equal(card.children[0].textContent,'Blueprint-Farbe');
  applyAgentColor(card,{color:'#ffffff',color_source:'instance'});
  assert.equal(card.children.length,1);
  assert.equal(card.children[0].textContent,'Eigene Instanzfarbe');
  assert.equal(card.dataset.agentColorSource,'instance');
  assert.equal(values.get('color'),'var(--text)');
  assert.equal(values.get('background'),'var(--bg-card)');
  assert.equal(values.get('border-color'),'var(--error)');
  assert.equal(card.dataset.status,'error');
  applyAgentColor(card,{color:'url(secret)'});
  assert.equal(values.has('border-inline-start'),false);
  assert.equal(card.children.length,0);
  assert.equal(card.dataset.agentColorSource,'default');
  applyAgentColor(card,{color:'#aabbcc',color_source:'unknown'});
  assert.equal(values.has('border-inline-start'),false);
  assert.equal(card.children.length,0);
});
test('saved color readback requires exact value including clear, while legacy omission is compatible', () => {
  assert.equal(colorReadbackMatches({color:'#aabbcc'},'#aabbcc'),true);
  assert.equal(colorReadbackMatches({color:null},null),true);
  for (const r of [{},{color:'#ffffff'},{color:'#AABBCC'}]) assert.equal(colorReadbackMatches(r,'#aabbcc'),false);
  assert.equal(colorReadbackMatches({},null),false);
  assert.equal(colorReadbackMatches({},undefined),true);
});
test('new appearance inputs are gated on the backend color contract', () => {
  assert.match(studio,/data.color_contract==="bach.agent-colors.v1"/);
  assert.match(studio,/state.colorSupported\?\{color:/);
  assert.match(studio,/bp-use-color"\).disabled = !state.colorSupported/);
  assert.match(running,/coreCatalog.color_contract === 'bach.agent-colors.v1'/);
  assert.equal((running.match(/BachAgentColor\?\.applyAgentColor\(card,/g)||[]).length,3);
});
const saveSource = running.slice(running.indexOf('async function saveCoreSlot()'),running.indexOf('async function resetCoreSlot'));
test('actual core save handler clears override with null, canonicalizes hex and retains CAS errors', async () => {
  assert.ok(saveSource.includes('async function saveCoreSlot()'));
  for (const [input,previous,expected,conflict,mismatch=false] of [
    ['', '#aabbcc', null, false],['#ABCDEF',null,'#abcdef',false],['#123456',null,'#123456',true],['#654321',null,'#654321',false,true]
  ]) {
    let posted,rendered=false,closed=false;
    const feedback={textContent:''};
    const form={querySelectorAll:()=>[{dataset:{coreField:'color_override'},type:'text',value:input}],querySelector:()=>null};
    const nodes={'core-slot-fields':form,'core-slot-editor-feedback':feedback,
      'core-slot-avatar':{value:''},'core-slot-symbol':{value:''},
      'core-slot-editor':{close(){closed=true;}},'core-agent-feedback':{textContent:''}};
    const context=vm.createContext({document:{getElementById:id=>nodes[id]},
      coreEditorAgent:{id:'system-blueprint-7',color_override:previous,avatar:'',symbol:''},coreEditorVersion:'original-version',
      coreRequest:async(path,method,body)=>{posted={path,method,body};if(conflict)throw new Error('configuration_version_conflict');return {agents:[{id:'system-blueprint-7',color_override:mismatch?null:expected}]};},
      renderCoreAgents:()=>{rendered=true;}});
    await vm.runInContext(saveSource+'; saveCoreSlot()',context);
    assert.equal(posted.body.changes.color_override,expected);
    assert.equal(posted.body.configuration_version,'original-version');
    assert.equal(posted.method,'PUT');
    assert.equal(rendered,!conflict&&!mismatch);
    assert.equal(closed,!conflict&&!mismatch);
    if(conflict) assert.match(feedback.textContent,/configuration_version_conflict/);
    if(mismatch) assert.match(feedback.textContent,/Farbe nicht bestätigt/);
  }
});
test('actual blueprint submit handler keeps draft open when color reload differs', async () => {
  const start=studio.indexOf('handle("blueprint-form","submit",')+'handle("blueprint-form","submit",'.length;
  const end=studio.indexOf('},"editor-status");',start)+1;
  const handlerSource=studio.slice(start,end);
  for(const mismatch of [false,true]) {
    let closed=false,loaded=false;
    const button={disabled:false};
    const payload={expected_version:1,persona_prompt:'role',color:'#aabbcc'};
    const readback={id:7,version:2,persona_prompt:'role',color:mismatch?null:'#aabbcc'};
    const context=vm.createContext({editorPayload:()=>payload,$:()=>button,post:async()=>({id:7}),
      loadData:async()=>{loaded=true;},byId:()=>readback,colorReadbackMatches,
      close:()=>{closed=true;},state:{library:'templates'},render(){},notify(){}});
    const handler=vm.runInContext('('+handlerSource+')',context);
    if(mismatch) await assert.rejects(handler({preventDefault(){}}),/Version nicht bestätigt/);
    else await handler({preventDefault(){}});
    assert.equal(loaded,true);
    assert.equal(closed,!mismatch);
    assert.equal(button.disabled,false);
  }
});
