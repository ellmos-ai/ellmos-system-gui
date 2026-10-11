// Static scan: which '/api/' literals can each page reach through its import graph?
// Used by tests/page-reads.test.mjs (guard) and scripts/release-manifest.mjs (receipt); it executes no GUI code.
import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {analyzeCalls, apiLiterals} from './page-reads-lex.mjs';
import {HELPERS, PASSTHROUGH_FILES} from './page-reads-helpers.mjs';

const IMPORT_RE = /(?:\bimport\s*(?:[^'"`;]*?\bfrom\s*)?|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;
const EXPORT_RE = /\bexport\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])(\.{1,2}\/[^'"]+)\1/g;
const SCRIPT_SRC_RE = /<script\b[^>]*?\bsrc\s*=\s*(['"])([^'"]+)\1/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(?!['"`])/;
const API_RE =/(['"`])(\/api\/[^'"`\s]*)\1|(`)(\/api\/[^`\s]*)`/g;
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

// opts.helpers / opts.passthrough let fixtures run the guard against their own helper table.
export function scan(rootArg, opts = {}) {
  const root = resolve(rootArg);
  const helpers = opts.helpers ?? HELPERS, passthrough = opts.passthrough ?? PASSTHROUGH_FILES;
  const files = walk(join(root, 'src'));
  // public/*.js scripts are loaded by the layout, not imported: they count as layout code.
  const publicFiles = existsSync(join(root, 'public')) ? walk(join(root, 'public')) : [];
  const info = new Map(), publicLayout = new Set();
  const rel = file => relative(root, file).replaceAll('\\', '/');
  const callProblems = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    // edges: import ... from, import(), export ... from (barrels) and local <script src>; an edge the guard cannot
    // resolve, an external script or a computed import() fails the guard instead of hiding calls
    const imports = [];
    for (const m of [...text.matchAll(IMPORT_RE), ...text.matchAll(EXPORT_RE), ...text.matchAll(SCRIPT_SRC_RE)]) {
      const spec = m[2];
      if (/^https?:|^\/\//.test(spec)) { callProblems.push(`${rel(file)}: external script ${spec} cannot be checked`); continue; }
      if (spec.startsWith('/')) continue; // served from public/, scanned as layout code
      const target = resolveImport(file, spec);
      if (target) imports.push(target); else callProblems.push(`${rel(file)}: cannot resolve local import ${spec}`);
    }
    if (DYNAMIC_IMPORT_RE.test(text)) callProblems.push(`${rel(file)}: import() with a computed specifier cannot be followed`);
    const literals = [];
    if (file.endsWith('.astro')) { // markup is scanned as text (links, forms); script code below as tokens
      text.split('\n').forEach((line, index) => {
        for (const m of line.matchAll(API_RE)) literals.push({line: index + 1, pattern: normalizePattern(m[2] ?? m[4])});
      });
    } else for (const l of apiLiterals(text)) literals.push({line: l.line, pattern: normalizePattern(l.raw)}); // comments are no reads
    const analysis = analyzeCalls(rel(file), text, helpers, passthrough);
    callProblems.push(...analysis.problems);
    info.set(file, {imports, literals, calls: analysis.calls, functions: analysis.functions});
  }
  for (const file of publicFiles) {
    const text = readFileSync(file, 'utf8');
    const analysis = analyzeCalls(rel(file), text, helpers, passthrough);
    callProblems.push(...analysis.problems);
    // public scripts are checked by their call sites only
    info.set(file, {imports: [], literals: [], calls: analysis.calls, functions: analysis.functions});
    publicLayout.add(file);
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
  const layoutFiles = new Set(publicLayout);
  for (const file of files) if (file.includes(join('src', 'layouts'))) reach(file).forEach(f => layoutFiles.add(f));
  const callsOf = set => [...set].flatMap(file => info.get(file).calls);
  const functions = {};
  for (const [file, data] of info) functions[rel(file)] = [...data.functions];
  const pages = {}, calls = {};
  for (const file of files) {
    if (!file.includes(join('src', 'pages'))) continue;
    const own = new Set([...reach(file)].filter(f => !layoutFiles.has(f)));
    pages[pageRoute(root, file)] = collect(own);
    calls[pageRoute(root, file)] = callsOf(own);
  }
  return {layout: collect(layoutFiles), pages, calls: {layout: callsOf(layoutFiles), pages: calls}, callProblems: [...new Set(callProblems)], functions};
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const root = resolve(process.argv[2] ?? '.');
  const result = scan(root);
  console.log(JSON.stringify(result, null, 1));
}
