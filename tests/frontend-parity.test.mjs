import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const page=read('src/pages/agenten/running.astro');
const start=page.indexOf('function workerReadiness('),end=page.indexOf('async function loadBackgroundWorkers(',start);
const readiness=vm.runInNewContext('('+page.slice(start,end).trim()+')');
function paths(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?paths(new URL(entry.name+'/',directory)):[new URL(entry.name,directory)]);}
test('all twenty-two productive pages, including the five separate capability boards, are present',()=>{
  assert.equal(paths(new URL('src/pages/',root)).filter(path=>path.pathname.endsWith('.astro')).length,22);
  for(const path of ['user-inbox','agenten/blueprints','skills/plugins','skills/mcp','skills/software','skills/ocean'])assert.ok(read('src/pages/'+path+'.astro'));
});
test('the shared branding contract and bundled same-origin authentication stay intact',()=>{
  assert.match(read('src/components/Header.astro'),/\/api\/gui\/brand/);
  assert.match(read('src/layouts/BachLayout.astro'),/src="\/device-fetch\.js"/);
  assert.doesNotMatch(read('src/layouts/BachLayout.astro'),/src="\/static\/js\/device-fetch\.js"/);
});
test('Idle readiness and activity are never supplied by fixed success text',()=>{
  assert.match(page,/<p id="compute-turn-status">Nicht geprüft<\/p>/);
  assert.doesNotMatch(page,/Aktiv \(Bereit\)/);
  assert.match(page,/data\.schema !== 'bach\.workers\.status\.v1'/);
});
test('expired, failed, paused and unrecognized profiles do not count as ready',()=>{
  for(const status of ['expired','deleted','error','paused','starting','stopping','unexpected'])
    assert.equal(readiness({status,backend:'ollama',model:'synthetic-local'}).ready,false,status);
  for(const status of ['idle','completed'])assert.equal(readiness({status,backend:'ollama',model:'synthetic-local'}).ready,true,status);
  assert.equal(readiness({status:'idle',backend:'ollama',model:''}).canStart,false);
  assert.equal(readiness({status:'expired',backend:'ollama',model:'synthetic-local'}).canStart,false);
  assert.equal(readiness({status:'unexpected'}).label,'Status unbekannt');
});
test('every recorded imported file matches its final working source hash',()=>{
  const provenance=JSON.parse(read('SOURCE_PROVENANCE.json'));
  assert.equal(provenance.reviewed_source_commit,'8884fcd2277f5db89e1a267a81042b33358278b8');
  for(const [path,digest] of Object.entries(provenance.files_sha256))
    assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'),digest,path);
  const imported=provenance.source_imports.at(-1);
  for(const [path,record] of Object.entries(imported.files))
    assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'),record.imported_sha256,path);
});

test('verified core errors and unknown states never become ready',()=>{
  const start=page.indexOf('function coreAgentLabel('),end=page.indexOf('function renderRunningSystemSlots(',start);
  const label=vm.runInNewContext('('+page.slice(start,end).trim()+')');
  const base={runtime_verified:true,enabled:true,backend:'ollama',model:'synthetic-local'};
  assert.equal(label({...base,status:'error'}),'Fehler · Status prüfen');
  assert.equal(label({...base,status:'expired'}),'Abgelaufen');
  assert.equal(label({...base,status:'unexpected'}),'Status unbekannt');
  assert.equal(label({...base,status:'idle',model:''}),'Modell oder Anbieter fehlt');
  assert.equal(label({...base,status:'idle'}),'Ready · Living');
  assert.equal(label({...base,status:'running',running:true,runtime_verified:false}),'Status unbekannt');
});

test('the deprecated Agents-Board is absent from navigation',()=>{
  const areas=JSON.parse(read('src/config/nav_config.json'));
  const dashboard=areas.find(area=>area.href==='/');
  assert.ok(dashboard);
  assert.equal(dashboard.children,undefined,'Dashboard must remain a direct link');
  const hrefs=areas.flatMap(area=>area.children||[]).map(item=>item.href);
  assert.ok(hrefs.includes('/agenten/blueprints'));
  assert.ok(hrefs.includes('/agenten/marblerun'));
  assert.ok(hrefs.includes('/tasks'));
  assert.ok(hrefs.includes('/skills'));
  assert.ok(!hrefs.includes('/agents-board'));
  assert.ok(!hrefs.includes('/skills-board'));
});
