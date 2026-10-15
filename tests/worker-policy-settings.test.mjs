import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (value, status = 200) => ({ok: status < 400, status, json: async () => value});
const globalSnapshot = (reviewers = []) => ({
  schema: 'bach.worker-review-policy-settings.v1', availability: 'available',
  configuration_version: 'config-1', policy_source: 'system_default',
  policy: {policy_version: 'policy-1', default_mode: 'balanced', reviewers,
    review_expiry_seconds: null, github_external_review: false, allow_review_task_pickup: false},
  selection: {resume_bound_task_first: true, decompose_when_idle: true, normal_task_order: 'priority_then_created'},
});
const taskSnapshot = id => ({
  schema: 'bach.task-worker-policy-override.v1', availability: 'available', task_id: id,
  configuration_version: 'config-1', task_version: 'task-1',
  override: {mode: null, github_external_review: null, allow_review_task_pickup: false, require_user_review: true},
  effective: {policy_version: 'policy-1', policy_source: 'task_override', effective_mode: 'balanced',
    state: 'awaiting_user_review', reason: 'user_required', user_review_required: true,
    github_external_review: false, allow_review_task_pickup: false},
});

function harness(kind, responses) {
  const nodes = new Map();
  const listeners = new Map();
  const calls = [];
  const element = (tagName = 'div') => ({tagName: tagName.toUpperCase(), value: '', checked: false, disabled: false, hidden: false,
    textContent: '', dataset: {}, handlers: new Map(), children: [], attributes: {},
    addEventListener(event, callback) {this.handlers.set(event, callback);},
    append(...items) {for (const item of items) item.parent = this; this.children.push(...items);},
    replaceChildren(...items) {this.children = []; this.append(...items);},
    remove() {if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this);},
    querySelectorAll(selector) {
      const className = selector.startsWith('.') ? selector.slice(1) : null;
      return className ? this.children.filter(item => item.className === className) : [];
    },
    querySelector(selector) {
      const tagName = selector.toUpperCase();
      return this.children.find(item => item.tagName === tagName) || null;
    },
    setAttribute(name, value) {this.attributes[name] = value;},
  });
  const node = id => {if (!nodes.has(id)) {const value = element(); value.id = id; nodes.set(id, value);} return nodes.get(id);};
  const prefix = kind === 'global' ? 'worker-policy' : 'task-worker-policy';
  const form = node(prefix + '-form');
  const fields = ['default_mode', 'expiry_mode', 'expiry_value', 'expiry_unit',
    'github_external_review', 'allow_review_task_pickup', 'resume_bound_task_first',
    'decompose_when_idle', 'normal_task_order', 'mode', 'user_review_required'];
  form.elements = fields.map(name => node('field:' + name));
  form.elements.namedItem = name => node('field:' + name);
  const file = kind === 'global' ? 'worker-policy-settings' : 'task-worker-policy-settings';
  const source = readFileSync(new URL(`../src/lib/${file}.mjs`, import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/m, '').replace('export function ', 'function ');
  const mount = kind === 'global' ? 'mountWorkerPolicySettings' : 'mountTaskWorkerPolicySettings';
  vm.runInNewContext(source + `\n${mount}();`, {
    document: {getElementById: node, createElement: element},
    window: {addEventListener: (event, callback) => listeners.set(event, callback)},
    consumerApiHeaders: (initial = {}) => new Headers(initial), Headers, AbortController, Error,
    fetch: async (url, options) => {
      calls.push({url, options});
      assert.ok(responses.length, 'unexpected network request');
      return await responses.shift();
    },
  });
  return {node, form, calls,
    select: id => listeners.get('bach:task-selected')({detail: {id}}),
    submit: () => form.handlers.get('submit')({preventDefault() {}}),
    reset: () => node(prefix + '-reset').handlers.get('click')(),
    addReviewer: () => node(prefix + '-add-reviewer').handlers.get('click')(),
    status: () => node(prefix + '-status'),
  };
}

for (const action of ['submit', 'reset']) {
  test(`global ${action}: a rejected write stays visible after a successful current-state read`, async () => {
    const h = harness('global', [response(globalSnapshot()), response({}, 409), response(globalSnapshot())]);
    await tick();
    await h[action]();
    assert.equal(h.status().dataset.state, 'error');
    assert.match(h.status().textContent, /parallel geändert/);
    assert.equal(h.form.hidden, false);
    assert.equal(h.calls.filter(c => c.options.method === 'PUT').length, 1);
  });
}

test('global save requires an independent matching readback', async () => {
  const mismatch = globalSnapshot(); mismatch.selection.decompose_when_idle = false;
  const h = harness('global', [response(globalSnapshot()),
    response({schema: 'bach.worker-review-policy-settings.v1', updated: true, worker_started: false}), response(mismatch)]);
  await tick(); await h.submit();
  assert.equal(h.status().dataset.state, 'unavailable');
  assert.match(h.status().textContent, /entspricht.*nicht/);
  assert.equal(h.form.hidden, true);
});

test('changing reviewers without operator authority sends no write and explains the required permission', async () => {
  const h = harness('global', [response(globalSnapshot())]);
  await tick();
  h.addReviewer();
  const row = h.node('worker-policy-reviewers').children.find(item => item.className === 'worker-reviewer-row');
  row.querySelector('input').value = 'provider/reviewer';
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.status().dataset.state, 'error');
  assert.match(h.status().textContent, /gesonderte Operatorberechtigung/);
  assert.match(h.status().textContent, /wird nicht gespeichert/);
  assert.equal(h.form.hidden, false);
});

test('reviewer changes send the temporary operator header and clear the input after confirmed readback', async () => {
  const next = globalSnapshot([{reviewer_id: 'provider/reviewer', tier: 'standard'}]);
  const h = harness('global', [response(globalSnapshot()),
    response({schema: 'bach.worker-review-policy-settings.v1', updated: true, worker_started: false}), response(next)]);
  await tick();
  h.addReviewer();
  const row = h.node('worker-policy-reviewers').children.find(item => item.className === 'worker-reviewer-row');
  row.querySelector('input').value = 'provider/reviewer';
  h.node('worker-policy-operator-token').value = 'temporary-secret-value';
  await h.submit();
  assert.equal(h.calls[1].options.headers.get('X-BACH-Result-Operator'), 'temporary-secret-value');
  assert.equal(h.calls[2].options.headers.get('X-BACH-Result-Operator'), null);
  assert.equal(h.node('worker-policy-operator-token').value, '');
  assert.equal(h.status().dataset.state, 'available');
});

test('ordinary policy edits never send an entered operator token and clear it', async () => {
  const next = globalSnapshot(); next.policy.default_mode = 'simple_task';
  const h = harness('global', [response(globalSnapshot()),
    response({schema: 'bach.worker-review-policy-settings.v1', updated: true, worker_started: false}), response(next)]);
  await tick();
  h.node('field:default_mode').value = 'simple_task';
  h.node('worker-policy-operator-token').value = 'must-not-be-sent';
  await h.submit();
  assert.equal(h.calls[1].options.headers.get('X-BACH-Result-Operator'), null);
  assert.equal(h.node('worker-policy-operator-token').value, '');
  assert.equal(h.status().dataset.state, 'available');
});

test('a reviewer 403 is explicit, does not expose the token, and reads back the current policy', async () => {
  const h = harness('global', [response(globalSnapshot()), response({}, 403), response(globalSnapshot())]);
  await tick();
  h.addReviewer();
  const row = h.node('worker-policy-reviewers').children.find(item => item.className === 'worker-reviewer-row');
  row.querySelector('input').value = 'provider/reviewer';
  h.node('worker-policy-operator-token').value = 'private-token-403';
  await h.submit();
  assert.equal(h.calls[1].options.headers.get('X-BACH-Result-Operator'), 'private-token-403');
  assert.equal(h.node('worker-policy-operator-token').value, '');
  assert.match(h.status().textContent, /Operatorberechtigung.*HTTP 403/);
  assert.doesNotMatch(h.status().textContent, /private-token-403/);
  assert.equal(h.status().dataset.state, 'error');
  assert.equal(h.form.hidden, false);
});

test('resetting an existing reviewer list requires and uses the temporary operator token', async () => {
  const current = globalSnapshot([{reviewer_id: 'provider/reviewer', tier: 'top'}]);
  const h = harness('global', [response(current),
    response({schema: 'bach.worker-review-policy-settings.v1', updated: true, worker_started: false}), response(globalSnapshot())]);
  await tick();
  h.node('worker-policy-operator-token').value = 'reset-only-token';
  await h.reset();
  assert.equal(h.calls[1].options.headers.get('X-BACH-Result-Operator'), 'reset-only-token');
  assert.equal(h.node('worker-policy-operator-token').value, '');
  assert.equal(h.status().dataset.state, 'available');
});

test('resetting reviewers without operator authority sends no write', async () => {
  const current = globalSnapshot([{reviewer_id: 'provider/reviewer', tier: 'standard'}]);
  const h = harness('global', [response(current)]);
  await tick(); await h.reset();
  assert.equal(h.calls.length, 1);
  assert.match(h.status().textContent, /entfernt die Reviewer-Liste.*Operatorberechtigung/);
  assert.equal(h.form.hidden, false);
});

test('task changes preserve null, false and mandatory user review in the request', async () => {
  const h = harness('task', [response(taskSnapshot(41)),
    response({schema: 'bach.task-worker-policy-override.v1', updated: true, worker_started: false, task_id: 41}),
    response(taskSnapshot(41))]);
  h.select(41); await tick();
  assert.equal(h.node('field:user_review_required').disabled, true);
  await h.submit();
  const body = JSON.parse(h.calls[1].options.body);
  assert.deepEqual(body.override, taskSnapshot(41).override);
  assert.equal(body.task_id, 41);
  assert.equal(body.configuration_version, 'config-1');
  assert.equal(h.status().dataset.state, 'available');
});

test('a failed old-task save cannot overwrite the newly selected task after delayed readback', async () => {
  let resolveOldRead;
  const delayed = new Promise(resolve => {resolveOldRead = resolve;});
  const h = harness('task', [response(taskSnapshot(41)), response({}, 409), delayed, response(taskSnapshot(42))]);
  h.select(41); await tick();
  const saving = h.submit(); await tick();
  h.select(42); await tick();
  resolveOldRead(response(taskSnapshot(41))); await saving;
  assert.equal(h.status().dataset.state, 'available');
  assert.match(h.status().textContent, /Task #42/);
  assert.doesNotMatch(h.status().textContent, /parallel geändert/);
});
