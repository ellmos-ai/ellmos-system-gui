import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
const modelSocketsUi = readFileSync(new URL('../src/lib/model-sockets-ui.mjs', import.meta.url), 'utf8');

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
  for (const id of ['agent-overview-access','agent-overview-function','agent-overview-start','agent-overview-sort','agent-overview-group','agent-overview-view']) {
    assert.match(runningPage, new RegExp(`id="${id}"`));
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
    'Modell: qwen3.5:4b','Tatsächliche Startart: unbekannt','Task: #2217',
    'Aktuelles Werkzeug: read_file','Runde: 3','Rundenbudget: 8','Aktivität: Prüft die Abgabe'])
    assert.ok(text.includes(expected), `shared card is missing ${expected}`);
  assert.match(avatar.className, /agent-overview-runtime-avatar/);
  assert.match(symbol.className, /agent-overview-runtime-symbol/);

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

test('agent instances, saved model bindings, and measured runtime resources are distinct', () => {
  assert.match(runningPage, /Agenteninstanzen & Modellbindungen/);
  assert.match(runningPage, /Agenteninstanz:<\/strong>[\s\S]*Blueprint-Vorlage ist noch keine Instanz/);
  assert.match(runningPage, /Modellbindung:<\/strong>[\s\S]*gespeicherte Zuordnungen/);
  assert.match(runningPage, /Laufzeit & Ressourcen/);
  assert.match(runningPage, /Modellresidenz und RAM-Anteil pro Agent bleiben ohne Beleg unbekannt/);
  assert.match(runningPage, /Gemeldeter Modellname/);
  assert.match(runningPage, /cap\.state === 'measured' && Number\.isSafeInteger\(cap\.loaded_model_count\)/);
  assert.ok(runningPage.includes("cap.state === 'measured' ? 'Messung unvollständig'"));
  assert.doesNotMatch(runningPage, /Number\(cap\.loaded_model_count\) \|\| 0/);
  assert.match(modelSocketsUi, /Lauf und Ressourcenanteil: nicht geprüft\./);
});
