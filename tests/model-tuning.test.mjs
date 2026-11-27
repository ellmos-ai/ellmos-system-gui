import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeModelTuningSummary,
  formatConfidenceLabel,
  formatSourceLabel,
  sortModelTuningEntries,
  validateNumCtxInput,
} from '../src/lib/model-tuning.mjs';

test('validateNumCtxInput enforces integer bounds and warns above host limit', () => {
  assert.equal(validateNumCtxInput('abc').ok, false);
  assert.equal(validateNumCtxInput(true).ok, false);
  assert.equal(validateNumCtxInput('256').ok, false);
  assert.equal(validateNumCtxInput('524288').ok, false);

  const safe = validateNumCtxInput('16384', { supported_on_host: true, num_ctx_max: 16384 });
  assert.equal(safe.ok, true);
  assert.equal(safe.value, 16384);
  assert.equal(safe.warning, '');

  const risky = validateNumCtxInput('24576', { supported_on_host: true, num_ctx_max: 16384 });
  assert.equal(risky.ok, true);
  assert.equal(risky.value, 24576);
  assert.match(risky.warning, /OOM-Risiko/);
});

test('sortModelTuningEntries prioritizes installed and host-supported models', () => {
  const sorted = sortModelTuningEntries([
    { model: 'qwen3:8b', installed: false, supported_on_host: true },
    { model: 'inkling-2-mini:latest', installed: true, supported_on_host: true },
    { model: 'qwen3.6:35b-mlx', installed: false, supported_on_host: false },
  ]);
  assert.deepEqual(
    sorted.map(item => item.model),
    ['inkling-2-mini:latest', 'qwen3:8b', 'qwen3.6:35b-mlx'],
  );
});

test('describeModelTuningSummary and labels format verified metadata cleanly', () => {
  assert.equal(formatConfidenceLabel('measured_live'), 'Lokal vermessen');
  assert.equal(formatConfidenceLabel('curated'), 'Hardware-Default');
  assert.equal(formatSourceLabel('catalog_default'), 'Hardware-Katalog');
  assert.equal(formatSourceLabel('model_config'), 'Modell-Config');

  const summary = describeModelTuningSummary({
    ok: true,
    host_ram_gib: 32,
    models: [
      { model: 'inkling-2-mini:latest', installed: true, has_manual_override: false },
      { model: 'gemma4:12b', installed: false, has_manual_override: true },
    ],
  });
  assert.equal(summary.ready, true);
  assert.match(summary.hostBadge, /32 GiB RAM/);
  assert.match(summary.summaryText, /1 lokal installiert/);
  assert.match(summary.summaryText, /1 manuell angepasst/);
});
