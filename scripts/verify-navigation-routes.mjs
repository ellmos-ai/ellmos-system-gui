import {existsSync, readFileSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {commonRoutePaths, legacyFallbackRoutes, pathFromHref} from '../src/lib/navigation-route-inventory.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pagesRoot = join(root, 'src', 'pages');
const nav = JSON.parse(readFileSync(join(root, 'src', 'config', 'nav_config.json'), 'utf8'));
const header = readFileSync(join(root, 'src', 'components', 'Header.astro'), 'utf8');

function flatten(items) {
  return items.flatMap((item) => item.href ? [item.href] : flatten(item.children || []));
}

const configuredHrefs = Object.values(nav.presets).flatMap((preset) => [
  preset.home.href,
  ...preset.sections.flatMap((section) => flatten(section.items)),
]);
const headerOnlyHrefs = [...header.matchAll(/href="(\/kontakte)"/g)].map((match) => match[1]);
const inventoryHrefs = legacyFallbackRoutes.map((route) => route.path);
const routePaths = [...new Set([...configuredHrefs, ...headerOnlyHrefs, ...inventoryHrefs, ...commonRoutePaths].map(pathFromHref))];
const fallbackPaths = new Set(legacyFallbackRoutes.map((route) => route.path));
const commonPaths = new Set(commonRoutePaths);

function pagePath(routePath) {
  if (routePath === '/') return join(pagesRoot, 'index.astro');
  return join(pagesRoot, ...routePath.slice(1).split('/'), 'index.astro');
}

function flatPagePath(routePath) {
  return join(pagesRoot, `${routePath.slice(1)}.astro`);
}

function hasPage(routePath) {
  return existsSync(flatPagePath(routePath)) || existsSync(pagePath(routePath));
}

const missing = routePaths.filter((routePath) => !hasPage(routePath) && !fallbackPaths.has(routePath));
const undocumentedFallbacks = [...fallbackPaths].filter((routePath) => !hasPage(routePath));
const unresolvedCommonRoutes = [...commonPaths].filter((routePath) => !hasPage(routePath));

if (missing.length || undocumentedFallbacks.length || unresolvedCommonRoutes.length) {
  const details = [
    missing.length ? `navigation ohne gemeinsame Seite oder Fallback: ${missing.join(', ')}` : '',
    undocumentedFallbacks.length ? `Fallback ohne erzeugte Seite: ${undocumentedFallbacks.join(', ')}` : '',
    unresolvedCommonRoutes.length ? `gemeinsame Route ohne Seite: ${unresolvedCommonRoutes.join(', ')}` : '',
  ].filter(Boolean).join('; ');
  throw new Error(`Navigation route guard fehlgeschlagen: ${details}`);
}

const fallbackCount = routePaths.filter((routePath) => fallbackPaths.has(routePath)).length;
console.log(`Navigation route guard: ${configuredHrefs.length + headerOnlyHrefs.length} Einträge, ${routePaths.length} eindeutige Pfade, ${fallbackCount} sichtbare Fallback-Pfade, ${commonPaths.size} gemeinsame Kernroute(n).`);
console.log(`Geprüfte Quellen: ${routePaths.map((routePath) => relative(root, hasPage(routePath) ? (existsSync(flatPagePath(routePath)) ? flatPagePath(routePath) : pagePath(routePath)) : '')).filter(Boolean).join(', ')}`);
