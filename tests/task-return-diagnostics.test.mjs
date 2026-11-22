import test from 'node:test';
import assert from 'node:assert/strict';
import {describeReason, returnBadge, renderReasonBlock} from '../src/lib/task-returns.mjs';

test('ticket producer notes explain only their recorded transition and retain the raw code', () => {
  const expected = {
    reason_not_provided: /nicht angegeben/,
    ticket_claim_rollback: /zurückgerollt/,
    ticket_claim_released: /freigegeben/,
    ticket_moved: /verschoben/,
    'ticket_moved:solved': /Erledigt/,
    'ticket_moved:blocked': /Blockiert/,
    'ticket_moved:user': /Nutzerbereich/,
    'ticket_moved:waiting': /Wartend/,
    'ticket_moved:parked': /Geparkt/,
    'ticket_moved:actionable': /bearbeitbaren/,
    'ticket_moved:inbox': /Eingang/,
  };
  for (const [code, title] of Object.entries(expected)) {
    const reason = describeReason(code);
    assert.equal(reason.code, code);
    assert.match(reason.title, title);
    assert.match(reason.hint, /prüfen/);
    assert.equal(reason.scope, code === 'reason_not_provided' ? 'unknown' : 'task');
  }
  for (const code of ['ticket_moved:unexpected','ticket_moved:solved:extra','ticket_claim_rollback:extra','brand_new_reason']) {
    assert.deepEqual([describeReason(code).scope, describeReason(code).title, describeReason(code).code],
      ['unknown','Unbekannter Grund',code]);
  }
});

test('an old Ticket-Master actor is identified without reconstructing a return cause', () => {
  const raw = 'ticket-master@SYNTHETIC-HOST';
  const reason = describeReason(raw);
  assert.equal(reason.code,raw);
  assert.equal(reason.scope,'unknown');
  assert.equal(reason.title,'Agentenkennung statt Rückgabegrund');
  assert.match(reason.hint,/nicht rekonstruierbar/);
  assert.doesNotMatch(reason.hint,/Kontingent|Rollback|zurückgerollt/);
  assert.equal(describeReason('something@somewhere').title,'Unbekannter Grund');
});

test('tool denial and tool budget failures have task diagnostics instead of provider quota advice', () => {
  for (const prefix of ['', 'model_failure:']) {
    for (const suffix of ['tool_denial_limit','tool_denial_repeated']) {
      const code=prefix+suffix, reason=describeReason(code);
      assert.equal(reason.code,code);assert.equal(reason.scope,'task');
      assert.match(reason.title,/Werkzeug.*abgelehnt/);
      for (const phrase of ['Zielpfad','Berechtigungen','Validierung']) assert.ok(reason.hint.includes(phrase));
      assert.doesNotMatch(reason.hint,/Kontingent|Anbieter|Modellwechsel/);
    }
    const budget=describeReason(prefix+'tool_call_limit');
    assert.equal(budget.scope,'task');assert.match(budget.title,/Werkzeugbudget/);
    assert.match(budget.hint,/Zahl.*Werkzeugaufrufe/);
    assert.doesNotMatch(budget.hint,/Kontingent|Anbieter/);
  }
  const repeated=describeReason('repeated_return:model_failure:tool_denial_limit');
  assert.match(repeated.hint,/Zielpfad/);
  assert.doesNotMatch(repeated.hint,/Kontingent/);
  assert.equal(describeReason('tool_denial_new').scope,'unknown');
  assert.equal(describeReason('backend_error:ollama:quota_exceeded').scope,'provider');
});

class Element {
  constructor(tag) { this.tagName=tag;this.children=[];this.dataset={};this._text=''; }
  set textContent(text) { this._text=String(text);this.children=[]; }
  get textContent() { return this._text+this.children.map(x=>x.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=[...nodes];this._text=''; }
}
const doc={createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('#text'),{textContent:text})};
const descendants=node=>[node,...node.children.flatMap(descendants)];

test('rendered return detail keeps diagnostics and raw producer evidence together', () => {
  for (const code of ['ticket_moved:blocked','ticket-master@SYNTHETIC-HOST','model_failure:tool_denial_limit','ticket_moved:<script>']) {
    const summary={available:true,return_count:2,last_return_reason:code,flapping:false};
    const badge=returnBadge(summary,{status:'pending'});
    const container=new Element('div');
    renderReasonBlock(doc,container,badge,summary);
    assert.ok(container.textContent.includes(describeReason(code).title));
    assert.ok(container.textContent.includes(describeReason(code).hint));
    assert.equal(descendants(container).find(node=>node.tagName==='code').textContent,code);
    assert.equal(descendants(container).some(node=>node.tagName==='script'),false);
  }
});
