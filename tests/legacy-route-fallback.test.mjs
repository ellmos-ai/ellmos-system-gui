import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {commonRoutePaths, legacyFallbackRoutes} from '../src/lib/navigation-route-inventory.mjs';

const root = process.cwd();
const pagesRoot = join(root, 'src', 'pages');
const expectedFallbackPaths = ['/inbox', '/help', '/tools', '/maintenance'];
const migratedCommonPaths = [
  '/routinen', '/chat', '/persoenlich', '/financial',
  '/gesundheit', '/ati', '/steuer', '/kontakte', '/daemon',
];

function pageSource(routePath) {
  return readFileSync(join(pagesRoot, `${routePath.slice(1)}.astro`), 'utf8');
}

test('the remaining legacy inventory has one page per tracked entry', () => {
  assert.deepEqual(legacyFallbackRoutes.map((route) => route.path), expectedFallbackPaths);
  assert.deepEqual(commonRoutePaths, migratedCommonPaths);
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
  assert.equal(readFileSync(join(root, 'src', 'lib', 'navigation-route-inventory.mjs'), 'utf8').includes('id: 2468'), true);
});

test('all 7 formerly visible fallback pages render real Astro views without LegacyRouteFallback or unsafe HTML sinks', () => {
  const seven = ['/persoenlich', '/financial', '/gesundheit', '/ati', '/steuer', '/kontakte', '/daemon'];
  for (const routePath of seven) {
    const src = pageSource(routePath);
    assert.match(src, /BachLayout/, routePath);
    assert.doesNotMatch(src, /LegacyRouteFallback/, `${routePath} must not render LegacyRouteFallback`);
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|set:html|document\.write|\son[a-z]+\s*=|\balert\(/, routePath);
    const scriptPath = join(root, 'src', 'scripts', `${routePath.slice(1)}-page.mjs`);
    assert.ok(existsSync(scriptPath), `missing script ${scriptPath}`);
    const scriptSrc = readFileSync(scriptPath, 'utf8');
    assert.doesNotMatch(scriptSrc, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\balert\(/, scriptPath);
    assert.match(scriptSrc, /fetch\('\/api\//, `${scriptPath} must call real backend API`);
  }
  const routines = pageSource('/routinen');
  assert.doesNotMatch(routines, /LegacyRouteFallback/);
  const daemon = pageSource('/daemon');
  assert.match(daemon, /daemon-services-panel/);
  assert.match(daemon, /daemon-chain-content/);
  const daemonScript = readFileSync(join(root, 'src', 'scripts', 'daemon-page.mjs'), 'utf8');
  assert.match(daemonScript, /get\('tab'\) === 'chains'/);
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
