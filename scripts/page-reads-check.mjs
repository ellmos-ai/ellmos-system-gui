// Guard: binds public/page-reads.v1.json to the code in src/ (see docs/CONSUMER_CONTRACT.md, "Seiten-Lesepfade").
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {scan, normalizePattern} from './page-reads-scan.mjs';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const norm = path => normalizePattern(path);
const head = path => path.split('{')[0];
const tail = path => path.includes('{') ? path.slice(path.lastIndexOf('}') + 1) : '';

// A scanned literal covers a manifest path when equal, or when it is the static head of a concatenated path
// ('/api/x/' + id + '/source' is scanned as '/api/x/{}') and the entry says so with dynamic: true.
export function covers(literal, entry) {
  const path = norm(entry.path);
  if (literal === path) return true;
  return entry.dynamic === true && literal.endsWith('{}') && path.startsWith(literal.slice(0, -2));
}

export function explicitMethod(lines, line) {
  const window = lines.slice(line - 1, line + 2).join(' ');
  const m = window.match(/method\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/);
  return m ? m[1] : null;
}

// manifest: parsed JSON. found: result of scan(). read: (relative path) => text.
export function checkManifest(manifest, found, read) {
  const problems = [];
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
      if (seen.has(id)) problems.push(`${id}: duplicate`);
      seen.add(id);
      if (entry?.dynamic === true) {
        const [file, via] = String(entry.found_in ?? '').split('#');
        let text = null;
        try { text = file ? read(file) : null; } catch { /* reported below */ }
        if (text === null) problems.push(`${id}: dynamic entry needs found_in "file#function" with an existing file`);
        else {
          if (!text.includes(head(entry.path))) problems.push(`${id}: ${file} does not contain ${head(entry.path)}`);
          if (tail(entry.path) && !text.includes(tail(entry.path))) problems.push(`${id}: ${file} does not contain ${tail(entry.path)}`);
          if (via && !text.includes(via)) problems.push(`${id}: ${file} does not contain ${via}`);
        }
      } else if (entry?.dynamic !== undefined || entry?.found_in !== undefined) problems.push(`${id}: found_in only with dynamic: true`);
    }
  }

  // Which pages reach which literal (file+line): needed to allow shared client modules.
  const reachers = new Map();
  const note = (page, literal) => {
    const key = `${literal.file}:${literal.line}:${literal.pattern}`;
    if (!reachers.has(key)) reachers.set(key, {literal, pages: new Set()});
    reachers.get(key).pages.add(page);
  };
  for (const [page, literals] of Object.entries(found.pages)) for (const l of literals) note(page, l);
  for (const l of found.layout) note('layout', l);
  const entriesOf = page => (page === 'layout' ? manifest.layout : manifest.pages[page]) ?? [];

  // (1) every scanned literal is declared by some page that reaches it; a page-private literal by that page.
  const textCache = new Map();
  const lines = file => textCache.get(file) ?? (textCache.set(file, read(file).split('\n')), textCache.get(file));
  for (const {literal, pages} of reachers.values()) {
    const owners = [...pages].filter(p => entriesOf(p).some(e => covers(literal.pattern, e)));
    if (!owners.length) problems.push(`undeclared read ${literal.pattern} at ${literal.file}:${literal.line} (reached by ${[...pages].join(', ')})`);
    // (3) a method stated at the call site must be declared on the covering entry
    const method = explicitMethod(lines(literal.file), literal.line);
    if (method && owners.length && !owners.some(p => entriesOf(p).some(e => covers(literal.pattern, e) && e.method === method)))
      problems.push(`method ${method} at ${literal.file}:${literal.line} (${literal.pattern}) is not declared`);
  }
  // (2) every entry is backed by a reachable literal (no dead or over-declared entries)
  for (const [where, list] of lists) {
    const literals = where === 'layout' ? found.layout : (found.pages[where] ?? []);
    for (const entry of Array.isArray(list) ? list : [])
      if (typeof entry?.path === 'string' && !literals.some(l => covers(l.pattern, entry)))
        problems.push(`dead entry ${where}: ${entry.method} ${entry.path} (no matching call in the files this page reaches)`);
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
