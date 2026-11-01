import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {commonRoutePaths, legacyFallbackRoutes} from '../src/lib/navigation-route-inventory.mjs';

const root = process.cwd();
const pagesRoot = join(root, 'src', 'pages');
const expectedFallbackPaths = [
  '/persoenlich', '/chat', '/denkarium', '/financial', '/gesundheit', '/ati', '/steuer',
  '/inbox', '/help', '/tools', '/maintenance', '/kontakte', '/daemon',
];

function pageSource(routePath) {
  return readFileSync(join(pagesRoot, `${routePath.slice(1)}.astro`), 'utf8');
}

test('the measured legacy inventory has one visible fallback per unresolved route', () => {
  assert.deepEqual(legacyFallbackRoutes.map((route) => route.path), expectedFallbackPaths);
  assert.deepEqual(commonRoutePaths, ['/routinen']);
  for (const route of legacyFallbackRoutes) {
    assert.ok(existsSync(join(pagesRoot, `${route.path.slice(1)}.astro`)), route.path);
    assert.match(pageSource(route.path), /BachLayout/);
    assert.match(pageSource(route.path), /LegacyRouteFallback/);
  }
});

test('fallback text points to task 2468 and states the evidence boundary', () => {
  const component = readFileSync(join(root, 'src', 'components', 'LegacyRouteFallback.astro'), 'utf8');
  assert.match(component, /Rückfall erkannt/);
  assert.match(component, /alte BACH-Vorlage/);
  assert.match(component, /Keine Laufzeit- oder Backend-Aussage/);
  assert.match(component, /fallbackTask\.href/);
  assert.match(component, /fallbackTask\.label/);
  assert.equal(readFileSync(join(root, 'src', 'lib', 'navigation-route-inventory.mjs'), 'utf8').includes("id: 2468"), true);
});

test('Routinen is the common page and daemon is gated by the chains query', () => {
  const routines = readFileSync(join(pagesRoot, 'routinen.astro'), 'utf8');
  const daemon = readFileSync(join(pagesRoot, 'daemon.astro'), 'utf8');
  assert.doesNotMatch(routines, /LegacyRouteFallback/);
  assert.match(daemon, /get\('tab'\) === 'chains'/);
  assert.match(daemon, /daemon-legacy-fallback/);
  assert.match(daemon, /daemon-chain-content/);
});

test('the build guard is wired into normal and release builds', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts.build, /verify-navigation-routes\.mjs/);
  assert.match(packageJson.scripts['build:release'], /verify-navigation-routes\.mjs/);
  const guard = readFileSync(join(root, 'scripts', 'verify-navigation-routes.mjs'), 'utf8');
  assert.match(guard, /nav_config\.json/);
  assert.match(guard, /Header\.astro/);
  assert.match(guard, /fallbackPaths/);
  assert.match(guard, /throw new Error/);
});
