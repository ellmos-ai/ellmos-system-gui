import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, relative, resolve} from 'node:path';
import {THEME_KEY, VARIANTS, classifyLink, loadPageList, normalizePagePath, selectPages, slugFor, summarize} from '../scripts/gui-walkthrough.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, 'public', 'page-reads.v1.json'), 'utf8'));
const BASE = 'http://127.0.0.1:4321';
const completeVariants = (extra = {}) => VARIANTS.map(v => ({variant: v.name, status: 200, consoleErrors: [], pageErrors: [], backendErrors: [], horizontalOverflow: false, screenshot: `${v.name}.png`, ...extra}));

const astroPages = dir => readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  if (statSync(full).isDirectory()) return astroPages(full);
  return name.endsWith('.astro') ? [full] : [];
});

test('page list comes from the manifest and covers every Astro page', () => {
  const list = loadPageList(manifest);
  const fromSource = astroPages(resolve(root, 'src', 'pages'))
    .map(file => '/' + relative(resolve(root, 'src', 'pages'), file).replace(/\\/g, '/').replace(/\.astro$/, '').replace(/(^|\/)index$/, ''))
    .map(path => (path === '/' ? '/' : path.replace(/\/$/, '')));
  assert.deepEqual(list.map(p => p.path).sort(), fromSource.sort());
  assert.equal(new Set(list.map(p => p.slug)).size, list.length, 'slugs must be unique file names');
});

test('page list rejects a foreign schema and relative paths', () => {
  assert.throws(() => loadPageList({schema: 'other', pages: {}}), /schema/);
  assert.throws(() => loadPageList({schema: manifest.schema, pages: []}), /schema/);
  assert.throws(() => loadPageList({schema: manifest.schema, pages: {tasks: []}}), /start with/);
});

test('slugs and page paths are normalised', () => {
  assert.equal(slugFor('/'), 'index');
  assert.equal(slugFor('/governance/logs'), 'governance_logs');
  assert.equal(normalizePagePath('/tasks.html'), '/tasks');
  assert.equal(normalizePagePath('/governance/index.html'), '/governance');
  assert.equal(normalizePagePath('/skills/'), '/skills');
  assert.equal(normalizePagePath('/'), '/');
});

test('link classification: internal without hash, external, skipped schemes', () => {
  const c = (href, resolved) => classifyLink(href, resolved, BASE);
  assert.deepEqual(c('/tasks#x', `${BASE}/tasks#x`), {kind: 'internal', url: `${BASE}/tasks`});
  assert.deepEqual(c('memory?tab=1', `${BASE}/memory?tab=1`), {kind: 'internal', url: `${BASE}/memory?tab=1`});
  assert.equal(c('https://github.com/x', 'https://github.com/x').kind, 'external');
  assert.equal(c('#top', `${BASE}/#top`).kind, 'skip');
  assert.equal(c('mailto:a@b.c', 'mailto:a@b.c').kind, 'skip');
  assert.equal(c('javascript:void(0)', 'javascript:void(0)').kind, 'skip');
  assert.equal(c(null, BASE).kind, 'skip');
});

test('the matrix is desktop and phone width in light and dark', () => {
  assert.deepEqual(VARIANTS.map(v => `${v.width}-${v.colorScheme}`).sort(), ['1440-dark', '1440-light', '390-dark', '390-light']);
});

test('each variant sets the stored theme the layout reads, so light and dark shots differ', () => {
  assert.equal(THEME_KEY, 'bach-theme');
  assert.match(readFileSync(resolve(root, 'src', 'layouts', 'BachLayout.astro'), 'utf8'), /localStorage\.getItem\("bach-theme"\)/);
  for (const v of VARIANTS) assert.equal(v.theme, v.colorScheme);
});

test('summary counts errors, dead links, orphans and unlisted targets', () => {
  const variant = (extra = {}) => ({variant: 'desktop-light', status: 200, consoleErrors: [], pageErrors: [], backendErrors: [], horizontalOverflow: false, screenshot: 'x.png', ...extra});
  const pages = [
    {path: '/', status: 200, variants: [variant()]},
    {path: '/tasks', status: 200, variants: [variant({consoleErrors: ['boom'], backendErrors: [{url: `${BASE}/api/tasks`, text: '404'}]})]},
    {path: '/lonely', status: 500, variants: [variant({horizontalOverflow: true})]}
  ];
  const links = [
    {url: `${BASE}/tasks`, status: 200, foundOn: ['/']},
    {url: `${BASE}/gone`, status: 404, foundOn: ['/tasks']},
    {url: `${BASE}/api/files/1`, status: 200, foundOn: ['/']}
  ];
  const s = summarize(pages, links, BASE);
  assert.equal(s.pages, 3);
  assert.deepEqual(s.httpErrors, ['/lonely']);
  assert.equal(s.consoleErrors, 1);
  assert.equal(s.backendErrors, 1);
  assert.deepEqual(s.deadLinks.map(l => l.url), [`${BASE}/gone`]);
  assert.deepEqual(s.orphans, ['/lonely']);
  assert.deepEqual(s.unlistedInternalTargets, ['/gone']);
  assert.deepEqual(s.horizontalOverflow, ['/lonely (desktop-light)']);
  assert.equal(s.ok, false);
});

test('a clean run is ok; backend errors alone do not fail it', () => {
  const pages = ['/', '/a'].map(path => ({path, status: 200, variants: completeVariants({backendErrors: [{url: `${BASE}/api/x`, text: '404'}]})}));
  const links = [{url: `${BASE}/a`, status: 200, foundOn: ['/']}];
  assert.equal(summarize(pages, links, BASE).ok, true);
});

test('selection rejects empty manifests and every unknown or empty explicit selection', () => {
  const pages = [{path: '/'}, {path: '/tasks'}];
  assert.deepEqual(selectPages(pages), pages);
  assert.deepEqual(selectPages(pages, ['/tasks', '/tasks']), [pages[1]]);
  assert.throws(() => selectPages([], undefined), /no pages/);
  assert.throws(() => selectPages(pages, []), /at least one/);
  assert.throws(() => selectPages(pages, ['/missing']), /unknown page/);
  assert.throws(() => selectPages(pages, ['/', '/missing']), /unknown page/);
});

test('every required variant must finish with a valid response and screenshot', () => {
  const page = variants => [{path: '/', status: 200, variants}];
  assert.equal(summarize(page(completeVariants()), [], BASE).ok, true);
  for (const variant of VARIANTS) {
    for (const failure of [{status: null}, {status: 503}, {status: undefined}, {screenshot: null}, {error: 'navigation timed out'}]) {
      const variants = completeVariants().map(v => v.variant === variant.name ? {...v, ...failure} : v);
      assert.equal(summarize(page(variants), [], BASE).ok, false, `${variant.name}: ${JSON.stringify(failure)}`);
    }
  }
});

test('missing, duplicate, unknown and zero-page results cannot succeed', () => {
  const page = variants => [{path: '/', status: 200, variants}];
  for (const variants of [[], completeVariants().slice(0, 2), [...completeVariants(), completeVariants()[0]], [...completeVariants(), {...completeVariants()[0], variant: 'other'}]])
    assert.equal(summarize(page(variants), [], BASE).ok, false);
  assert.equal(summarize([], [], BASE).ok, false);
});

test('the report folder is not tracked', () => {
  assert.ok(existsSync(resolve(root, '.gitignore')));
  assert.match(readFileSync(resolve(root, '.gitignore'), 'utf8'), /^reports\/$/m);
});
