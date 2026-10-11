// Guard: binds public/page-reads.v1.json to the CALL SITES in src/ and public/ (see docs/CONSUMER_CONTRACT.md, "Seiten-Lesepfade").
// Every call of fetch or of a registered fetch helper is evaluated for its own URL and method (scripts/page-reads-lex.mjs):
//  L  literal path        -> needs a static entry with the same method and path
//  T  composed path       -> needs a dynamic entry whose found_in is "file#function" of THAT call and whose path equals the composed pattern
//  U  unresolved call site (opaque URL such as a map or variable, open-ended path, or unknown method)
//     -> not decided by the code alone: its ID "file#function@n" must be bound in scripts/page-reads-bindings.mjs to an explicit
//        list of "METHOD path" alternatives; each alternative needs a dynamic entry with found_in "file#function"
//        (and, for opaque URLs, its path as a literal in reachable code). A new unresolved call site is red until bound.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {scan, normalizePattern} from './page-reads-scan.mjs';
import {BINDINGS} from './page-reads-bindings.mjs';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const norm = path => normalizePattern(path);

// A scanned literal covers a manifest path when equal, or when it is the static head of a concatenated path
// ('/api/x/' + id + '/source' is scanned as '/api/x/{}') and the entry says so with dynamic: true.
export function covers(literal, entry) {
  const path = norm(entry.path);
  if (literal === path) return true;
  return entry.dynamic === true && path.startsWith(literal.endsWith('{}') ? literal.slice(0, -2) : literal);
}

export const callId = call => `${call.file}#${call.fn}`;
const label = call => `${call.method ?? '?'} ${call.pattern} at ${call.file}:${call.line} in ${call.fn}`;

// manifest: parsed JSON. found: result of scan(). read: (relative path) => text.
export function checkManifest(manifest, found, read, bindings = BINDINGS) {
  const problems = [...(found.callProblems ?? [])];
  if (manifest?.schema !== 'ellmos.gui.page-reads.v1') return ['schema: not ellmos.gui.page-reads.v1'];
  const pageNames = Object.keys(found.pages).sort();
  const declared = Object.keys(manifest.pages ?? {}).sort();
  for (const p of pageNames) if (!declared.includes(p)) problems.push(`page ${p}: no manifest entry (a page without reads declares an empty list)`);
  for (const p of declared) if (!pageNames.includes(p)) problems.push(`page ${p}: in manifest, but no such page in src/pages`);

  const lists = [['layout', manifest.layout ?? []], ...declared.map(p => [p, manifest.pages[p]])];
  for (const [where, list] of lists) {
    if (!Array.isArray(list)) { problems.push(`${where}: entries must be a list`); continue; }
    const seen = new Set();
    for (const entry of list) {
      const id = `${where}: ${entry?.method} ${entry?.path}`;
      if (!METHODS.has(entry?.method)) problems.push(`${id}: invalid method`);
      if (typeof entry?.path !== 'string' || !entry.path.startsWith('/api/')) problems.push(`${id}: path must start with /api/`);
      if (typeof entry?.required !== 'boolean') problems.push(`${id}: required must be boolean`);
      if (where === 'layout' && entry?.required === true) problems.push(`${id}: layout reads must be optional`);
      const key = `${id}#${entry?.dynamic === true ? entry.found_in : ''}`; // the same read may be made by several functions
      if (seen.has(key)) problems.push(`${id}: duplicate`);
      seen.add(key);
      if (entry?.dynamic === true) {
        const [file, fn] = String(entry.found_in ?? '').split('#');
        let ok = false;
        try { read(file); ok = !!fn && (fn === '(module)' || (found.functions?.[file] ?? []).includes(fn)); } catch { /* reported below */ }
        if (!ok) problems.push(`${id}: dynamic entry needs found_in "file#function" naming an existing function of an existing file`);
      } else if (entry?.dynamic !== undefined || entry?.found_in !== undefined) problems.push(`${id}: found_in only with dynamic: true`);
    }
  }

  const callsOf = page => (page === 'layout' ? found.calls?.layout : found.calls?.pages?.[page]) ?? [];
  const literalsOf = page => (page === 'layout' ? found.layout : found.pages[page]) ?? [];
  const entriesOf = page => (page === 'layout' ? manifest.layout : manifest.pages[page]) ?? [];
  const anchored = (page, entry) => literalsOf(page).some(l => covers(l.pattern, entry));

  // Does this entry declare this call? (page = the page whose list the entry belongs to)
  const declares = (page, entry, call) => {
    if (typeof entry?.path !== 'string') return false;
    if (call.kind === 'L' && call.id === undefined) return entry.dynamic !== true && entry.method === call.method && norm(entry.path) === call.pattern;
    if (entry.dynamic !== true || entry.found_in !== callId(call)) return false;
    if (call.method !== null && entry.method !== call.method) return false;
    if (call.kind === 'T' && !call.open && norm(entry.path) !== call.pattern) return false;
    if (call.id === undefined) return true;
    // unresolved site: only the explicitly bound alternatives may declare it
    if (!(bindings[call.id] ?? []).some(alt => altKey(alt) === `${entry.method} ${norm(entry.path)}`)) return false;
    if (call.kind === 'T') return norm(entry.path).startsWith(call.head);
    return call.kind === 'L' || anchored(page, entry);
  };
  const altKey = alt => { const [method, ...rest] = String(alt).split(' '); return `${method} ${norm(rest.join(' '))}`; };

  // (1) every call site is declared by a page that reaches it
  const reachers = new Map();
  const note = (page, key, item) => { if (!reachers.has(key)) reachers.set(key, {item, pages: new Set()}); reachers.get(key).pages.add(page); };
  for (const page of ['layout', ...pageNames]) {
    for (const call of callsOf(page)) note(page, call.id !== undefined ? `${call.id}:${call.method}:${call.pattern}` : `${callId(call)}:${call.line}:${call.method}:${call.pattern}`, call);
    for (const l of literalsOf(page)) note(page, `lit:${l.file}:${l.line}:${l.pattern}`, {literal: l});
  }
  for (const {item, pages} of reachers.values()) {
    if (item.literal) {
      const l = item.literal;
      if (![...pages].some(p => entriesOf(p).some(e => covers(l.pattern, e))))
        problems.push(`undeclared read ${l.pattern} at ${l.file}:${l.line} (reached by ${[...pages].join(', ')})`);
      continue;
    }
    const call = item;
    if (call.id !== undefined && !bindings[call.id]) {
      problems.push(`unbound call site ${call.id} (${label(call)}): its URL or method is not decided by the code - bind explicit alternatives in scripts/page-reads-bindings.mjs`);
      continue;
    }
    if ([...pages].some(p => entriesOf(p).some(e => declares(p, e, call)))) continue;
    const samePath = [...pages].flatMap(p => entriesOf(p)).find(e => typeof e?.path === 'string' && norm(e.path) === call.pattern && e.method !== call.method);
    problems.push(samePath
      ? `method ${call.method} at ${call.file}:${call.line} (${call.pattern}) is not declared; the manifest says ${samePath.method}`
      : `undeclared read ${label(call)} [${call.kind === 'L' ? 'literal path: needs a static entry' : `composed path: needs a dynamic entry with found_in ${callId(call)}`}] (reached by ${[...pages].join(', ')})`);
  }

  // (1b) bindings: every bound site exists, and every alternative has a manifest entry on a page that reaches the site
  const sites = new Map();
  for (const page of ['layout', ...pageNames]) for (const call of callsOf(page)) if (call.id !== undefined) {
    if (!sites.has(call.id)) sites.set(call.id, []);
    sites.get(call.id).push({page, call});
  }
  for (const [id, alternatives] of Object.entries(bindings)) {
    if (!sites.has(id)) { problems.push(`stale binding ${id}: no such unresolved call site in the code`); continue; }
    for (const alt of alternatives)
      if (!sites.get(id).some(({page, call}) => entriesOf(page).some(e => declares(page, e, call) && `${e.method} ${norm(e.path)}` === altKey(alt))))
        problems.push(`binding ${id}: alternative "${alt}" has no matching dynamic entry (found_in ${id.split('@')[0]}) on a page reaching the call site`);
  }

  // (2) every entry is backed by a call site that reaches its page (no dead or over-declared entries)
  for (const [where, list] of lists) {
    for (const entry of Array.isArray(list) ? list : [])
      if (typeof entry?.path === 'string' && !callsOf(where).some(call => declares(where, entry, call)))
        problems.push(`dead entry ${where}: ${entry.method} ${entry.path}${entry.dynamic ? ` (no call in ${entry.found_in} produces it)` : ' (no matching call in the files this page reaches)'}`);
  }
  return problems;
}

export function loadManifest(root) {
  return JSON.parse(readFileSync(resolve(root, 'public', 'page-reads.v1.json'), 'utf8'));
}

// JSON.parse keeps the last of two equal keys silently (a merge can duplicate a page block); consumers reject such a file.
export function duplicatePages(text) {
  const keys = [...text.matchAll(/^ {2}"(\/[^"]*)": \[/gm)].map(m => m[1]);
  return [...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))];
}

export function checkRoot(root) {
  const absolute = resolve(root);
  const duplicates = duplicatePages(readFileSync(resolve(absolute, 'public', 'page-reads.v1.json'), 'utf8')).map(page => `page ${page}: declared twice in the manifest file`);
  return [...duplicates, ...checkManifest(loadManifest(absolute), scan(absolute), file => readFileSync(resolve(absolute, file), 'utf8'))];
}
