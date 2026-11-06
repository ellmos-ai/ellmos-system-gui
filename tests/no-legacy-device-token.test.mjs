// SPDX-License-Identifier: MIT
// PB-3 (#3987): Seit der HttpOnly-Cookie-Sitzung gibt es kein `bach_device_token` im localStorage mehr.
// Seiten duerfen es nicht als harte Voraussetzung lesen (B-12 "Logs & Audit leer", "Theme speichern" gesperrt).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const walk = dir => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const sources = walk(root).filter(p => /\.(astro|mjs|js|ts)$/.test(p));
const read = rel => readFileSync(join(root, rel), 'utf8');

test('bach_device_token wird in src/ nur in consumer-api-auth.mjs gelesen', () => {
  const hits = sources.filter(p => readFileSync(p, 'utf8').includes('bach_device_token'))
    .map(p => relative(root, p).split(sep).join('/'));
  assert.deepEqual(hits, ['lib/consumer-api-auth.mjs']);
});

test('Artefakte, Logs & Audit und Theme speichern verlangen keinen localStorage-Token', () => {
  assert.doesNotMatch(read('pages/artefakte.astro'), /artifactToken/);
  assert.doesNotMatch(read('pages/governance/logs.astro'), /auditToken/);
  const settings = read('pages/settings.astro');
  assert.doesNotMatch(settings, /save\.disabled = !localStorage/);
  assert.doesNotMatch(settings, /const token = localStorage/);
});
