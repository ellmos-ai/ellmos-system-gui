import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createAvatar} from '../src/lib/agent-avatar.mjs';
import {createSymbol} from '../src/lib/ticket-symbol.mjs';

const page = readFileSync(new URL('../src/pages/agenten/running.astro', import.meta.url), 'utf8');
const snippet = (start, end) => page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start))).trim();

test('Running inline scripts parse', () => {
  for (const source of [page]) {
    for (const script of source.matchAll(/<script\b(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
      // Astro compiles its module imports; vm.Script checks browser inline code.
      if(!/\bis:inline\b/.test(script[1]))continue;
      new vm.Script(script[2]);
    }
  }
});

test('core configuration conflicts reject before a success response', async () => {
  const request = vm.runInNewContext('(' + snippet('async function coreRequest(', 'async function loadCoreSlots(') + ')', {
    coreRefreshEpoch: 0,
    fetch: async () => ({ok:false, status:409, json:async () => ({detail:'Konfiguration wurde inzwischen geändert'})})
  });
  await assert.rejects(request('/buddha_chat', 'PUT', {configuration_version:'a'.repeat(64)}), /inzwischen geändert/);
});

function renderer() {
  const elements = [];
  const target = {children:[], replaceChildren(...children) {this.children = children;}, append(...children) {this.children.push(...children);}};
  const runningTarget = {children:[],replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);}};
  const document = {
    getElementById: id => id==='core-slot-editor'?{dataset:{portraitAtlas:'/_astro/portraits.abc.png',
      ticketSymbols:JSON.stringify({topics_ai:'/_astro/topics_ai.abc.svg'})}}:id==='running-system-slots-list'?runningTarget:target,
    createElement(tag) {
      const node = {tag, dataset:{}, style:{}, attributes:{}, children:[], handlers:{},
        append(...children) {this.children.push(...children);},
        setAttribute(name, value) {this.attributes[name] = value;},
        addEventListener(name, handler) {this.handlers[name] = handler;}
      };
      elements.push(node); return node;
    }
  };
  const switches = [];
  const context = vm.createContext({document, coreRefreshEpoch:0, coreConfigVersion:null, coreAgents:[], coreCatalog:{},
    window:{BachAvatars:{createAvatar},BachSymbols:{createSymbol}},
    openCoreEditor(){}, toggleCoreSlot(...args){switches.push(args);}});
  vm.runInContext(snippet('function coreElement(', 'function coreField('), context);
  const render = vm.runInContext('(' + snippet('function renderCoreAgents(', 'async function coreRequest(') + ')', context);
  return {render, elements, target, runningTarget, switches};
}

test('stored Running alone cannot produce a Running badge or visible editor form', () => {
  const h = renderer();
  h.render({configuration_version:'a'.repeat(64), agents:[{id:'buddha_chat', name:'Assistent', enabled:true,
    backend:'ollama', model:'qwen', running:true, status:'running', runtime_verified:false}]});
  assert.ok(h.elements.some(element => element.textContent === 'Status unbekannt'));
  assert.ok(!h.elements.some(element => element.textContent === 'Running'));
  assert.ok(!h.elements.some(element => ['input','textarea','select'].includes(element.tag)));
  assert.ok(h.elements.some(element=>element.dataset.avatarPreset==='preset:companion'));
});

test('the visible switch sends a desired off state and all slots can open a chat', () => {
  const h = renderer();
  h.render({configuration_version:'a'.repeat(64), agents:[{id:'system-expert', name:'Experte', enabled:true,
    backend:'ollama', model:'qwen', runtime_verified:true, running:false}]});
  const toggle = h.elements.find(element => element.attributes.role === 'switch');
  assert.equal(toggle.attributes['aria-checked'], 'true');
  toggle.handlers.click();
  assert.deepEqual(h.switches, [['system-expert', false]]);
  assert.ok(h.elements.some(element => element.href === '/chat?slot_id=system-expert'));
});



test('timeline uses real activity events with safe DOM text rendering', () => {
  const source = snippet('async function refreshActivity()', '// ── WERKSTATT ABHOLEN');
  assert.match(source, /core-agents\/timeline/);
  assert.doesNotMatch(source, /created_at|\/api\/tasks/);
  assert.match(source, /coreElement\('td', value\)/);
});



test('Hermes is shown as API rather than a CLI subscription', () => {
  const h = renderer();
  h.render({agents:[{id:'buddha_chat', name:'Hermes', enabled:true, backend:'hermes', model:'api-model'}]});
  assert.ok(h.elements.some(element => element.textContent === 'Cloud / API · hermes'));
});
