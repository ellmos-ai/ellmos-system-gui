import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

test('PB-7: /system/ocean binds live GET /api/modules/surfaces with filters and demo marking', () => {
  const ocean = fs.readFileSync(path.join(root, 'src/pages/system/ocean.astro'), 'utf8');
  assert.match(ocean, /id="ocean-module-surfaces-section"/);
  assert.match(ocean, /fetch\(['"]\/api\/modules\/surfaces['"]/);
  assert.match(ocean, /data-surface-filter="gui"/);
  assert.match(ocean, /data-surface-filter="agent_only"/);
  assert.match(ocean, /data-surface-filter="demo"/);
  assert.match(ocean, /mod\.demo_mode === true/);
});

test('PB-5/PB-23: /talk reads stt_engine/tts_engine & wakeword_available without Steckplatz/Cortex-Slot', () => {
  const talk = fs.readFileSync(path.join(root, 'src/pages/talk.astro'), 'utf8');
  assert.match(talk, /st\.stt_engine \|\| st\.stt_backend/);
  assert.match(talk, /st\.tts_engine \|\| st\.tts_backend/);
  assert.match(talk, /st\.wakeword_available === true/);
  assert.doesNotMatch(talk, /Steckplatz/);
  assert.doesNotMatch(talk, /Cortex-Slot/);
});

test('PB-12: /life exposes mirror, transfer, and clone direct calendar silo actions', () => {
  const life = fs.readFileSync(path.join(root, 'src/pages/life.astro'), 'utf8');
  assert.match(life, /id="modal-event-silo-action"/);
  assert.match(life, /data-silo-op="mirror"/);
  assert.match(life, /data-silo-op="transfer"/);
  assert.match(life, /data-silo-op="clone"/);
  assert.match(life, /\/api\/calendar\/events\/\$\{_siloActionEventId\}\/mirror/);
  assert.match(life, /\/api\/calendar\/events\/\$\{_siloActionEventId\}\/transfer/);
  assert.match(life, /\/api\/calendar\/events\/\$\{_siloActionEventId\}\/clone/);
});
