import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {taskResultGateSummary} from '../src/lib/task-result-contract.mjs';
import {classifyAgentAccess, createAgentOverviewContent, projectAgentOverview} from '../src/lib/agent-overview.mjs';

function githubReadback() {
  const version = 'a'.repeat(64), revision = 'b'.repeat(64), digest = 'c'.repeat(64);
  return {schema:'bach.task-result-readback.v1', verified:true, task_id:42, task_version:version,
    status:'review', status_revision:17,
    result:{schema:'bach.worker-result.v1', task_id:42, task_version:version, result_id:23,
      result_sha256:digest, completion_policy_version:1, result_revision:revision,
      accepted:false, reason:'awaiting_review'},
    completion_evaluation:{schema:'bach.worker-completion-evaluation.v1', availability:'available',
      task_id:42, result_id:23, result_revision:revision, result_sha256:digest, task_version:version,
      status:'review', status_revision:17, github_pr_review_required:true,
      decision:{state:'awaiting_user_review', completion_allowed:false},
      github:{availability:'available', status:'verified', task_id:'42', result_revision:revision}}};
}
const externalGate = data => taskResultGateSummary(data).find(gate => gate.id === 'external-approval');

for (const [status, expected] of [['verified','confirmed'], ['rejected','blocked']]) {
  test(`GitHub ${status} evidence uses the native string task ID`, () => {
    const data = githubReadback(); data.completion_evaluation.github.status = status;
    assert.equal(externalGate(data).state, expected);
  });
}
for (const id of ['43', '042', 42, null, {}, '42.0']) {
  test(`GitHub evidence rejects noncanonical or foreign task ID ${JSON.stringify(id)}`, () => {
    const data = githubReadback(); data.completion_evaluation.github.task_id = id;
    assert.equal(externalGate(data).state, 'unavailable');
  });
}
test('GitHub evidence is still bound to the result revision and current policy', () => {
  const data = githubReadback(); data.completion_evaluation.github.result_revision = 'd'.repeat(64);
  assert.equal(externalGate(data).state, 'unavailable');
  data.completion_evaluation.github.result_revision = data.result.result_revision;
  data.completion_evaluation.decision.state = 'awaiting_external_review';
  assert.equal(externalGate(data).state, 'reported');
});

function textDocument() {
  return {createElement() { return {children:[], textContent:'', append(...nodes) {this.children.push(...nodes);}}; }};
}
function allText(node) {return [node.textContent, ...node.children.map(allText)].join('\n');}
for (const source of ['worker', 'core']) {
  for (const runtime of [
    {runtime_verified:true, running:false, status:'idle'},
    {runtime_verified:false, running:true, status:'running'},
    {runtime_verified:true, running:true, status:'starting'},
    {runtime_verified:true, running:true, status:'stopping'},
  ]) {
    test(`${source} ${JSON.stringify(runtime)} uses its configured model and matching access filter`, () => {
      const agent = {id:'ready', backend:'ollama', model:'configured-local', resolved_model:'old:cloud', ...runtime};
      const text = allText(createAgentOverviewContent(textDocument(), agent, {source}));
      assert.match(text, /Modell: configured-local/);
      assert.doesNotMatch(text, /old:cloud/);
      assert.equal(classifyAgentAccess(agent), 'local');
      assert.equal(projectAgentOverview([{source, agent}], {access:'local'}).visible, 1);
      assert.equal(projectAgentOverview([{source, agent}], {access:'cloud'}).visible, 0);
    });
  }
}
test('confirmed running agents retain their resolved model and cloud access', () => {
  const agent = {id:'running', backend:'ollama', model:'configured-local', resolved_model:'actual:cloud',
    runtime_verified:true, running:true, status:'running'};
  assert.match(allText(createAgentOverviewContent(textDocument(), agent)), /Modell: actual:cloud/);
  assert.equal(classifyAgentAccess(agent), 'cloud');
  agent.resolved_model = '  ';
  assert.match(allText(createAgentOverviewContent(textDocument(), agent)), /Modell: configured-local/);
  assert.equal(classifyAgentAccess(agent), 'local');
});

const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url), 'utf8');
function drawerHarness() {
  const frames = [], events = new Map(), elements = new Map();
  const document = {activeElement:null, body:null,
    getElementById:id => elements.get(id) ?? null,
    querySelector:selector => elements.get(selector) ?? null,
    addEventListener:(type, fn) => events.set(type, fn)};
  let visible = false;
  function element(id) {
    const attrs = new Map(), classes = new Set(), listeners = new Map();
    const el = {inert:false, hidden:false, attrs, listeners,
      classList:{remove:name => classes.delete(name), toggle(name, enabled) {if(enabled)classes.add(name);else classes.delete(name);}},
      setAttribute:(key,value) => attrs.set(key,value), removeAttribute:key => attrs.delete(key),
      addEventListener:(type, fn) => listeners.set(type,fn),
      focus() {if(id !== 'sidebar-close' || visible) document.activeElement = el;},
      contains:node => node === elements.get('sidebar-close'),
      querySelectorAll:() => [elements.get('sidebar-close')],
      closest:() => null, matches:() => false};
    elements.set(id, el); return el;
  }
  document.body = element('body'); document.activeElement = document.body;
  for (const id of ['nav-toggle','app-sidebar','sidebar-close','sidebar-backdrop','.skip-link','main-header']) element(id);
  const media = {matches:true, addEventListener:(_type,fn) => events.set('media',fn)};
  const context = {document, window:{matchMedia:() => media},
    requestAnimationFrame:fn => frames.push(fn)};
  const start = header.indexOf("  const navToggle = document.getElementById('nav-toggle');");
  const end = header.indexOf('\n  function matchesCurrentNavigationRoute', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(header.slice(start,end), context);
  // Header's inline script precedes these nodes in the actual built document.
  element('main-content'); element('body > footer');
  return {elements, document, media, events,
    open:() => elements.get('nav-toggle').listeners.get('click')(),
    close:() => events.get('keydown')({key:'Escape'}),
    frame() {visible = true; for(const fn of frames.splice(0))fn();}};
}
test('drawer discovers main and footer parsed after the header script and restores on Escape', () => {
  const h = drawerHarness(); h.open();
  for(const id of ['.skip-link','main-header','main-content','body > footer']) assert.equal(h.elements.get(id).inert,true,id);
  h.frame(); h.frame(); assert.equal(h.document.activeElement,h.elements.get('sidebar-close'));
  h.close(); assert.equal(h.document.activeElement,h.elements.get('nav-toggle'));
  for(const id of ['.skip-link','main-header','main-content','body > footer']) assert.equal(h.elements.get(id).inert,false,id);
});
test('drawer waits for the visible frame before focusing its close button', () => {
  const h = drawerHarness(); h.open(); h.frame(); h.frame();
  assert.equal(h.document.activeElement,h.elements.get('sidebar-close'));
});
for(const close of ['escape','desktop']) {
  test(`pending drawer focus cannot run after ${close}`, () => {
    const h = drawerHarness(); h.open();
    if(close === 'escape') h.close();
    else {h.media.matches=false; h.events.get('media')();}
    h.frame(); h.frame(); assert.notEqual(h.document.activeElement,h.elements.get('sidebar-close'));
    assert.equal(h.elements.get('main-content').inert,false);
    assert.equal(h.elements.get('body > footer').inert,false);
  });
}

const pageSource = name => readFileSync(new URL(`../src/pages/${name}.astro`, import.meta.url), 'utf8');
function styleRule(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `CSS rule ${selector} exists`);
  const end = source.indexOf('}', start);
  assert.ok(end > start, `CSS rule ${selector} is closed`);
  return source.slice(start + selector.length + 1, end);
}
test('calendar view choices reflow into a bounded mobile grid', () => {
  const source = pageSource('life');
  const mobile = source.slice(source.indexOf('@media (max-width: 700px)'));
  const group = styleRule(mobile, '.cal-views-segmented');
  assert.match(group, /display:\s*grid;/);
  assert.match(group, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  const button = styleRule(mobile, '.cal-view-btn');
  assert.match(button, /min-width:\s*0;/);
  assert.match(button, /white-space:\s*normal;/);
});
test('domain heading and its actions wrap instead of forcing a wide row', () => {
  const source = pageSource('domains');
  assert.match(styleRule(source, '.page-header'), /flex-wrap:\s*wrap;/);
  const actions = styleRule(source, '.header-actions');
  assert.match(actions, /flex-wrap:\s*wrap;/);
  assert.match(actions, /min-width:\s*0;/);
  assert.match(actions, /max-width:\s*100%;/);
});
test('artifact heading and format filters wrap on narrow screens', () => {
  assert.match(styleRule(pageSource('artefakte'), '.page-header'), /flex-wrap:\s*wrap;/);
  assert.match(styleRule(pageSource('artefakte'), '.filter-bar'), /flex-wrap:\s*wrap;/);
});
for(const [page, selector] of [['domains','.domains-grid'], ['artefakte','.artefakte-grid'], ['life','.card-grid']]) {
  test(`${selector} can shrink below the desktop card minimum`, () => {
    assert.match(styleRule(pageSource(page), selector), /minmax\(min\(100%,\s*320px\),\s*1fr\)/);
  });
}
