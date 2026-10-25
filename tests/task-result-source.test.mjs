import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resultSourceSummary} from '../src/lib/task-result-contract.mjs';

const version = 'a'.repeat(64);
const revision = 'b'.repeat(64);
const result = () => ({schema:'bach.task-result-readback.v1', verified:true, task_id:1, task_version:version,
  status:'review', result:{schema:'bach.worker-result.v1', task_id:1, task_version:version,
    result_id:2, result_sha256:'c'.repeat(64), accepted:false, source_kind:'external_attested',
    result_revision:revision,
    external_provenance:{schema:'bach.worker-external-attestation.v1', source_kind:'external_attested',
      availability:'available', result_revision:revision},
    scope:{schema:'bach.worker-external-scope-evidence.v1', source_kind:'external_attested',
      availability:'available', result_revision:revision}}});

test('external provenance stays separate from acceptance and private source fields', () => {
  const view = result();
  view.result.external_provenance.account_id = '<script>private-account</script>';
  const summary = resultSourceSummary(view);
  assert.equal(summary.kind, 'external_attested');
  assert.equal(summary.available, true);
  assert.match(summary.label, /Externe Herkunft bestätigt/);
  assert.doesNotMatch(JSON.stringify(summary), /private-account|script|account_id/);
  assert.equal(view.result.accepted, false);
  view.result.accepted = true; view.status = 'done';
  assert.deepEqual(resultSourceSummary(view), summary);
});

test('revoked or stale external evidence never falls back to a native source label', () => {
  for (const change of [v => {v.result.external_provenance.availability='unavailable';},
    v => {v.result.scope.availability='unavailable';},
    v => {v.result.result_revision=null;},
    v => {v.result.scope.result_revision='d'.repeat(64);},
    v => {v.result.external_provenance.result_revision='d'.repeat(64);},
    v => {v.result.task_version='d'.repeat(64); v.result.reason='task_content_changed';}]) {
    const view = result(); change(view);
    view.result.execution={availability:'available', execution_id:'native-looking', execution_revision:revision};
    const summary = resultSourceSummary(view);
    assert.equal(summary.kind, 'external_attested');
    assert.equal(summary.available, false);
    assert.doesNotMatch(summary.label, /BACH-Modelllauf/);
  }
});

test('native execution must have a genuine available execution projection', () => {
  const view = result(); view.result.source_kind='native';
  assert.equal(resultSourceSummary(view).available, false);
  view.result.execution={availability:'available', execution_id:'execution-fixture', execution_revision:revision};
  assert.equal(resultSourceSummary(view).available, true);
  assert.match(resultSourceSummary(view).label, /BACH-Modelllauf dokumentiert/);
  view.result.execution.execution_revision=true;
  assert.equal(resultSourceSummary(view).available, false);
});

test('unattested, legacy and invalid views are not promoted to proven model runs', () => {
  const view = result(); view.result.source_kind='unattested';
  assert.equal(resultSourceSummary(view).kind, 'unattested');
  assert.equal(resultSourceSummary(view).available, false);
  delete view.result.source_kind;
  assert.equal(resultSourceSummary(view).kind, 'unknown');
  for (const invalid of [null, {}, {...view, verified:false}, {...view, task_id:true},
    {...view, result:{...view.result, task_version:'f'.repeat(64)}}]) {
    assert.equal(resultSourceSummary(invalid).kind, 'unknown');
    assert.equal(resultSourceSummary(invalid).available, false);
  }
});

test('task view clears stale provenance and renders fixed labels as text', () => {
  const source = readFileSync(new URL('../src/pages/tasks.astro', import.meta.url), 'utf8');
  assert.match(source, /id="task-result-source"/);
  assert.match(source, /source\.textContent = ''/);
  assert.match(source, /source\.textContent = provenance\.label \+ ' ' \+ provenance\.detail/);
  assert.doesNotMatch(source, /source\.innerHTML/);
  assert.match(source, /Ergebnis abgegeben · Abnahme steht aus\./);
});
