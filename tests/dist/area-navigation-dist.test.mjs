// Renders nothing itself: reads the HTML of a finished build (npm run build, or GUI_DIST=<dir>) and checks the
// navigation contract on the real output (PB-5a). Run with: npm run test:dist
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {areaForPath} from '../../src/lib/area-nav.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dist = resolve(process.env.GUI_DIST || join(root, 'dist'));
const nav = JSON.parse(readFileSync(join(root, 'src', 'config', 'nav_config.json'), 'utf8'));
const areas = nav.area_navs;

function htmlFiles(dir) {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? htmlFiles(full) : entry.name.endsWith('.html') ? [full] : [];
  });
}
const routeOf = (file) => {
  const rel = relative(dist, file).replaceAll('\\', '/').replace(/\.html$/, '');
  return rel === 'index' ? '/' : '/' + rel.replace(/\/index$/, '');
};

assert.ok(existsSync(dist), `no build output at ${dist}; run "npm run build" first or set GUI_DIST`);
const pages = htmlFiles(dist).map((file) => ({route: routeOf(file), html: readFileSync(file, 'utf8')}));
const page = (route) => pages.find((entry) => entry.route === route);

function areaNavOf(html) {
  const match = html.match(/<nav[^>]*data-area-nav="([^"]+)"[^>]*>([\s\S]*?)<\/nav>/);
  if (!match) return null;
  const entries = [...match[2].matchAll(/<a\b([^>]*)>/g)].map((link) => ({
    id: link[1].match(/data-area-entry="([^"]+)"/)?.[1],
    href: link[1].match(/href="([^"]+)"/)?.[1].replaceAll('&amp;', '&'),
    current: /aria-current="page"/.test(link[1]),
  }));
  return {area: match[1], entries};
}

test('every page of an area renders the same area navigation, all others render none', () => {
  for (const entry of pages) {
    const expected = areaForPath(areas, entry.route);
    const found = areaNavOf(entry.html);
    if (!expected) { assert.equal(found, null, `${entry.route} must not render an area navigation`); continue; }
    assert.ok(found, `${entry.route} renders the ${expected.id} navigation`);
    assert.equal(found.area, expected.id, entry.route);
    assert.deepEqual(found.entries.map((link) => [link.id, link.href]), expected.entries.map((link) => [link.id, link.href]), entry.route);
  }
  assert.ok(pages.filter((entry) => areaForPath(areas, entry.route)).length >= 14);
});

test('the entry of the current page is marked by path (query refinement happens in the browser)', () => {
  const marked = (route) => areaNavOf(page(route).html).entries.filter((link) => link.current).map((link) => link.id);
  assert.deepEqual(marked('/agenten/blueprints'), ['templates']);
  assert.deepEqual(marked('/agenten/subscription-agents'), ['prompt-agents']);
  assert.deepEqual(marked('/agenten/marblerun'), ['chains']);
  assert.deepEqual(marked('/system/ocean'), ['systems']);
  assert.deepEqual(marked('/system/installation-updates'), ['installation-updates']);
  assert.deepEqual(marked('/daemon'), ['services']);
  assert.deepEqual(marked('/maintenance'), ['maintenance']);
  assert.deepEqual(marked('/governance/usecases'), ['quality']);
  assert.deepEqual(marked('/settings'), ['connections']);
  for (const [route, id] of [['/governance', 'overview'], ['/governance/regeln', 'rules-decisions'], ['/governance/sperren', 'locks'],
    ['/governance/hooks', 'hooks-guards'], ['/governance/rechte', 'authority'], ['/governance/funk', 'agentenfunk'], ['/governance/logs', 'audit']])
    assert.deepEqual(marked(route), [id], route);
});

test('no area entry leads to a page with another area navigation (B-11)', () => {
  for (const area of areas) for (const entry of area.entries) {
    const target = page(new URL(entry.href, 'https://gui.invalid').pathname);
    assert.ok(target, `${entry.href} is built`);
    assert.equal(areaNavOf(target.html)?.area, area.id, `${area.id} -> ${entry.href}`);
  }
});

test('B-08: the old library URLs are redirects to the templates', () => {
  for (const route of Object.keys(nav.redirects)) {
    assert.match(page(route).html, /http-equiv="refresh" content="0;url=\/agenten\/blueprints"/, route);
    assert.equal(areaNavOf(page(route).html), null, route);
  }
});

test('B-12: governance sub pages carry their own heading and data source', () => {
  const routes = ['/governance', '/governance/regeln', '/governance/sperren', '/governance/hooks', '/governance/rechte', '/governance/funk', '/governance/logs'];
  const headings = routes.map((route) => page(route).html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1].replace(/<[^>]+>/g, '').trim());
  assert.equal(new Set(headings).size, routes.length, headings.join(' | '));
  const sources = routes.map((route) => page(route).html.match(/data-source="([^"]+)"/)?.[1]);
  assert.equal(new Set(sources).size, routes.length, sources.join(' | '));
});

test('the sidebar marks one entry per preset on every page it has an entry for', () => {
  const flat = (items) => items.flatMap((item) => item.children ? flat(item.children) : item.href ? [item.href] : []);
  const configured = Object.fromEntries(Object.entries(nav.presets).map(([id, preset]) => [id,
    new Set([preset.home.href, ...preset.sections.flatMap((section) => flat(section.items))].map((href) => new URL(href, 'https://gui.invalid').pathname))]));
  for (const entry of pages) {
    for (const preset of Object.keys(nav.presets)) {
      const block = entry.html.match(new RegExp('class="nav-preset"[^>]*data-ui-preset="' + preset + '"[\\s\\S]*?(?=class="nav-preset"|class="sidebar-domain-pins")'))?.[0] ?? '';
      const marked = (block.match(/aria-current="page"/g) || []).length;
      assert.ok(marked <= 1, `${entry.route}: ${marked} marked entries in ${preset}`);
      if (configured[preset].has(entry.route) || areaForPath(areas, entry.route)) assert.equal(marked, 1, `${entry.route}: one marked entry in ${preset}`);
    }
  }
});
