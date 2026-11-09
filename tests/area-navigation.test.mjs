import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {areaForPath, areaNavModel, breadcrumbFor, pathOf, resolveActiveItem, resolveSidebarActive} from '../src/lib/area-nav.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pagesRoot = join(root, 'src', 'pages');
const nav = JSON.parse(readFileSync(join(root, 'src', 'config', 'nav_config.json'), 'utf8'));
const areas = nav.area_navs;

function pageFiles(dir = pagesRoot) {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? pageFiles(full) : entry.name.endsWith('.astro') ? [full] : [];
  });
}
const routeOf = (file) => {
  const rel = relative(pagesRoot, file).replaceAll('\\', '/').replace(/\.astro$/, '');
  return rel === 'index' ? '/' : '/' + rel.replace(/\/index$/, '');
};
const pages = pageFiles().map((file) => ({file, route: routeOf(file), source: readFileSync(file, 'utf8')}));
const area = (id) => areas.find((entry) => entry.id === id);
const entryIds = (id) => area(id).entries.map((entry) => entry.id);

test('the navigation config declares the three area navigations with the agreed entries', () => {
  assert.deepEqual(areas.map((entry) => entry.id), ['agent-library', 'betrieb', 'governance']);
  assert.deepEqual(entryIds('agent-library'), ['templates', 'chains']);
  // B-10: Systeme und Installation & Updates gehoeren in die Bereichsnavigation von Verbindungen und Modelle & Ressourcen.
  assert.deepEqual(entryIds('betrieb'), ['connections', 'models-resources', 'systems', 'installation-updates', 'services', 'maintenance', 'quality']);
  // B-12: jeder Governance-Eintrag hat eine eigene Route.
  assert.deepEqual(entryIds('governance'), ['overview', 'rules-decisions', 'locks', 'hooks-guards', 'authority', 'agentenfunk', 'audit']);
  const governancePaths = area('governance').entries.map((entry) => pathOf(entry.href));
  assert.equal(new Set(governancePaths).size, governancePaths.length, 'jeder Governance-Eintrag hat einen eigenen Pfad');
});

test('no area entry jumps into another area (B-11): the target page carries the same area navigation', () => {
  for (const entry of areas.flatMap((a) => a.entries.map((e) => ({area: a, entry: e})))) {
    const target = pathOf(entry.entry.href);
    assert.equal(areaForPath(areas, target)?.id, entry.area.id, `${entry.area.id}/${entry.entry.id} -> ${target}`);
    assert.ok(pages.some((page) => page.route === target), `${target} has a page`);
  }
});

test('every page of an area is wired to the one shared area navigation and none builds its own', () => {
  const layout = readFileSync(join(root, 'src', 'layouts', 'BachLayout.astro'), 'utf8');
  assert.match(layout, /import AreaNav from "\.\.\/components\/AreaNav\.astro"/);
  assert.match(layout, /areaForPath\(/);
  const members = pages.filter((page) => areaForPath(areas, page.route));
  assert.ok(members.length >= 14, `area pages found: ${members.map((m) => m.route).join(', ')}`);
  for (const page of members) {
    assert.match(page.source, /BachLayout/, `${page.route} uses the shared layout`);
    assert.match(page.source, /<BachLayout[^>]*currentPath=\{?["']?[^"'}]*/, `${page.route} passes currentPath`);
    assert.doesNotMatch(page.source, /<nav[^>]*(?:Agenten-Bibliothek Hauptreiter|class="(?:studio-tabs|chain-actions|subscription-actions|library-tabs)")/, `${page.route} builds its own tab bar`);
  }
  const currentPathOf = (page) => page.source.match(/currentPath=(?:\{([^}]*)\}|"([^"]*)")/);
  for (const page of members) {
    const match = currentPathOf(page);
    assert.ok(match, `${page.route} sets currentPath`);
    const value = match[2] ?? null;
    if (value) assert.equal(areaForPath(areas, value)?.id, areaForPath(areas, page.route)?.id, `${page.route} currentPath ${value} stays in its area`);
  }
});

test('pages outside an area carry no area navigation', () => {
  for (const route of ['/', '/chat', '/tasks', '/routinen', '/agenten/running', '/agenten/sessions', '/skills', '/memory', '/help']) {
    assert.equal(areaForPath(areas, route), null, route);
  }
});

test('B-08: fabrika and bibliothek are redirects to the template page, the old page is not duplicated', () => {
  assert.deepEqual(nav.redirects, {
    '/agenten/fabrika': '/agenten/blueprints',
    '/agenten/bibliothek': '/agenten/blueprints',
    '/agenten/subscription-agents': '/agenten/blueprints?tab=prompt-agents',
  });
  for (const [from, to] of Object.entries(nav.redirects)) {
    const page = pages.find((entry) => entry.route === from);
    assert.ok(page, `${from} stays as a redirect page`);
    const escapedTo = to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(page.source, new RegExp(`http-equiv="refresh" content="0;url=${escapedTo}"`));
    assert.match(page.source, /location\.replace/);
    assert.ok(page.source.length < 2500, `${from} is only a redirect`);
    assert.equal(areaForPath(areas, from), null);
  }
  const blueprints = pages.find((entry) => entry.route === '/agenten/blueprints');
  assert.ok(blueprints.source.length > 5000);
  const hashes = new Set(pages.map((entry) => entry.source));
  assert.equal(hashes.size, pages.length, 'no two page files share the same content');
});

test('B-08: the sidebar library entry points to the templates and the old overview content survives', () => {
  const links = Object.values(nav.presets).flatMap((preset) => preset.sections.flatMap((section) => section.items.flatMap((item) => item.children || [item])));
  assert.equal(links.filter((link) => link.href === '/agenten/fabrika').length, 0);
  assert.ok(links.some((link) => link.id === 'agent-library' && link.href === '/agenten/blueprints'));
  const prompt = pages.find((entry) => entry.route === '/agenten/subscription-agents').source;
  assert.match(prompt, /extern zugeschaltet/);
  assert.match(prompt, /Living &(?:amp;)? Running/);
  const chains = pages.find((entry) => entry.route === '/agenten/marblerun').source;
  assert.match(chains, /href="\/daemon\?tab=chains[^"]*"/);
  assert.match(chains, /Nur dort werden bestätigte Living- oder Running-Zustände|Living &(?:amp;)? Running/);
  const templates = pages.find((entry) => entry.route === '/agenten/blueprints').source;
  assert.match(templates, /Living &(?:amp;)? Running/);
});

test('B-12: every governance sub route renders its own content and reads its own backend source', () => {
  const routes = ['/governance', '/governance/regeln', '/governance/sperren', '/governance/hooks', '/governance/rechte', '/governance/funk', '/governance/logs'];
  const headings = new Set();
  const sources = new Set();
  for (const route of routes) {
    const page = pages.find((entry) => entry.route === route);
    assert.ok(page, `${route} exists`);
    const h1 = page.source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1].replace(/<[^>]+>/g, '').trim();
    assert.ok(h1, `${route} has a heading`);
    headings.add(h1);
    const source = page.source.match(/data-source="([^"]+)"/)?.[1];
    assert.ok(source, `${route} names its data source`);
    sources.add(source);
  }
  assert.equal(headings.size, routes.length, [...headings].join(' | '));
  assert.equal(sources.size, routes.length, [...sources].join(' | '));
  const hooks = pages.find((entry) => entry.route === '/governance/hooks').source;
  assert.match(hooks, /\/api\/governance\/hooks/);
  const rights = pages.find((entry) => entry.route === '/governance/rechte').source;
  assert.match(rights, /\/api\/governance\/permission-matrix/);
  assert.doesNotMatch(rights, /<span class="badge">(?:erlaubt|Rückfrage|nie)/, 'no hand written permission badges');
});

test('B-12: the old governance tab links keep working through a redirect', () => {
  const index = pages.find((entry) => entry.route === '/governance').source;
  for (const [tab, target] of Object.entries({locks: '/governance/sperren', hooks: '/governance/hooks', authority: '/governance/rechte',
    decisions: '/governance/regeln', policies: '/governance/regeln', registry: '/governance/regeln', effective: '/governance/regeln'})) {
    assert.ok(index.includes(`${tab}`) && index.includes(`${target}`), `${tab} -> ${target}`);
  }
  assert.match(index, /location\.replace/);
});

// --- Aktiv-Markierung (B-11): ein Eintrag, nach Pfad-Praefix statt exakter URL ---------------------------------------
const flat = (items) => items.flatMap((item) => item.children ? flat(item.children) : item.href ? [{id: item.id, href: item.href}] : []);
const sidebar = Object.fromEntries(Object.entries(nav.presets).map(([id, preset]) => [id, [{id: preset.home.id, href: preset.home.href}, ...preset.sections.flatMap((section) => flat(section.items))]]));
const active = (preset, href) => { const url = new URL(href, 'https://gui.test'); return resolveSidebarActive(sidebar[preset], areas, url.pathname, url.search); };

test('the sidebar marks exactly one entry for every configured link and its query variants', () => {
  for (const [preset, items] of Object.entries(sidebar)) {
    for (const item of items) {
      const found = active(preset, item.href);
      assert.ok(found, `${preset}: ${item.href} has an active entry`);
      const same = items.filter((other) => other.href === item.href).map((other) => other.id);
      assert.ok(same.includes(found), `${preset}: ${item.href} marks ${found}, expected one of ${same}`);
    }
  }
});

test('pages with extra query parameters or deeper paths keep their area marked', () => {
  const cases = [
    ['/chat?slot_id=42', 'chat'], ['/tasks?create=1&assign_slot=3', 'tasks'], ['/tasks?assigned_to=user', 'tasks'],
    ['/agenten/blueprints', 'agent-library'], ['/agenten/blueprints?tab=teams', 'agent-library'],
    ['/skills/mcp?component_id=7', 'mcp'], ['/governance/funk', 'overview'], ['/governance/regeln?tab=registry', 'rules-decisions'],
    ['/governance/sperren', 'locks'], ['/governance/usecases', 'quality'], ['/system/ocean', 'systems'],
    ['/settings?tab=appearance', 'settings'], ['/settings?tab=core', 'models-resources'], ['/daemon?tab=chains', 'services'],
  ];
  for (const [href, id] of cases) assert.equal(active('standard', href), id, href);
});

test('a page of an area without its own sidebar entry marks the area home entry (classic has no "Ketten")', () => {
  assert.equal(active('classic', '/agenten/marblerun'), 'agent-library');
  assert.equal(active('classic', '/agenten/blueprints?tab=prompt-agents'), 'agent-library');
  assert.equal(active('standard', '/agenten/marblerun'), 'chains');
  assert.equal(active('classic', '/governance/sperren'), 'governance-control');
});

test('the user inbox alias and the archived-sessions inbox tab mark the same entry', () => {
  assert.equal(active('standard', '/agenten/sessions?tab=inbox'), 'messages');
});

test('unrelated paths are not claimed by a shorter entry (no accidental prefix)', () => {
  assert.equal(resolveActiveItem([{id: 'run', href: '/agenten/running'}], '/agenten/runningx', ''), null);
  assert.equal(resolveActiveItem([{id: 'start', href: '/'}], '/chat', ''), null);
});

test('area navigation marks the entry of the current page, the connections default and nothing for foreign settings tabs', () => {
  const current = (route, search = '') => areaNavModel(area('betrieb'), route, search).entries.filter((entry) => entry.current).map((entry) => entry.id);
  assert.deepEqual(current('/settings', ''), ['connections']);
  assert.deepEqual(current('/settings', '?tab=connections'), ['connections']);
  assert.deepEqual(current('/settings', '?tab=core'), ['models-resources']);
  assert.deepEqual(current('/settings', '?tab=appearance'), []);
  assert.deepEqual(current('/system/ocean'), ['systems']);
  assert.deepEqual(current('/system/installation-updates'), ['installation-updates']);
  assert.deepEqual(current('/daemon', '?tab=chains'), ['services']);
  assert.deepEqual(current('/governance/usecases'), ['quality']);
  const governance = (route, search = '') => areaNavModel(area('governance'), route, search).entries.filter((entry) => entry.current).map((entry) => entry.id);
  assert.deepEqual(governance('/governance'), ['overview']);
  assert.deepEqual(governance('/governance/regeln', '?tab=policies'), ['rules-decisions']);
  assert.deepEqual(governance('/governance/logs'), ['audit']);
});

test('every page of one area gets the identical, ordered entry list', () => {
  for (const a of areas) {
    const lists = pages.filter((page) => areaForPath(areas, page.route)?.id === a.id)
      .map((page) => areaNavModel(a, page.route, '').entries.map((entry) => `${entry.id}=${entry.href}`).join('|'));
    assert.ok(lists.length >= 2, a.id);
    assert.equal(new Set(lists).size, 1, a.id);
  }
});

test('B-11: a link into another area can carry a way back that only points to known areas', () => {
  assert.deepEqual(breadcrumbFor(areas, 'betrieb'), {id: 'betrieb', label: 'Betrieb', href: area('betrieb').home});
  assert.deepEqual(breadcrumbFor(areas, 'governance').label, 'Governance');
  assert.equal(breadcrumbFor(areas, 'https://evil.example'), null);
  assert.equal(breadcrumbFor(areas, '../../x'), null);
  assert.equal(breadcrumbFor(areas, null), null);
  const layout = readFileSync(join(root, 'src', 'layouts', 'BachLayout.astro'), 'utf8');
  assert.match(layout, /data-breadcrumb/);
  assert.match(layout, /zurück zu/);
});

test('the sidebar governance group links to the real sub routes', () => {
  const links = Object.values(nav.presets).flatMap((preset) => preset.sections.flatMap((section) => flat(section.items))).map((link) => link.href);
  for (const href of ['/governance/regeln', '/governance/sperren', '/governance/hooks', '/governance/rechte', '/governance/logs']) assert.ok(links.includes(href), href);
  assert.ok(!links.some((href) => /^\/governance\?tab=/.test(href)), 'no query tab links remain in the sidebar');
  assert.ok(existsSync(join(pagesRoot, 'governance', 'regeln.astro')));
});

test('PB-25 (6): Prompt-Agenten is part of Agenten-Bibliothek, not a separate menu item, and lands directly in template view', () => {
  const allMenuIds = Object.values(nav.presets).flatMap((preset) =>
    preset.sections.flatMap((section) => section.items.flatMap((item) => [item.id, ...(item.children || []).map((c) => c.id)])),
  );
  assert.ok(!allMenuIds.includes('prompt-agents'), 'prompt-agents is removed from preset menus');
  assert.ok(!entryIds('agent-library').includes('prompt-agents'), 'prompt-agents is removed from agent-library area nav');
  assert.equal(nav.redirects['/agenten/subscription-agents'], '/agenten/blueprints?tab=prompt-agents');

  const blueprints = pages.find((entry) => entry.route === '/agenten/blueprints').source;
  assert.match(blueprints, /<button role="tab" type="button" aria-selected="true" data-library="templates">/);
  assert.match(blueprints, /<button role="tab" type="button" aria-selected="false" data-library="prompt-agents">Prompt-Agenten<\/button>/);
  assert.match(blueprints, /id="studio-prompt-agents"/);
  assert.ok(
    blueprints.indexOf('id="studio-grid"') < blueprints.indexOf('id="ocean-role-socket-panel"'),
    'template grid comes directly after tabs before role socket panel',
  );
});

test('PB-25 (7): Deine Agenten in standard preset has Living & Running and Memory children', () => {
  const arbeitItems = nav.presets.standard.sections.find((s) => s.id === 'arbeit').items;
  const deineAgenten = arbeitItems.find((item) => item.label === 'Deine Agenten');
  assert.ok(deineAgenten, 'Deine Agenten group exists in standard preset');
  assert.equal(deineAgenten.id, 'agents');
  assert.deepEqual(
    deineAgenten.children.map((c) => ({ id: c.id, label: c.label, href: c.href })),
    [
      { id: 'living-running', label: 'Living & Running', href: '/agenten/running' },
      { id: 'memory', label: 'Memory', href: '/memory' },
    ],
  );
  assert.equal(active('standard', '/agenten/running'), 'living-running');
  assert.equal(active('standard', '/memory'), 'memory');
});
