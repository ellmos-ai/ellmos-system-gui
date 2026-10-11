// Static scan: which '/api/' literals can each page reach through its import graph?
// Used by tests/page-reads.test.mjs (guard) and scripts/release-manifest.mjs (receipt); it executes no GUI code.
import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';

const IMPORT_RE = /(?:\bimport\s*(?:[^'"`;]*?\bfrom\s*)?|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;
const API_RE = /(['"`])(\/api\/[^'"`\s]*)\1|(`)(\/api\/[^`\s]*)`/g;
const EXT = ['', '.mjs', '.js', '.astro', '.ts'];

export function normalizePattern(raw) {
  let value = raw.split('?')[0].replace(/\$\{[^}]*\}/g, '{}').replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '{}');
  if (value.endsWith('/') && value !== '/api/') value += '{}'; // '/api/x/' + id
  return value.replace(/\/+$/, '');
}

function walk(directory, out = []) {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(astro|mjs|js|ts)$/.test(entry.name)) out.push(path);
  }
  return out;
}

function resolveImport(from, spec) {
  const base = resolve(dirname(from), spec.split('?')[0]);
  for (const ext of EXT) if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
  return null;
}

export function pageRoute(root, file) {
  const rel = relative(join(root, 'src', 'pages'), file).replaceAll('\\', '/').replace(/\.astro$/, '');
  const route = '/' + rel.replace(/(^|\/)index$/, '');
  return route === '/' ? '/' : route.replace(/\/$/, '');
}

export function scan(rootArg) {
  const root = resolve(rootArg);
  const files = walk(join(root, 'src'));
  const info = new Map();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const imports = [...text.matchAll(IMPORT_RE)].map(m => resolveImport(file, m[2])).filter(Boolean);
    const literals = [];
    text.split('\n').forEach((line, index) => {
      for (const m of line.matchAll(API_RE)) literals.push({line: index + 1, pattern: normalizePattern(m[2] ?? m[4])});
    });
    info.set(file, {imports, literals});
  }
  const reach = start => {
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
      const file = stack.pop();
      if (seen.has(file) || !info.has(file)) continue;
      seen.add(file);
      stack.push(...info.get(file).imports);
    }
    return seen;
  };
  const collect = set => {
    const out = [];
    for (const file of set) for (const l of info.get(file).literals)
      out.push({file: relative(root, file).replaceAll('\\', '/'), line: l.line, pattern: l.pattern});
    return out;
  };
  const layoutFiles = new Set();
  for (const file of files) if (file.includes(join('src', 'layouts'))) reach(file).forEach(f => layoutFiles.add(f));
  const pages = {};
  for (const file of files) {
    if (!file.includes(join('src', 'pages'))) continue;
    const own = new Set([...reach(file)].filter(f => !layoutFiles.has(f)));
    pages[pageRoute(root, file)] = collect(own);
  }
  return {layout: collect(layoutFiles), pages};
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const root = resolve(process.argv[2] ?? '.');
  const result = scan(root);
  console.log(JSON.stringify(result, null, 1));
}
