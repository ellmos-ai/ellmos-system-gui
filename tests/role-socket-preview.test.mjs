import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountRoleSocketPreview, renderRoleSocketPreview} from '../src/lib/role-socket-preview.mjs';

// Intentionally no HTML parser: using an HTML sink fails instead of hiding injection.
class Text {
  constructor(value) { this.nodeType = 3; this.textContent = String(value); }
}
class Element {
  constructor(tag) {
    this.nodeType = 1; this.tagName = tag; this.children = []; this.style = {};
    this.attributes = {}; this.events = new Map(); this.value = '';
  }
  set innerHTML(_value) { throw new Error('HTML parsing is forbidden'); }
  set outerHTML(_value) { throw new Error('HTML parsing is forbidden'); }
  insertAdjacentHTML() { throw new Error('HTML parsing is forbidden'); }
  setAttribute(name, value) {
    assert.ok(!/^on/i.test(name), 'event attributes are forbidden');
    this.attributes[name] = value;
  }
  set textContent(value) { this.children = [new Text(value)]; }
  get textContent() { return this.children.map(child => child.textContent).join(''); }
  append(...children) {
    for (const child of children) this.children.push(typeof child === 'string' ? new Text(child) : child);
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  addEventListener(name, callback) { this.events.set(name, callback); }
  change(value) { this.value = value; this.events.get('change')?.(); }
}
function fixture() {
  const container = new Element('div'), select = new Element('select');
  select.value = 'claude';
  const document = {createElement: tag => new Element(tag),
    getElementById: id => ({'ocean-role-socket-list': container, 'ocean-socket-provider-select': select})[id]};
  return {document, container, select};
}
function catalogue(template = {}) {
  return {templates: [{label:'Entwicklung', role_id:'developer', module_id:'example',
    source:'module_manifest_role', prompt:'roles/developer.md', socket_id:'specialist', ...template}],
  role_socket_catalog: {provider_sockets: {specialist: {providers: {claude:'opus', codex:'gpt'}}}}};
}
function nodes(root) {
  return [root, ...root.children.flatMap(child => child.nodeType === 1 ? nodes(child) : [child])];
}
function assertStaticElements(root) {
  for (const node of nodes(root).filter(node => node.nodeType === 1)) {
    assert.ok(['div','strong','span','code'].includes(node.tagName), node.tagName);
    assert.deepEqual(node.attributes, {});
    assert.equal(node.events.size, 0);
    assert.ok(node.className === undefined || node.className === 'studio-state');
    for (const value of Object.values(node.style)) assert.doesNotMatch(value, /javascript:|onerror|<|>/i);
  }
}

test('normal preview preserves module badge, prompt, socket and selected provider model', () => {
  const f = fixture();
  renderRoleSocketPreview(f.document, f.container, catalogue(), 'claude');
  assert.equal(f.container.children.length, 1);
  assert.equal(f.container.textContent, 'Entwicklung📦 examplePrompt: roles/developer.mdSockel specialist → opus');
  const codes = nodes(f.container).filter(node => node.tagName === 'code');
  assert.deepEqual(codes.map(node => node.textContent), ['roles/developer.md','specialist']);
  assertStaticElements(f.container);
});

const payloads = [
  '<img src=x onerror="globalThis.compromised=true">',
  '</code><svg onload="globalThis.compromised=true"></svg>',
  '<script>globalThis.compromised=true</script>',
  '" autofocus onfocus="globalThis.compromised=true',
  'javascript:globalThis.compromised=true',
  '&lt;img src=x onerror=compromised&gt;',
];
for (const field of ['label','role_id','prompt','module_id','tier','socket_id','semantic_route','model','provider']) {
  test('untrusted ' + field + ' is literal text with no metadata-derived elements or attributes', () => {
    for (const payload of payloads) {
      const f = fixture(), data = catalogue(), template = data.templates[0];
      let provider = 'claude';
      if (field === 'role_id') { template.label = ''; template.role_id = payload; }
      else if (field === 'tier') { template.source = 'catalogue'; template.tier = payload; }
      else if (field === 'model') data.role_socket_catalog.provider_sockets.specialist.providers.claude = payload;
      else if (field === 'provider') provider = payload;
      else template[field] = payload;
      renderRoleSocketPreview(f.document, f.container, data, provider);
      assert.ok(f.container.textContent.includes(payload), field + ' remains visible as text');
      assertStaticElements(f.container);
    }
  });
}

test('semantic routes, role badges and the existing twelve-card limit are retained', () => {
  const f = fixture(), data = catalogue({source:'role_catalogue', tier:'coordinator', semantic_route:'research-umbrella'});
  data.templates = Array.from({length:15}, (_, index) => ({...data.templates[0], label:'Role ' + index}));
  renderRoleSocketPreview(f.document, f.container, data, 'missing-provider');
  assert.equal(f.container.children.length, 12);
  assert.match(f.container.children[0].textContent, /Role 0🧭 coordinatorUmbrella: research-umbrellaSockel specialist → missing-provider/);
  assertStaticElements(f.container);
});

test('provider changes repaint cached text without fetching again or keeping stale cards', async () => {
  const f = fixture(), calls = [];
  await mountRoleSocketPreview(f.document, async path => { calls.push(path); return {ok:true, json:async()=>catalogue()}; });
  assert.match(f.container.textContent, /→ opus$/);
  const firstCard = f.container.children[0];
  f.select.change('codex');
  assert.match(f.container.textContent, /→ gpt$/);
  assert.equal(f.container.children.length, 1);
  assert.notEqual(f.container.children[0], firstCard);
  assert.deepEqual(calls, ['/api/agenten/library']);
  assertStaticElements(f.container);
});

test('a provider selected before the response uses that latest selection', async () => {
  const f = fixture();
  let resolve;
  const loading = mountRoleSocketPreview(f.document, () => new Promise(done => { resolve = done; }));
  f.select.change('codex');
  resolve({ok:true, json:async()=>catalogue()});
  await loading;
  assert.match(f.container.textContent, /→ gpt$/);
});

test('missing elements or unavailable catalogue do not create previews or execution requests', async () => {
  let calls = 0;
  await mountRoleSocketPreview({getElementById:()=>null}, async()=>{ calls++; });
  assert.equal(calls, 0);
  for (const response of [null, {ok:false}, {ok:true,json:async()=>{throw Error('unavailable');}}]) {
    const f = fixture();
    await mountRoleSocketPreview(f.document, async()=>{ if (response === null) throw Error('unavailable'); return response; });
    f.select.change('codex');
    assert.equal(f.container.children.length, 0);
  }
});

test('malformed metadata cannot supply conversion hooks, tags or provider attributes', () => {
  const f = fixture(), data = catalogue({label:{toString(){throw Error('must not coerce');}},
    role_id:'fallback role', prompt:[], socket_id:{}, module_id:null});
  renderRoleSocketPreview(f.document, f.container, data, 'claude');
  assert.equal(f.container.textContent, 'fallback role📦 Prompt: SKILL.mdSockel domain_specialist → claude');
  assertStaticElements(f.container);
});

test('both Astro pages use the same bundled text renderer and remove the inline sink', () => {
  for (const name of ['bibliothek','blueprints']) {
    const source = readFileSync(new URL('../src/pages/agenten/' + name + '.astro', import.meta.url), 'utf8');
    assert.match(source, /import \{mountRoleSocketPreview\} from "\.\.\/\.\.\/lib\/role-socket-preview\.mjs"/);
    assert.match(source, /mountRoleSocketPreview\(document\)/);
    assert.doesNotMatch(source, /initOceanRoleSockets|container\.innerHTML\s*=\s*templates/);
  }
});
