import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {
  applyAgentOverviewToContainer,
  classifyActualStartType,
  classifyAgentAccess,
  classifyAgentFunction,
  createAgentOverviewContent,
  createAgentOverviewController,
  decorateAgentOverviewCard,
  isConfirmedAgentRunning,
  normalizeAgentOverviewPreferences,
  projectAgentOverview,
  projectRunningSourceNotice,
  readAgentOverviewPreferences,
  summarizeAgentActivity,
  workerActivityLabel,
  writeAgentOverviewPreferences,
} from '../src/lib/agent-overview.mjs';

const runningPage = readFileSync(new URL('../src/pages/agenten/running.astro', import.meta.url), 'utf8');
const dashboardPage = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
const pickerScript = readFileSync(new URL('../src/scripts/agent-template-picker.mjs', import.meta.url), 'utf8');

test('access, function, and actual start are separate evidence facets', () => {
  assert.equal(classifyAgentAccess({backend:'ollama', model:'qwen'}), 'local');
  assert.equal(classifyAgentAccess({backend:'ollama', model:'qwen:cloud'}), 'cloud');
  assert.equal(classifyAgentAccess({backend:'openrouter', model:'provider/model'}), 'cloud');
  assert.equal(classifyAgentAccess({backend:'codex', model:'subscription-route'}), 'prompt');
  assert.equal(classifyAgentAccess({backend:'hermes', model:'possibly-local'}), 'unknown');
  assert.equal(classifyAgentAccess({backend:'new-provider', model:'model'}), 'unknown');
  assert.deepEqual(classifyAgentFunction({backend:'ollama', role_id:'reviewer'}, 'core'), {id:'reviewer', label:'reviewer'});
  assert.deepEqual(classifyAgentFunction({backend:'openrouter', role_id:'reviewer'}, 'core'), {id:'reviewer', label:'reviewer'});
  assert.equal(classifyActualStartType({run_mode:'always_on', trigger:'cron', mode:'safe'}), 'unknown');
  const pinnedManual = {actual_start_cause:'manual',run_id:'a'.repeat(32),
    definition_ref:{blueprint_id:7,version:2,sha256:'b'.repeat(64)},
    configuration_ref:{sha256:'c'.repeat(64)}};
  assert.equal(classifyActualStartType(pinnedManual), 'manual');
  assert.equal(classifyActualStartType({...pinnedManual,configuration_ref:null}), 'unknown');
  assert.equal(normalizeAgentOverviewPreferences({start:'manual'}).start, 'manual');
});

test('only a verified running projection enters the active lane', () => {
  assert.equal(classifyActualStartType({actual_start_type:'manual'}), 'unknown');
  assert.equal(isConfirmedAgentRunning({runtime_verified:true,running:true,status:'running'}), true);
  assert.equal(isConfirmedAgentRunning({runtime_verified:true,running:true,status:'stopping'}), false);
  assert.equal(isConfirmedAgentRunning({runtime_verified:false,running:true,status:'running'}), false);
});

test('confirmed Running cards remain visible while mixed source state is explicitly uncertain', () => {
  const notice = projectRunningSourceNotice([
    {count:1,state:'available'},
    {count:0,state:'unconfirmed'},
  ]);
  assert.equal(notice.hidden, false);
  assert.match(notice.text, /Bestätigte Läufe werden angezeigt/);
  assert.match(notice.text, /unvollständig oder nicht verfügbar/);

  assert.equal(workerActivityLabel(1, true), '1 bestätigt aktiv (Running) · weitere Laufzustände unbestätigt');
  assert.equal(workerActivityLabel(0, true), '0 bestätigt aktiv (Running) · weitere Laufzustände unbestätigt');
  assert.doesNotMatch(workerActivityLabel(0, true), /\b0 aktiv \(Running\)/);
  assert.deepEqual(projectRunningSourceNotice([
    {count:1,state:'available'},
    {count:0,state:'available'},
  ]), {hidden:true,text:''});
  assert.deepEqual(projectRunningSourceNotice([
    {count:0,state:'available'},
    {count:0,state:'available'},
  ]), {hidden:false,text:'Kein Agentenlauf aktiv.'});
  assert.match(runningPage, /projectRunningSourceNotice\(sources,/);
  assert.match(runningPage, /workerActivityLabel\?\.\(runningWorkers\.length, workerStatusUnknown\)/);
});

test('dashboard never reports zero when either live source has uncertain runtime state', () => {
  const confirmed = summarizeAgentActivity({schema:'bach.workers.status.v1',availability:'available',workers:[
    {id:'worker',runtime_verified:true,running:true,status:'running'},
    {id:'system-copy',system:true,runtime_verified:false,running:true,status:'running'},
  ]},{schema:'bach.core-system-agents.v1',agents:[
    {id:'core',runtime_verified:true,running:false,status:'idle'},
  ]});
  assert.equal(confirmed.available, true);
  assert.equal(confirmed.complete, true);
  assert.equal(confirmed.active.length, 1);
  assert.equal(confirmed.total, 2);
  const uncertain = summarizeAgentActivity({schema:'bach.workers.status.v1',availability:'available',workers:[
    {id:'starting',runtime_verified:true,running:false,status:'starting'},
  ]},{schema:'bach.core-system-agents.v1',agents:[]});
  assert.equal(uncertain.available, true);
  assert.equal(uncertain.complete, false);
  assert.equal(uncertain.active.length, 0);
  const unavailable = summarizeAgentActivity({schema:'bach.workers.status.v1',availability:'unavailable',workers:[]},{schema:'bach.core-system-agents.v1',agents:[]});
  assert.equal(unavailable.available, false);
});

test('pure projection filters and groups interleaved facets consistently', () => {
  const records = [
    {source:'worker',agent:{id:'zulu',name:'Zulu',backend:'ollama',model:'qwen',status:'idle'}},
    {source:'worker',agent:{id:'alpha',name:'Alpha',backend:'openrouter',model:'x',status:'idle'}},
    {source:'worker',agent:{id:'beta',name:'Beta',backend:'lmstudio',model:'local',status:'idle'}},
  ];
  const grouped = projectAgentOverview(records, {sort:'name',group:'access'});
  assert.deepEqual(grouped.groups.map(group=>group.label), ['Cloud / API','Lokal']);
  assert.deepEqual(grouped.groups.map(group=>group.items.map(item=>item.name)), [['Alpha'],['Beta','Zulu']]);
  const filtered = projectAgentOverview(records, {access:'local',query:'bet',sort:'name'});
  assert.deepEqual(filtered.items.map(item=>item.name), ['Beta']);
  assert.equal(filtered.total, 3);
  assert.equal(filtered.visible, 1);
});

test('preference storage failures fall back without interrupting the controls', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', {configurable:true,get(){throw new Error('blocked storage getter');}});
    assert.deepEqual(readAgentOverviewPreferences(), normalizeAgentOverviewPreferences({}));
    assert.deepEqual(writeAgentOverviewPreferences({view:'list'}), normalizeAgentOverviewPreferences({view:'list'}));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

class FakeElement {
  constructor(tag, ownerDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.dataset = {};
    this.children = [];
    this.hidden = false;
    this.className = '';
    this.parentNode = null;
    this.textContent = '';
    this.classList = {toggle:(name, enabled)=>{
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      if (enabled) classes.add(name); else classes.delete(name);
      this.className = [...classes].join(' ');
      return enabled;
    }};
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(child=>child !== node);
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(type, callback) {
    this.listeners ||= {};
    this.listeners[type] = callback;
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child=>child !== this);
    this.parentNode = null;
  }
  querySelectorAll(selector) {
    if (selector === ':scope > [data-agent-overview-group]') return this.children.filter(node=>node.dataset.agentOverviewGroup);
    return [];
  }
}

function fakeContainer() {
  const document = {createElement(tag){return new FakeElement(tag, document);}};
  return new FakeElement('div', document);
}

function fakeOverviewRoot() {
  const controls = [];
  const document = {
    createElement(tag){return new FakeElement(tag, document);},
    querySelectorAll(selector){return selector === '[data-agent-overview-control]' ? controls : [];},
  };
  for (const key of ['query','access','function','start','sort','group','view']) {
    const control = new FakeElement(key === 'query' ? 'input' : 'select', document);
    control.dataset.agentOverviewControl = key;
    controls.push(control);
  }
  return {document, controls};
}

test('the same access filter and grouping control affect Ready and Running DOM cards', () => {
  const ready = fakeContainer();
  const running = fakeContainer();
  const readyLocal = new FakeElement('article', ready.ownerDocument);
  const runningCloud = new FakeElement('article', running.ownerDocument);
  const runningLocal = new FakeElement('article', running.ownerDocument);
  decorateAgentOverviewCard(readyLocal, {id:'ready-local',name:'Zulu',backend:'ollama',model:'qwen',status:'idle'}, {source:'worker',lane:'ready'});
  decorateAgentOverviewCard(runningCloud, {id:'active-cloud',name:'Alpha',backend:'openrouter',model:'x',status:'running'}, {source:'worker',lane:'running'});
  decorateAgentOverviewCard(runningLocal, {id:'active-local',name:'Beta',backend:'lmstudio',model:'local',status:'running'}, {source:'core',lane:'running'});
  ready.append(readyLocal);
  running.append(runningCloud,runningLocal);
  const groupedState = {access:'all',function:'all',start:'all',sort:'name',group:'access',view:'cards'};
  applyAgentOverviewToContainer(ready, groupedState, [readyLocal]);
  applyAgentOverviewToContainer(running, groupedState, [runningCloud,runningLocal]);
  assert.deepEqual(running.children.filter(node=>node.dataset.agentOverviewGroup).map(node=>node.textContent), ['Cloud / API','Lokal']);
  assert.deepEqual(running.children.filter(node=>node.dataset.agentOverviewCard).map(node=>node.dataset.agentOverviewName), ['Alpha','Beta']);

  const cloudOnly = {...groupedState, access:'cloud', group:'none', view:'list'};
  assert.deepEqual(applyAgentOverviewToContainer(ready, cloudOnly, [readyLocal]), {total:1,visible:0});
  assert.deepEqual(applyAgentOverviewToContainer(running, cloudOnly, [runningCloud,runningLocal]), {total:2,visible:1});
  assert.equal(readyLocal.hidden, true);
  assert.equal(runningCloud.hidden, false);
  assert.equal(runningLocal.hidden, true);
  assert.match(running.className, /agent-overview-list/);
});

test('filter changes immediately refresh the shared visible-count caption', () => {
  const root = fakeOverviewRoot();
  const container = new FakeElement('div', root.document);
  const local = new FakeElement('article', root.document);
  const cloud = new FakeElement('article', root.document);
  container.append(local, cloud);
  const captions = [];
  const controller = createAgentOverviewController(root.document, {
    storage:{getItem(){return null;},setItem(){}},
    onRefresh:projection=>captions.push(`${projection.visible} von ${projection.total}`),
  });
  controller.beginContainer(container);
  controller.register(container, local, {id:'local',backend:'ollama',model:'qwen',status:'running'});
  controller.register(container, cloud, {id:'cloud',backend:'openrouter',model:'x',status:'running'});
  controller.bind();
  assert.equal(captions.at(-1), '2 von 2');

  const access = root.controls.find(control=>control.dataset.agentOverviewControl==='access');
  access.value = 'local';
  access.listeners.change();
  assert.equal(local.hidden, false);
  assert.equal(cloud.hidden, true);
  assert.equal(captions.at(-1), '1 von 2');
  assert.match(runningPage, /createAgentOverviewController\(document, \{onRefresh:updateAgentOverviewSummary\}\)/);
  assert.match(dashboardPage, /createAgentOverviewController\(document, \{onRefresh:updateDashboardOverviewSummary\}\)/);
});

test('Running and Dashboard use the same persisted controller and projection', () => {
  const values = new Map();
  const storage = {getItem(key){return values.get(key) || null;},setItem(key,value){values.set(key,value);}};
  const firstRoot = fakeOverviewRoot();
  const firstContainer = new FakeElement('div', firstRoot.document);
  const firstLocal = new FakeElement('article', firstRoot.document);
  const firstCloud = new FakeElement('article', firstRoot.document);
  firstContainer.append(firstLocal, firstCloud);
  const runningController = createAgentOverviewController(firstRoot.document, {storage});
  runningController.bind();
  runningController.beginContainer(firstContainer);
  runningController.register(firstContainer, firstLocal, {id:'local',backend:'ollama',model:'qwen',status:'running'}, {source:'worker',lane:'running'});
  runningController.register(firstContainer, firstCloud, {id:'cloud',backend:'openrouter',model:'x',status:'running'}, {source:'core',lane:'running'});
  firstRoot.controls.find(control=>control.dataset.agentOverviewControl==='access').value = 'cloud';
  firstRoot.controls.find(control=>control.dataset.agentOverviewControl==='access').listeners.change();
  assert.equal(firstLocal.hidden, true);
  assert.equal(firstCloud.hidden, false);

  const dashboardRoot = fakeOverviewRoot();
  const dashboardContainer = new FakeElement('div', dashboardRoot.document);
  const dashboardLocal = new FakeElement('article', dashboardRoot.document);
  const dashboardCloud = new FakeElement('article', dashboardRoot.document);
  dashboardContainer.append(dashboardLocal, dashboardCloud);
  const dashboardController = createAgentOverviewController(dashboardRoot.document, {storage});
  dashboardController.beginContainer(dashboardContainer);
  dashboardController.register(dashboardContainer, dashboardLocal, {id:'local',backend:'lmstudio',model:'local',status:'running'}, {source:'worker',lane:'running'});
  dashboardController.register(dashboardContainer, dashboardCloud, {id:'cloud',backend:'openrouter',model:'x',status:'running'}, {source:'core',lane:'running'});
  dashboardController.bind();
  assert.equal(dashboardController.state.access, 'cloud');
  assert.equal(dashboardLocal.hidden, true);
  assert.equal(dashboardCloud.hidden, false);
});

test('the controls are wired to existing lanes and Core profiles are in the shared Ready section', () => {
  for (const id of ['agent-overview-query','agent-overview-access','agent-overview-function','agent-overview-start','agent-overview-sort','agent-overview-group','agent-overview-view']) {
    assert.match(runningPage, new RegExp(`id="${id}"`));
    assert.equal((runningPage.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
  assert.match(runningPage, /registerAgentOverviewCard\(readyGrid, card, worker, 'worker', 'ready'\)/);
  assert.match(runningPage, /registerAgentOverviewCard\(runningList, card, worker, 'worker', 'running'\)/);
  assert.match(runningPage, /registerAgentOverviewCard\(runningTarget, card, agent, 'core', 'running'\)/);
  assert.match(runningPage, /registerAgentOverviewCard\(target, card, agent, 'core', 'ready'\)/);
  assert.ok(runningPage.indexOf('id="core-agent-cards"') < runningPage.indexOf('<ModelSockets />'));
  for (const key of ['query','access','function','start','sort','group','view']) assert.match(dashboardPage, new RegExp(`data-agent-overview-control="${key}"`));
  assert.match(dashboardPage, /fetch\('\/api\/system\/workers'\)/);
  assert.match(dashboardPage, /fetch\('\/api\/system\/core-agents'\)/);
  assert.match(dashboardPage, /createAgentOverviewController\(document, \{onRefresh:updateDashboardOverviewSummary\}\)/);
  assert.match(dashboardPage, /count\.textContent = observed \? String\(active\.length\) : '–'/);
});

function pickerHarness({failStart = false} = {}) {
  class Element {
    constructor(id) {
      this.id=id; this.listeners={}; this.children=[]; this.disabled=false; this.hidden=false;
      this.value=''; this.textContent=''; this.open=false;
    }
    addEventListener(type,callback){this.listeners[type]=callback;}
    replaceChildren(...children){
      this.children=children;
      if (this.id === 'template-agent-blueprint' && children.length && !children.some(item=>item.value===this.value))
        this.value=String(children[0].value);
    }
    showModal(){this.open=true;}
    close(){this.open=false;}
    reportValidity(){return true;}
    querySelectorAll(){return [];}
  }
  const ids=['template-agent-status','template-agent-picker','template-agent-save','template-agent-start',
    'template-agent-blueprint','template-agent-backend','template-agent-model','template-agent-mode',
    'template-agent-summary','template-agent-prompt','template-agent-models','template-agent-form',
    'template-agent-refresh'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  const sha='a'.repeat(64), beforeConfig='d'.repeat(64), config='c'.repeat(64);
  const blueprints=[1,2].map(id=>({id,name:'bp-'+id,title:'Blueprint '+id,kind:'agent',version:1,
    definition_ref:{blueprint_id:id,version:1,sha256:sha},persona_prompt:'Do the work.',persona_role:'helper',
    description:'test',skills:[],governance:{tool_whitelist:['read_file']},modus:'casualis',
    contractus:{execution:{backend:'ollama',model:'test-local',mode:'safe'}}}));
  let catalogReads=0, coreReads=0, materializeCalls=0, startCalls=0;
  const fetcher=async(url,options={})=>{
    if(url==='/api/agent-studio/blueprints'){catalogReads++;return {ok:true,json:async()=>({templates:blueprints,blueprints:[]})};}
    if(url==='/api/system/core-agents'){
      coreReads++;
      return {ok:true,json:async()=>({configuration_version:materializeCalls?config:beforeConfig,supported_backend_ids:['ollama'],
        agents:materializeCalls?[{id:'system-blueprint-1',blueprint_id:1,blueprint_version:1,backend:'ollama',
          model:'test-local',runtime_verified:!failStart,running:false,execution:{terminal:true},
          definition_ref:blueprints[0].definition_ref}]:[]})};
    }
    if(url.startsWith('/api/system/workers/models?'))return {ok:true,json:async()=>({models:['test-local']})};
    if(url.endsWith('/materialize')){
      materializeCalls++;
      const body=JSON.parse(options.body);
      return {ok:true,json:async()=>({success:true,worker_started:false,id:1,slot_id:'system-blueprint-1',
        configuration_version:config,definition_ref:blueprints[0].definition_ref,execution:body.execution})};
    }
    if(url.endsWith('/start')){
      startCalls++;
      const request=JSON.parse(options.body);
      if(request.configuration_version!==config)
        return {ok:false,json:async()=>({detail:'Start used stale configuration pin'})};
      return failStart?{ok:false,json:async()=>({detail:'Start outcome unknown'})}:
        {ok:true,json:async()=>({success:true,start_cause:'manual',run_id:'b'.repeat(32),
          configuration_version:config,definition_ref:blueprints[0].definition_ref,
          execution:{schema:'bach.worker-execution.v1',worker_id:'system-blueprint-1',
            start_request_id:'d'.repeat(32),generation:'b'.repeat(32),worker_thread_started:true,
            configuration_ref:{sha256:config}}})};
    }
    throw new Error('unexpected request '+url);
  };
  const context={document:{getElementById:id=>elements[id]},window:{loadCoreSlots(){},loadBackgroundWorkers(){}},
    fetch:fetcher,Option:class Option{constructor(text,value){this.text=text;this.value=value;}},
    crypto:{randomUUID:()=>'dddddddd-dddd-dddd-dddd-dddddddddddd'}};
  vm.runInNewContext(pickerScript.replace('export async function openTemplatePicker()','async function openTemplatePicker()'),context);
  return {elements,context,counts:()=>({catalogReads,coreReads,materializeCalls,startCalls})};
}

async function materializeFirstTemplate(harness) {
  await harness.context.window.BachTemplatePicker.open();
  const form=harness.elements['template-agent-form'];
  await form.listeners.submit({preventDefault(){},target:form});
  assert.equal(harness.elements['template-agent-start'].hidden,false);
}

test('template selection invalidates an old pending start', async () => {
  const harness=pickerHarness();
  await materializeFirstTemplate(harness);
  const select=harness.elements['template-agent-blueprint'];
  select.value='2';
  select.listeners.change();
  await Promise.resolve();
  assert.equal(harness.elements['template-agent-start'].hidden,true);
  await harness.elements['template-agent-start'].listeners.click();
  assert.equal(harness.counts().startCalls,0);
});

test('materialized start uses the verified post-materialization configuration pin', async () => {
  const harness=pickerHarness();
  await materializeFirstTemplate(harness);
  await harness.elements['template-agent-start'].listeners.click();
  assert.equal(harness.counts().startCalls,1);
  assert.match(harness.elements['template-agent-status'].textContent,/Manuell gestartet/);
});

test('ambiguous start clears the pending action and reloads fresh status', async () => {
  const harness=pickerHarness({failStart:true});
  await materializeFirstTemplate(harness);
  await harness.elements['template-agent-start'].listeners.click();
  const counts=harness.counts();
  assert.equal(counts.startCalls,1);
  assert.equal(counts.catalogReads,2);
  assert.ok(counts.coreReads >= 3);
  assert.equal(harness.elements['template-agent-start'].hidden,true);
  assert.match(harness.elements['template-agent-status'].textContent,/Status wird neu geladen/);
});

test('Running, history, ready agents, and resources follow the shared Living layout', () => {
  const running = runningPage.indexOf('id="running-agents-title"');
  const history = runningPage.indexOf('id="activity-timeline"');
  const agents = runningPage.indexOf('id="agent-workspace-title"');
  const resources = runningPage.indexOf('id="models-resources-title"');
  assert.ok(running >= 0 && running < history && history < agents && agents < resources);

  const modelSockets = runningPage.indexOf('<ModelSockets />');
  const fackel = runningPage.indexOf('id="hardware-torch-title"');
  const openRouter = runningPage.indexOf('id="openrouter-title"');
  assert.ok(resources < modelSockets && modelSockets < fackel && fackel < openRouter);

  for (const id of ['activity-timeline','ready-agents-title','ready-teams-title','core-agents-title','models-resources-title','hardware-torch-title','openrouter-title']) {
    assert.equal((runningPage.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} remains unique`);
  }
  assert.match(runningPage, /id="ready-agents-grid"[^>]*data-agent-overview-lane="ready"/);
  assert.match(runningPage, /id="running-workers-list"[^>]*data-agent-overview-lane="running"/);
  assert.match(runningPage, /class="agent-creation-group agent-workspace"/);
  assert.match(runningPage, /Tatsächliche Startart<select id="agent-overview-start"/);
  assert.match(runningPage, /template-agent-start/);
  assert.match(runningPage, /\/api\/agent-studio\/blueprints\/\$\{agent\.blueprint_id\}\/start/);
  assert.match(dashboardPage, /value="manual">Manuell bestätigt/);
});

function collectText(node) {
  return [node.textContent || '', ...(node.children || []).flatMap(collectText)].join(' ');
}

test('Dashboard and Running share the same complete read-only card content', () => {
  const document = fakeContainer().ownerDocument;
  const avatar = new FakeElement('img', document);
  avatar.className = 'agent-avatar-preview';
  const symbol = new FakeElement('img', document);
  symbol.className = 'ticket-symbol';
  const content = createAgentOverviewContent(document, {
    id:'worker-7', name:'Reviewer', backend:'ollama', model:'qwen3.5:4b', role_id:'reviewer',
    runtime_verified:true, task_id:2217, current_tool:'read_file', tool_round:3,
    max_tool_rounds:8, current_activity:'Prüft die Abgabe',
  }, {source:'worker', statusLabel:'Running · bestätigt', avatarNode:avatar, symbolNode:symbol});
  const text = collectText(content);
  for (const expected of ['Reviewer','Running · bestätigt','ID: worker-7','Zugang / Funktion: Lokal · reviewer',
    'Modell: qwen3.5:4b','Tatsächliche Startart: Unbekannt','Task: #2217',
    'Aktuelles Werkzeug: read_file','Runde: 3','Rundenbudget: 8','Aktivität: Prüft die Abgabe'])
    assert.ok(text.includes(expected), `shared card is missing ${expected}`);
  assert.match(avatar.className, /agent-overview-runtime-avatar/);
  assert.match(symbol.className, /agent-overview-runtime-symbol/);

  const pinned = createAgentOverviewContent(document, {id:'system-blueprint-7',name:'Research',
    backend:'openrouter',model:'research-model',actual_start_cause:'manual',run_id:'a'.repeat(32),
    execution:{state:'running'},definition_ref:{blueprint_id:7,version:2,sha256:'b'.repeat(64)},
    configuration_ref:{sha256:'c'.repeat(64)}});
  const pinnedText = collectText(pinned);
  for (const expected of ['Tatsächliche Startart: Manuell bestätigt',`Lauf-ID: ${'a'.repeat(32)}`,
    'Laufstatus: running',`Vorlagenfassung: #2 · ${'b'.repeat(64)}`,`Konfiguration: ${'c'.repeat(64)}`])
    assert.ok(pinnedText.includes(expected), `pinned run projection is missing ${expected}`);

  const noRuntimeDetails = createAgentOverviewContent(document, {id:'worker-8',name:'Unknown'});
  const unknownText = collectText(noRuntimeDetails);
  assert.ok(!unknownText.includes('Runde: 0'));
  assert.ok(!unknownText.includes('Task: #0'));
  assert.match(runningPage, /createAgentOverviewContent\(document, agent/);
  assert.match(dashboardPage, /createAgentOverviewContent\(document, agent/);
});

test('compact list hides filtered cards, portraits, and secondary details, and search fits one mobile column', () => {
  assert.match(runningPage, /\.agent-overview-list \[data-agent-overview-card\]:not\(\[hidden\]\)\)\s*\{display:flex!important/);
  assert.match(dashboardPage, /\.dashboard-running-agents\.agent-overview-list \[data-agent-overview-card\]:not\(\[hidden\]\) \{display:flex!important/);
  assert.match(runningPage, /agent-overview-list \.agent-overview-runtime-avatar[^\n]*display:none!important/);
  assert.match(runningPage, /agent-overview-list \.agent-overview-runtime-meta[^\n]*display:none!important/);
  assert.match(dashboardPage, /dashboard-running-agents\.agent-overview-list \.agent-overview-runtime-avatar,[\s\S]*dashboard-running-agents\.agent-overview-list \.agent-overview-runtime-meta \{display:none!important\}/);
  assert.match(runningPage, /@media\(max-width:680px\)\s*\{\.agent-overview-controls \.agent-overview-search \{grid-column:span 1\}\}/);
  assert.match(dashboardPage, /@media\(max-width:680px\)\{\.dashboard-agent-overview \.agent-overview-controls \.agent-overview-search\{grid-column:span 1\}\}/);
});
