import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const page=readFileSync(new URL('../src/pages/settings.astro',import.meta.url),'utf8');
function harness(theme) {
 const elements=Object.fromEntries(['theme-status','theme-save','theme-select'].map(id=>[id,{disabled:true,value:'',textContent:''}]));
 const storage=new Map([['bach_device_token','test-fixture-token']]);
 let applied=null;
 const context={document:{getElementById:id=>elements[id],documentElement:{removeAttribute:()=>{applied='dark';},setAttribute:(key,value)=>{applied=value;}}},
  localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
  fetch:async()=>({ok:true,json:async()=>({success:true,theme,configured:true})})};
 const start=page.indexOf('function applyStoredTheme('),end=page.indexOf('async function saveTheme(',start);
 const load=vm.runInNewContext('(function(){'+page.slice(start,end)+';return loadTheme;})()',context);
 return {load,elements,applied:()=>applied,storage};
}
test('all four native themes have a settings option and load their real backend selection',async()=>{
 for(const theme of ['dark','light','ocean','warm']){
  assert.match(page,new RegExp('<option value="'+theme+'">'));
  const h=harness(theme);await h.load();
  assert.equal(h.elements['theme-select'].value,theme);
  assert.equal(h.applied(),theme);
  assert.equal(h.elements['theme-save'].disabled,false);
 }
});
test('an unrecognized backend theme stays unavailable and cannot be saved',async()=>{
 const h=harness('invalid');await h.load();
 assert.equal(h.elements['theme-save'].disabled,true);
 assert.equal(h.applied(),null);
 assert.match(h.elements['theme-status'].textContent,/nicht verfügbar/);
});
