// GUI walkthrough (BACH task 2496, stage 1, no LLM): opens every page listed in public/page-reads.v1.json against a running
// build (default: `npx astro preview`, http://127.0.0.1:4321) with Playwright and records per page the HTTP status, console
// errors, uncaught page errors, dead internal links, pages nobody links to, horizontal overflow on the phone viewport and a
// screenshot per viewport x colour scheme. Output: reports/gui-walkthrough/<timestamp>/report.json + screenshots/*.png.
// Usage: node scripts/gui-walkthrough.mjs [--base http://127.0.0.1:4321] [--out reports/gui-walkthrough] [--only /tasks,/memory] [--no-fail]
// Failed calls to /api/ are reported separately (backendErrors): without a connected backend they are expected and do not fail the run.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

export const REPORT_SCHEMA = 'ellmos.gui.walkthrough.v1';
export const MANIFEST_SCHEMA = 'ellmos.gui.page-reads.v1';
// The GUI ignores prefers-color-scheme: BachLayout.astro reads localStorage "bach-theme" (default "dark"; "light", "ocean", ...).
// So each variant sets both the media feature and the stored theme; without the latter light and dark shots are identical.
export const THEME_KEY = 'bach-theme';
export const VARIANTS = [
  {name: 'desktop-light', width: 1440, height: 900, colorScheme: 'light', theme: 'light'},
  {name: 'desktop-dark', width: 1440, height: 900, colorScheme: 'dark', theme: 'dark'},
  {name: 'mobile-light', width: 390, height: 844, colorScheme: 'light', theme: 'light'},
  {name: 'mobile-dark', width: 390, height: 844, colorScheme: 'dark', theme: 'dark'}
];
const MAX_LISTED = 20;

// Page paths of the manifest, in manifest order.
export function loadPageList(manifest) {
  if (manifest?.schema !== MANIFEST_SCHEMA || typeof manifest.pages !== 'object' || manifest.pages === null || Array.isArray(manifest.pages))
    throw new Error(`page list: expected schema ${MANIFEST_SCHEMA} with a pages object`);
  return Object.keys(manifest.pages).map(path => {
    if (!path.startsWith('/')) throw new Error(`page list: path must start with "/": ${path}`);
    return {path, slug: slugFor(path)};
  });
}

export function selectPages(list, only) {
  if (list.length === 0) throw new Error('page list: no pages to visit');
  if (only === undefined) return list;
  if (!Array.isArray(only) || only.length === 0) throw new Error('--only must select at least one known page');
  const known = new Set(list.map(page => page.path));
  for (const path of only)
    if (!known.has(path)) throw new Error(`--only contains an unknown page: ${path}`);
  const selected = new Set(only);
  return list.filter(page => selected.has(page.path));
}

export const slugFor = path => (path === '/' ? 'index' : path.replace(/^\/+|\/+$/g, '').replace(/\//g, '_'));

// '/tasks.html', '/tasks/', '/governance/index.html' -> '/tasks', '/tasks', '/governance'
export function normalizePagePath(pathname) {
  const path = pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

// href: raw attribute value, resolved: anchor.href (absolute). -> {kind: 'skip' | 'external' | 'internal', url?}
export function classifyLink(href, resolved, base) {
  const raw = (href ?? '').trim();
  if (raw === '' || raw.startsWith('#')) return {kind: 'skip'};
  let url;
  try { url = new URL(resolved); } catch { return {kind: 'skip'}; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return {kind: 'skip'};
  if (url.origin !== new URL(base).origin) return {kind: 'external', url: url.href};
  return {kind: 'internal', url: url.origin + url.pathname + url.search};
}

// pages: [{path, status, variants:[{consoleErrors, pageErrors, backendErrors, horizontalOverflow}], internalLinks:[url]}]
// links: [{url, status, error?, foundOn:[path]}]
export function summarize(pages, links, base) {
  const origin = new URL(base).origin;
  const known = new Set(pages.map(p => p.path));
  const linkedFrom = new Map(pages.map(p => [p.path, new Set()]));
  for (const link of links)
    for (const from of link.foundOn) {
      const target = normalizePagePath(new URL(link.url).pathname);
      if (target !== from && linkedFrom.has(target)) linkedFrom.get(target).add(from);
    }
  const count = key => pages.reduce((n, p) => n + p.variants.reduce((m, v) => m + (v[key]?.length ?? 0), 0), 0);
  const badStatus = status => !Number.isInteger(status) || status < 200 || status >= 400;
  const httpErrors = pages.filter(p => badStatus(p.status) || p.variants.some(v => badStatus(v.status))).map(p => p.path);
  const variantErrors = [];
  const expected = new Set(VARIANTS.map(v => v.name));
  for (const page of pages) {
    for (const name of expected) {
      const matches = page.variants.filter(v => v.variant === name);
      if (matches.length !== 1) variantErrors.push({path: page.path, variant: name, reason: matches.length ? 'duplicate variant' : 'missing variant'});
    }
    for (const variant of page.variants) {
      if (!expected.has(variant.variant)) variantErrors.push({path: page.path, variant: variant.variant, reason: 'unknown variant'});
      if (variant.error) variantErrors.push({path: page.path, variant: variant.variant, reason: variant.error});
      if (!variant.screenshot) variantErrors.push({path: page.path, variant: variant.variant, reason: 'missing screenshot'});
    }
  }
  const deadLinks = links.filter(l => l.error || l.status === null || l.status >= 400).map(l => ({url: l.url, status: l.status, foundOn: l.foundOn}));
  const unlisted = [...new Set(links.filter(l => l.url.startsWith(origin) && !l.url.startsWith(origin + '/api/'))
    .map(l => normalizePagePath(new URL(l.url).pathname)).filter(p => !known.has(p)))].sort();
  const summary = {
    pages: pages.length,
    httpErrors,
    variantErrors,
    consoleErrors: count('consoleErrors'),
    pageErrors: count('pageErrors'),
    backendErrors: count('backendErrors'),
    deadLinks,
    orphans: pages.filter(p => p.path !== '/' && linkedFrom.get(p.path).size === 0).map(p => p.path),
    unlistedInternalTargets: unlisted,
    horizontalOverflow: pages.flatMap(p => p.variants.filter(v => v.horizontalOverflow).map(v => `${p.path} (${v.variant})`)),
    screenshots: pages.reduce((n, p) => n + p.variants.filter(v => v.screenshot).length, 0)
  };
  summary.ok = summary.pages > 0 && summary.variantErrors.length + summary.httpErrors.length + summary.consoleErrors + summary.pageErrors + summary.deadLinks.length === 0;
  return summary;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const isBackend = url => { try { return new URL(url).pathname.startsWith('/api/'); } catch { return false; } };
const trim = list => list.slice(0, MAX_LISTED);

async function visit(context, base, page, variant, outDir, harvest) {
  const consoleErrors = [], pageErrors = [], backendErrors = [];
  const tab = await context.newPage();
  tab.on('console', msg => {
    if (msg.type() !== 'error') return;
    const where = msg.location()?.url ?? '';
    (isBackend(where) ? backendErrors : consoleErrors).push(isBackend(where) ? {url: where, text: msg.text()} : msg.text());
  });
  tab.on('pageerror', error => pageErrors.push(String(error?.message ?? error)));
  const record = {variant: variant.name, status: null, consoleErrors, pageErrors, backendErrors, horizontalOverflow: false, screenshot: null};
  let anchors = [];
  try {
    const response = await tab.goto(base + page.path, {waitUntil: 'networkidle', timeout: 30000});
    record.status = response?.status() ?? null;
    record.horizontalOverflow = await tab.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const file = `${page.slug}-${variant.name}.png`;
    await tab.screenshot({path: join(outDir, 'screenshots', file), fullPage: true});
    record.screenshot = `screenshots/${file}`;
    if (harvest) anchors = await tab.$$eval('a[href]', list => list.map(a => ({href: a.getAttribute('href'), resolved: a.href})));
  } catch (error) {
    record.error = String(error?.message ?? error).split('\n')[0];
  } finally {
    await tab.close();
  }
  record.consoleErrors = trim(consoleErrors);
  record.pageErrors = trim(pageErrors);
  record.backendErrors = trim(backendErrors);
  return {record, anchors};
}

export async function walkthrough({base, outRoot, only, manifestPath}) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const list = selectPages(loadPageList(manifest), only);
  const {chromium} = await import('playwright-core');
  const outDir = join(outRoot, stamp());
  mkdirSync(join(outDir, 'screenshots'), {recursive: true});
  const browser = await chromium.launch();
  const pages = list.map(p => ({...p, url: base + p.path, status: null, variants: [], internalLinks: []}));
  const linkFound = new Map(); // url -> Set(page path)
  const links = [];
  let external = 0;
  try {
    for (const [index, variant] of VARIANTS.entries()) {
      const context = await browser.newContext({viewport: {width: variant.width, height: variant.height}, colorScheme: variant.colorScheme});
      await context.addInitScript(([key, theme]) => { try { localStorage.setItem(key, theme); } catch { /* storage blocked */ } }, [THEME_KEY, variant.theme]);
      for (const page of pages) {
        const {record, anchors} = await visit(context, base, page, variant, outDir, index === 0);
        if (index === 0) page.status = record.status;
        page.variants.push(record);
        for (const anchor of anchors) {
          const link = classifyLink(anchor.href, anchor.resolved, base);
          if (link.kind === 'external') external += 1;
          if (link.kind !== 'internal') continue;
          if (!linkFound.has(link.url)) linkFound.set(link.url, new Set());
          linkFound.get(link.url).add(page.path);
          if (!page.internalLinks.includes(link.url)) page.internalLinks.push(link.url);
        }
      }
      if (index === 0) {
        // dead-link check: each distinct internal target once, with the desktop context's request client
        for (const [url] of linkFound) {
          let status = null, error;
          try { status = (await context.request.get(url, {failOnStatusCode: false, maxRedirects: 5, timeout: 15000})).status(); }
          catch (e) { error = String(e?.message ?? e).split('\n')[0]; }
          links.push({url, status, ...(error ? {error} : {}), foundOn: [...linkFound.get(url)]});
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  const summary = summarize(pages, links, base);
  const report = {
    schema: REPORT_SCHEMA, generatedAt: new Date().toISOString(), base, variants: VARIANTS, externalLinksNotChecked: external,
    summary,
    pages: pages.map(({path, slug, url, status, variants, internalLinks}) => ({path, slug, url, status, internalLinkCount: internalLinks.length, variants})),
    links
  };
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return {outDir, summary};
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const {values} = parseArgs({options: {
    base: {type: 'string', default: 'http://127.0.0.1:4321'},
    out: {type: 'string', default: join(root, 'reports', 'gui-walkthrough')},
    only: {type: 'string'},
    'no-fail': {type: 'boolean', default: false}
  }});
  const base = values.base.replace(/\/+$/, '');
  const {outDir, summary} = await walkthrough({
    base, outRoot: resolve(values.out), only: values.only?.split(',').map(s => s.trim()).filter(Boolean),
    manifestPath: join(root, 'public', 'page-reads.v1.json')
  });
  const line = (label, value) => console.log(`${label.padEnd(24)}${value}`);
  line('report', join(outDir, 'report.json'));
  line('pages', summary.pages);
  line('http errors', summary.httpErrors.length ? summary.httpErrors.join(', ') : 0);
  line('variant errors', summary.variantErrors.length);
  for (const error of summary.variantErrors.slice(0, MAX_LISTED))
    console.log(`  ${error.path} (${error.variant}): ${error.reason}`);
  line('console errors', summary.consoleErrors);
  line('page errors', summary.pageErrors);
  line('backend errors (/api)', summary.backendErrors);
  line('dead internal links', summary.deadLinks.length);
  for (const dead of summary.deadLinks)
    console.log(`  ${dead.status ?? 'ERR'} ${dead.url} <- ${dead.foundOn.slice(0, 3).join(', ')}${dead.foundOn.length > 3 ? ` (+${dead.foundOn.length - 3} more)` : ''}`);
  line('orphan pages', summary.orphans.length ? summary.orphans.join(', ') : 0);
  line('horizontal overflow', summary.horizontalOverflow.length);
  line('screenshots', summary.screenshots);
  line('result', summary.ok ? 'OK' : 'PROBLEMS');
  if (!summary.ok && !values['no-fail']) process.exitCode = 1;
}
