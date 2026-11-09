// Build guard (PB-6, #3990, B-07). Astro scopes a page's <style> to elements the template rendered (attribute data-astro-cid-*).
// Elements a script creates (createElement, innerHTML) do not carry it, so scoped rules for their classes never apply:
// the /routinen rows lost their grid and fell apart. A class styled by a scoped <style> AND set by script is therefore an error;
// fix it with <style is:global> or :global(.class). Heuristic: the script side is read from className= and class="..." in the
// page's <script> blocks and in the local modules they import (one level). classList.* is ignored: it mostly touches
// template-rendered elements, which do carry the attribute. Modules that build elements through a helper (el(tag, className))
// are not seen; routines-ui.mjs is covered by tests/routines-style.test.mjs instead.
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Classes main.css already defines for every page: a page-level override of them is cosmetic, not a broken layout.
const GENERIC = new Set(['btn', 'badge', 'muted', 'active', 'hidden', 'empty']);
// Findings that predate PB-6 (T-20261106-101728788). They may only shrink: a fixed entry must be removed (checkTree reports it as stale).
// running.astro is left to the open agent-tile PR (gui#129), the other two to a follow-up so this change stays on /routinen.
export const KNOWN_TRAPS = {};

const literals = text => [...text.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(m => m[2]);
const words = text => text.split(/\s+/).filter(w => /^[A-Za-z_][\w-]*$/.test(w));

export function scopedClasses(source) {
  const found = new Set();
  for (const block of source.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)) {
    if (/\bis:global\b/.test(block[1])) continue;
    for (const head of block[2].matchAll(/([^{}]+)\{/g)) {
      const selector = head[1].replace(/:global\([^)]*\)/g, '');
      for (const m of selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) found.add(m[1]);
    }
  }
  return found;
}

export function dynamicClasses(script) {
  const found = new Set();
  const add = text => words(text).forEach(w => found.add(w));
  // classList.* is not read: it mostly touches template-rendered elements, which do carry the scope attribute
  for (const m of script.matchAll(/className\s*=([^;\n]*)/g)) literals(m[1]).forEach(add);
  for (const m of script.matchAll(/\bclass\s*=\s*\\?(["'])([^"'\\]*)\\?\1/g)) add(m[2].replace(/\$\{[^}]*\}/g, ' '));
  return found;
}

// source: text of an .astro file; read: optional (specifier) => text of a local module the page's scripts import.
export function findScopedStyleTraps(source, read = () => '') {
  const scripts = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const modules = scripts.flatMap(s => [...s.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map(m => read(m[1])));
  const dynamic = dynamicClasses([...scripts, ...modules].join('\n'));
  return [...scopedClasses(source)].filter(c => dynamic.has(c) && !GENERIC.has(c));
}

export function scanTree(root) {
  const traps = {};
  const walk = dir => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.astro') ? [path] : [];
  });
  for (const file of ['pages', 'components', 'layouts'].map(d => join(root, 'src', d)).filter(existsSync).flatMap(walk)) {
    const read = spec => {
      const target = resolve(dirname(file), spec);
      const hit = ['', '.mjs', '.js'].map(ext => target + ext).find(p => existsSync(p) && statSync(p).isFile());
      return hit ? readFileSync(hit, 'utf8') : '';
    };
    const found = findScopedStyleTraps(readFileSync(file, 'utf8'), read);
    if (found.length) traps[relative(root, file).replaceAll('\\', '/')] = found;
  }
  return traps;
}

// {unexpected: new traps, stale: KNOWN_TRAPS entries that are fixed or gone}
export function checkTree(root) {
  const found = scanTree(root), unexpected = {}, stale = [];
  for (const [file, classes] of Object.entries(found)) {
    const fresh = classes.filter(c => !(KNOWN_TRAPS[file] ?? []).includes(c));
    if (fresh.length) unexpected[file] = fresh;
  }
  for (const [file, classes] of Object.entries(KNOWN_TRAPS)) for (const c of classes) if (!(found[file] ?? []).includes(c)) stale.push(`${file}: ${c}`);
  return {unexpected, stale};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {unexpected, stale} = checkTree(resolve(process.argv[2] ?? '.'));
  for (const [file, classes] of Object.entries(unexpected)) console.error(`${file}: scoped <style> rule for script-made class ${classes.join(', ')} never applies; use <style is:global> or :global()`);
  for (const entry of stale) console.error(`KNOWN_TRAPS entry is fixed, remove it: ${entry}`);
  if (Object.keys(unexpected).length || stale.length) process.exit(1);
}
