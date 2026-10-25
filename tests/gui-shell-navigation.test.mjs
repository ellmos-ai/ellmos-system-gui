import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/layouts/BachLayout.astro', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/pages/settings.astro', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
const navConfig = JSON.parse(readFileSync(new URL('../src/config/nav_config.json', import.meta.url), 'utf8'));
const frontmatter = header.match(/^---\r?\n([\s\S]*?)\r?\n---/);
assert.ok(frontmatter, 'Header.astro has frontmatter');

const serverMatcherSource = frontmatter[1].match(/function matchesNavigationHref\(href: string, pathname: string, search: string\) \{[\s\S]*?\n\}/);
assert.ok(serverMatcherSource, 'the server route matcher is present');
const matchesNavigationHref = new Function(`${serverMatcherSource[0].replaceAll(': string', '')}\nreturn matchesNavigationHref;`)();

const clientMatcherSource = header.match(/function matchesCurrentNavigationRoute\(href\) \{[\s\S]*?\n  \}/);
assert.ok(clientMatcherSource, 'the client route matcher is present');
const sidebarSyncSource = header.match(/function syncSidebarMode\(\) \{[\s\S]*?\n  \}/);
assert.ok(sidebarSyncSource, 'the sidebar mode synchronizer is present');
const sidebarTabTrapSource = header.match(/function trapMobileNavigationTab\(event\) \{[\s\S]*?\n  \}/);
assert.ok(sidebarTabTrapSource, 'the mobile navigation Tab trap is present');
const brandRefreshSource = header.match(/async function refreshGuiBrand\(\) \{[\s\S]*?\n  \}/);
assert.ok(brandRefreshSource, 'the runtime brand refresh is present');
function matchesClientRoute(href, url) {
  const matcher = new Function('window', `${clientMatcherSource[0]}\nreturn matchesCurrentNavigationRoute;`)({ location: new URL(url) });
  return matcher(href);
}

const routeCases = [
  ['/agenten/running', '/agenten/running', '', true],
  ['/agenten/running', '/agentenschaft', '', false],
  ['/settings', '/settings-extra', '', false],
  ['/routinen?tab=bach', '/routinen', '?tab=bach', true],
  ['/routinen?tab=ocean', '/routinen', '?tab=bach', false],
  ['/routinen', '/routinen', '?tab=bach', false],
  ['/tasks', '/tasks', '?assigned_to=user', false],
  ['/tasks?assigned_to=user', '/tasks', '?assigned_to=user', true],
  ['/governance?tab=locks', '/governance/', '?tab=locks', true],
  ['/', '/governance/funk', '', false],
];

test('server and browser active states use exact paths and exact query selections', () => {
  for (const [href, pathname, search, expected] of routeCases) {
    assert.equal(matchesNavigationHref(href, pathname, search), expected, `server: ${href} at ${pathname}${search}`);
    const current = new URL(pathname, 'https://gui.test');
    current.search = search;
    assert.equal(matchesClientRoute(href, current.href), expected, `browser: ${href} at ${current.href}`);
  }
});

function flattenLinks(items) {
  return items.flatMap((item) => item.href ? [item.href] : flattenLinks(item.children || []));
}

test('both approved navigation presets expose their complete templates', () => {
  assert.equal(navConfig.schema, 'ellmos.gui.navigation.v2');
  assert.equal(navConfig.default_preset, 'standard');
  assert.deepEqual(Object.keys(navConfig.presets), ['standard', 'classic']);
  assert.equal(navConfig.presets.standard.label, 'Standard bewährt');
  assert.equal(navConfig.presets.classic.label, 'Ocean-BACH-Klassik');
  assert.deepEqual(navConfig.presets.standard.sections.map((section) => section.label), ['ARBEIT', 'BETRIEB', 'DOMÄNEN', 'EINSTELLUNGEN']);
  assert.deepEqual(navConfig.presets.classic.sections.map((section) => section.label), ['ARBEIT', 'LEBEN', 'SYSTEM']);
  const configuredLinks = Object.values(navConfig.presets).flatMap((preset) => [
    preset.home.href,
    ...preset.sections.flatMap((section) => flattenLinks(section.items)),
  ]);
  assert.ok(configuredLinks.length >= 50);
  assert.match(header, /item\.children\.map\(\(child: any\)/);
  assert.doesNotMatch(header, /children\.filter\(/);
  assert.match(header, /data-nav-link/);
  assert.match(header, /id="domain-pins-menu"/);
  assert.match(header, /initializeDomainMenu\(\)/);
  assert.match(header, /window\.bachUiPreset/);
  assert.match(header, /localStorage\.getItem\(uiPresetKey\)/);
  assert.match(layout, /localStorage\.getItem\("bach-ui-preset"\)/);
  assert.match(settings, /id="ui-preset-select"/);
  assert.match(settings, /Ocean-BACH-Klassik/);
  assert.doesNotMatch(dashboard, /Schnellstart &amp; Arbeitsbereiche/);
});

test('mobile navigation exposes keyboard controls and returns focus when dismissed', () => {
  assert.match(header, /aria-controls="app-sidebar"/);
  assert.match(header, /aria-expanded="false"/);
  assert.match(header, /sidebar\.inert = !mobileNavigationOpen/);
  assert.match(header, /sidebar\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(header, /event\.key === 'Escape'/);
  assert.match(header, /setMobileNavigationOpen\(false, true\)/);
  assert.match(header, /trapMobileNavigationTab\(event\)/);
  assert.match(header, /id="sidebar-close"/);
  assert.match(header, /sidebar-backdrop/);
  assert.match(header, /<summary class="sidebar-group-title">/);
  assert.match(header, /aria-current=\{isActive\(child\.href\) \? "page" : undefined\}/);
});

test('mobile drawer makes background controls inert and restores them on close', () => {
  function makeElement() {
    const attributes = new Map();
    const classes = new Set();
    return {
      attributes,
      classList: {
        remove(name) { classes.delete(name); },
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      },
      inert: false,
      hidden: false,
      removeAttribute(name) { attributes.delete(name); },
      setAttribute(name, value) { attributes.set(name, value); },
    };
  }
  function synchronize(open, mobile) {
    const navToggle = makeElement();
    const sidebar = makeElement();
    const sidebarClose = makeElement();
    const backdrop = makeElement();
    const backgroundShell = Array.from({ length: 4 }, makeElement);
    const document = {
      body: makeElement(),
      querySelector(selector) {return backgroundShell[selector === '.skip-link' ? 0 : 3];},
      getElementById(id) {return backgroundShell[id === 'main-header' ? 1 : 2];},
    };
    const sync = new Function(
      'navToggle', 'sidebar', 'sidebarClose', 'backdrop', 'mobileNavigation', 'mobileNavigationOpen', 'document', 'backgroundShell',
      `${sidebarSyncSource[0]}\nsyncSidebarMode();`,
    );
    sync(navToggle, sidebar, sidebarClose, backdrop, { matches: mobile }, open, document, backgroundShell);
    return { navToggle, sidebar, sidebarClose, backdrop, backgroundShell };
  }

  const opened = synchronize(true, true);
  assert.equal(opened.sidebar.inert, false);
  assert.equal(opened.backdrop.hidden, false);
  assert.equal(opened.sidebar.attributes.get('role'), 'dialog');
  assert.equal(opened.sidebar.attributes.get('aria-modal'), 'true');
  assert.deepEqual(opened.backgroundShell.map((element) => element.inert), [true, true, true, true]);

  const closed = synchronize(false, true);
  assert.equal(closed.sidebar.inert, true);
  assert.equal(closed.backdrop.hidden, true);
  assert.equal(closed.sidebar.attributes.has('aria-modal'), false);
  assert.deepEqual(closed.backgroundShell.map((element) => element.inert), [false, false, false, false]);

  const desktop = synchronize(true, false);
  assert.equal(desktop.sidebar.inert, false);
  assert.deepEqual(desktop.backgroundShell.map((element) => element.inert), [false, false, false, false]);
  assert.doesNotMatch(header, /class="logo" aria-label=/);
  assert.match(header, /id="gui-brand-label"/);
});

test('mobile drawer traps Tab and Shift+Tab and keeps its close control reachable', () => {
  const document = { activeElement: null };
  const makeFocusElement = () => ({
    closest() { return null; },
    focus() { document.activeElement = this; },
    matches() { return false; },
  });
  const sidebarClose = makeFocusElement();
  const firstLink = makeFocusElement();
  const lastLink = makeFocusElement();
  const inside = new Set([sidebarClose, firstLink, lastLink]);
  const sidebar = {
    contains(element) { return inside.has(element); },
    querySelectorAll() { return [sidebarClose, firstLink, lastLink]; },
  };
  const trap = new Function(
    'mobileNavigationOpen', 'sidebar', 'sidebarClose', 'document',
    `${sidebarTabTrapSource[0]}\nreturn trapMobileNavigationTab;`,
  )(true, sidebar, sidebarClose, document);
  const makeEvent = (shiftKey = false) => ({
    key: 'Tab',
    shiftKey,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  });

  document.activeElement = lastLink;
  const forwardFromLast = makeEvent();
  trap(forwardFromLast);
  assert.equal(forwardFromLast.defaultPrevented, true);
  assert.equal(document.activeElement, sidebarClose);

  const backwardFromFirst = makeEvent(true);
  trap(backwardFromFirst);
  assert.equal(backwardFromFirst.defaultPrevented, true);
  assert.equal(document.activeElement, lastLink);

  document.activeElement = {};
  const forwardFromOutside = makeEvent();
  trap(forwardFromOutside);
  assert.equal(forwardFromOutside.defaultPrevented, true);
  assert.equal(document.activeElement, sidebarClose);
});

test('runtime brand updates the logo text without a stale accessible-name override', async () => {
  const label = { textContent: 'System GUI' };
  const product = { textContent: 'System GUI' };
  const icon = { textContent: '◆' };
  const image = { hidden: true, onerror: null, src: '' };
  const document = {
    title: 'Dashboard | System GUI',
    getElementById(id) {
      return {
        'gui-brand-label': label,
        'gui-brand-icon': icon,
        'gui-brand-image': image,
      }[id] ?? null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-gui-brand-label]') return [label];
      if (selector === '[data-gui-brand-product]') return [product];
      return [];
    },
  };
  const fetch = async (path, options) => {
    assert.equal(path, '/api/gui/brand');
    assert.equal(options.cache, 'no-store');
    return {
      ok: true,
      async json() {
        return {
          schema: 'ellmos-system-gui.brand.v1',
          label: 'Ozean GUI',
          product: 'Ozean',
          logo_text: '🌊',
        };
      },
    };
  };
  const localStorage = { getItem: () => 'light' };
  const applyTheme = () => assert.fail('a saved theme must be preserved');
  const refreshGuiBrand = new Function(
    'fetch', 'document', 'localStorage', 'applyTheme',
    `${brandRefreshSource[0]}\nreturn refreshGuiBrand;`,
  )(fetch, document, localStorage, applyTheme);

  await refreshGuiBrand();

  const logoOpeningTag = header.match(/<a href="\/" class="logo"[^>]*>/)?.[0];
  assert.ok(logoOpeningTag);
  assert.doesNotMatch(logoOpeningTag, /aria-label=/);
  assert.equal(label.textContent, 'Ozean GUI');
  assert.equal(product.textContent, 'Ozean');
  assert.equal(icon.textContent, '🌊');
  assert.equal(document.title, 'Dashboard | Ozean');
  assert.match(header, /<a href="\/" class="logo">/);
});

test('shell redesign keeps device auth, saved themes, branding and backend-origin checks', () => {
  assert.match(layout, /src="\/device-fetch\.js"/);
  assert.match(layout, /currentSearch=\{Astro\.url\.search\}/);
  assert.match(layout, /id="main-content" tabindex="-1"/);
  assert.match(header, /localStorage\.getItem\('bach-theme'\)/);
  assert.match(header, /localStorage\.setItem\('bach-theme', theme\)/);
  assert.match(header, /fetch\('\/api\/gui\/brand'/);
  assert.match(header, /fetch\('\/api\/gui\/backend-origin'/);
  assert.match(header, /Backend unbekannt/);
});
