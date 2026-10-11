// Guard: binds public/page-reads.v1.json to the CALL SITES in src/ and public/ (see docs/CONSUMER_CONTRACT.md, "Seiten-Lesepfade").
// Every call of fetch or of a registered fetch helper is evaluated for its own URL and method (scripts/page-reads-lex.mjs):
//  L  literal path        -> needs a static entry with the same method and path
//  T  composed path       -> needs a dynamic entry whose found_in is "file#function" of THAT call and whose path equals the composed pattern
//  O  opaque URL (map, variable) -> needs dynamic entries with found_in "file#function"; each path must occur as a literal in reachable code
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {scan, normalizePattern} from './page-reads-scan.mjs';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const norm = path => normalizePattern(path);

// A scanned literal covers a manifest path when equal, or when it is the static head of a concatenated path
// ('/api/x/' + id + '/source' is scanned as '/api/x/{}') and the entry says so with dynamic: true.
export function covers(literal, entry) {
  const path = norm(entry.path);
  if (literal === path) return true;
  return entry.dynamic === true && literal.endsWith('{}') && path.startsWith(literal.slice(0, -2));
}

export const callId = call => `${call.file}#${call.fn}`;
const label = call => `${call.method ?? '?'} ${call.pattern} at ${call.file}:${call.line} in ${call.fn}`;

// manifest: parsed JSON. found: result of scan(). read: (relative path) => text.
export function checkManifest(manifest, found, read) {
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
    if (call.kind === 'L') return entry.dynamic !== true && entry.method === call.method && norm(entry.path) === call.pattern;
    if (entry.dynamic !== true || entry.found_in !== callId(call)) return false;
    if (call.method !== null && entry.method !== call.method) return false;
    if (call.kind === 'T') return call.open ? norm(entry.path).startsWith(call.head) : norm(entry.path) === call.pattern;
    return anchored(page, entry);
  };

  // (1) every call site is declared by a page that reaches it
  const reachers = new Map();
  const note = (page, key, item) => { if (!reachers.has(key)) reachers.set(key, {item, pages: new Set()}); reachers.get(key).pages.add(page); };
  for (const page of ['layout', ...pageNames]) {
    for (const call of callsOf(page)) note(page, `${callId(call)}:${call.line}:${call.method}:${call.pattern}`, call);
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
    if ([...pages].some(p => entriesOf(p).some(e => declares(p, e, call)))) continue;
    const samePath = [...pages].flatMap(p => entriesOf(p)).find(e => typeof e?.path === 'string' && norm(e.path) === call.pattern && e.method !== call.method);
    problems.push(samePath
      ? `method ${call.method} at ${call.file}:${call.line} (${call.pattern}) is not declared; the manifest says ${samePath.method}`
      : `undeclared read ${label(call)} [${call.kind === 'L' ? 'literal path: needs a static entry' : `composed path: needs a dynamic entry with found_in ${callId(call)}`}] (reached by ${[...pages].join(', ')})`);
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

export function checkRoot(root) {
  const absolute = resolve(root);
  return checkManifest(loadManifest(absolute), scan(absolute), file => readFileSync(resolve(absolute, file), 'utf8'));
}
