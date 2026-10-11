// Minimal JavaScript lexer + call-site analysis for the page-reads guard (no dependencies, executes no GUI code).
// It finds every call of a fetch sink or a registered fetch helper and evaluates URL and method of THAT call.
import {readFileSync} from 'node:fs';

const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'in', 'of', 'instanceof', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const ID_RE = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
const NUM_RE = /(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)n?/y;
const PUNCT = ['...', '===', '!==', '**=', '=>', '?.', '??', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '**', '<<', '>>'];
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
export const SINKS = new Set(['fetch', 'fetcher', 'originalFetch']);
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);

// .astro: only frontmatter and <script> bodies are code; everything else is blanked (line numbers survive).
export function maskCode(text, file) {
  if (!file.endsWith('.astro')) return text;
  const out = text.replace(/[^\n]/g, ' ').split('');
  const copy = (start, end) => { for (let i = start; i < end; i++) out[i] = text[i]; };
  const front = text.match(/^---\r?\n/);
  if (front) {
    const close = text.indexOf('\n---', front[0].length - 1);
    if (close >= 0) copy(front[0].length, close);
  }
  for (const m of text.matchAll(/<script\b[^>]*>/g)) {
    const start = m.index + m[0].length;
    const end = text.indexOf('</script>', start);
    copy(start, end < 0 ? text.length : end);
  }
  return out.join('');
}

function readString(src, i) {
  const quote = src[i];
  let j = i + 1, value = '';
  while (j < src.length && src[j] !== quote && src[j] !== '\n') {
    if (src[j] === '\\') { const next = src[j + 1]; value += next === 'n' ? '\n' : next === 't' ? '\t' : next ?? ''; j += 2; } else value += src[j++];
  }
  return {value, end: j + 1};
}

function skipBraces(src, j) {
  let depth = 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") { j = readString(src, j).end; continue; }
    if (c === '`') { j = readTemplate(src, j).end; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j;
    j++;
  }
  return j;
}

function readTemplate(src, i) {
  const parts = [];
  let current = '', j = i + 1;
  while (j < src.length && src[j] !== '`') {
    if (src[j] === '\\') { current += src[j + 1] ?? ''; j += 2; }
    else if (src[j] === '$' && src[j + 1] === '{') {
      parts.push({s: current}); current = '';
      const end = skipBraces(src, j + 2);
      parts.push({e: src.slice(j + 2, end)});
      j = end + 1;
    } else current += src[j++];
  }
  parts.push({s: current});
  return {parts, end: j + 1};
}

export function tokenize(src) {
  const newlines = [];
  for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) newlines.push(i);
  const lineAt = pos => { let lo = 0, hi = newlines.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (newlines[mid] < pos) lo = mid + 1; else hi = mid; } return lo + 1; };
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    const line = lineAt(i), prev = toks[toks.length - 1];
    if (c === '"' || c === "'") { const r = readString(src, i); toks.push({t: 'str', v: r.value, line}); i = r.end; continue; }
    if (c === '`') { const r = readTemplate(src, i); toks.push({t: 'tpl', parts: r.parts, line}); i = r.end; continue; }
    if (c === '/') {
      const regexAllowed = !prev || (prev.t === 'p' && ![')', ']', '}'].includes(prev.v)) || (prev.t === 'id' && KEYWORDS_BEFORE_REGEX.has(prev.v));
      if (regexAllowed) {
        let j = i + 1, inClass = false;
        while (j < src.length && src[j] !== '\n' && (inClass || src[j] !== '/')) { if (src[j] === '\\') j++; else if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false; j++; }
        j++;
        while (/[a-z]/.test(src[j] ?? '')) j++;
        toks.push({t: 're', v: src.slice(i, j), line}); i = j; continue;
      }
    }
    ID_RE.lastIndex = i; const id = ID_RE.exec(src);
    if (id) { toks.push({t: 'id', v: id[0], line}); i += id[0].length; continue; }
    NUM_RE.lastIndex = i; const num = NUM_RE.exec(src);
    if (num && /[\d.]/.test(c)) { toks.push({t: 'num', v: num[0], line}); i += num[0].length; continue; }
    const punct = PUNCT.find(p => src.startsWith(p, i)) ?? c;
    toks.push({t: 'p', v: punct, line}); i += punct.length;
  }
  return toks;
}

const isOpen = t => t.t === 'p' && (t.v === '(' || t.v === '[' || t.v === '{');
const isClose = t => t.t === 'p' && (t.v === ')' || t.v === ']' || t.v === '}');

export function matchClose(toks, open) {
  let depth = 0;
  for (let k = open; k < toks.length; k++) {
    if (isOpen(toks[k])) depth++;
    else if (isClose(toks[k]) && --depth === 0) return k;
  }
  return toks.length - 1;
}

function matchOpen(toks, close) {
  let depth = 0;
  for (let k = close; k >= 0; k--) {
    if (isClose(toks[k])) depth++;
    else if (isOpen(toks[k]) && --depth === 0) return k;
  }
  return 0;
}

export function splitTop(toks, from, to, separator) {
  const parts = [];
  let depth = 0, start = from;
  for (let k = from; k < to; k++) {
    if (isOpen(toks[k])) depth++;
    else if (isClose(toks[k])) depth--;
    else if (depth === 0 && toks[k].t === 'p' && toks[k].v === separator) { parts.push(toks.slice(start, k)); start = k + 1; }
  }
  parts.push(toks.slice(start, to));
  return parts;
}

function expressionEnd(toks, from) {
  let depth = 0;
  for (let k = from; k < toks.length; k++) {
    const t = toks[k];
    if (isOpen(t)) depth++;
    else if (isClose(t)) { if (--depth < 0) return k; }
    else if (depth === 0 && t.t === 'p' && (t.v === ',' || t.v === ';')) return k;
  }
  return toks.length;
}

// Named function frames: which function body encloses each token, with its parameter names.
export function functionFrames(toks) {
  const bodies = new Map(), exprBodies = [];
  const paramsOf = open => {
    const close = matchClose(toks, open), names = [];
    let depth = 0;
    for (let k = open + 1; k < close; k++) {
      const t = toks[k];
      if (isOpen(t)) depth++;
      else if (isClose(t)) depth--;
      else if (depth === 0 && t.t === 'id' && ['(', ',', '...'].includes(toks[k - 1].v)) names.push(t.v);
    }
    return {names, close};
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'id' && t.v === 'function') {
      let j = i + 1;
      if (toks[j]?.v === '*') j++;
      let name = null;
      if (toks[j]?.t === 'id' && toks[j + 1]?.v === '(') { name = toks[j].v; j++; }
      else if (toks[i - 1]?.v === '=' && toks[i - 2]?.t === 'id') name = toks[i - 2].v;
      if (toks[j]?.v === '(') { const {names, close} = paramsOf(j); if (toks[close + 1]?.v === '{') bodies.set(close + 1, {name, params: names}); }
    } else if (t.t === 'p' && t.v === '=>') {
      let start, params;
      if (toks[i - 1]?.v === ')') { start = matchOpen(toks, i - 1); params = paramsOf(start).names; }
      else { start = i - 1; params = toks[i - 1]?.t === 'id' ? [toks[i - 1].v] : []; }
      if (toks[start - 1]?.v === 'async') start--;
      const name = toks[start - 1]?.v === '=' && toks[start - 2]?.t === 'id' ? toks[start - 2].v : null;
      if (toks[i + 1]?.v === '{') bodies.set(i + 1, {name, params});
      else if (name) exprBodies.push({from: i + 1, to: expressionEnd(toks, i + 1), frame: {name, params, start: i + 1}});
    }
  }
  const encl = new Array(toks.length).fill(null), named = [], stack = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'p' && t.v === '{') { const frame = bodies.get(i); if (frame?.name) { frame.start = i; named.push(frame); stack.push(true); } else stack.push(false); }
    encl[i] = named[named.length - 1] ?? null;
    if (t.t === 'p' && t.v === '}' && stack.pop()) named.pop();
  }
  // arrow functions with an expression body (`const post = (p, x) => api(p, ...)`) have no braces
  for (const {from, to, frame} of exprBodies) for (let k = from; k < to; k++) if (!encl[k] || (encl[k].start ?? -1) < from) encl[k] = frame;
  return {encl, functions: new Set([...bodies.values()].map(f => f.name).filter(Boolean))};
}

// file-level `const NAME = 'literal'` (single declaration only)
export function stringConsts(toks) {
  const seen = new Map();
  for (let i = 0; i + 3 < toks.length; i++) {
    if (toks[i].v !== 'const' || toks[i + 1].t !== 'id' || toks[i + 2].v !== '=') continue;
    const name = toks[i + 1].v, value = toks[i + 3], after = toks[i + 4];
    const ends = !after || after.v === ';' || after.v === ',' || after.line > value.line;
    const text = value.t === 'str' ? value.v : value.t === 'tpl' && value.parts.length === 1 ? value.parts[0].s : null;
    seen.set(name, seen.has(name) ? null : (ends ? text : null));
  }
  return seen;
}

const text = ts => ts.map(t => t.t === 'tpl' ? '`' + t.parts.map(p => p.s ?? '${' + p.e + '}').join('') + '`' : String(t.v)).join(' ');
const trimParens = ts => {
  while (ts.length >= 2 && ts[0].v === '(' && ts[0].t === 'p' && matchClose(ts, 0) === ts.length - 1) ts = ts.slice(1, -1);
  return ts;
};
const compatible = (a, b) => !a.some(x => b.includes(x.startsWith('!') ? x.slice(1) : '!' + x));

// -> alternatives [{conds: string[], pieces: [{lit}|{dyn}]}]
export function evalExpr(input, consts) {
  const ts = trimParens(input);
  if (!ts.length) return [{conds: [], pieces: []}];
  let depth = 0, q = -1;
  for (let k = 0; k < ts.length; k++) {
    if (isOpen(ts[k])) depth++; else if (isClose(ts[k])) depth--;
    else if (depth === 0 && ts[k].t === 'p' && ts[k].v === '?') { q = k; break; }
  }
  if (q > 0) {
    let colon = -1; depth = 0; let nested = 0;
    for (let k = q + 1; k < ts.length; k++) {
      if (isOpen(ts[k])) depth++; else if (isClose(ts[k])) depth--;
      else if (depth === 0 && ts[k].t === 'p') { if (ts[k].v === '?') nested++; else if (ts[k].v === ':') { if (nested === 0) { colon = k; break; } nested--; } }
    }
    if (colon > 0) {
      const cond = text(ts.slice(0, q));
      const add = (alts, c) => alts.map(a => ({conds: [...a.conds, c], pieces: a.pieces}));
      return [...add(evalExpr(ts.slice(q + 1, colon), consts), cond), ...add(evalExpr(ts.slice(colon + 1), consts), '!' + cond)];
    }
  }
  const operands = splitTop(ts, 0, ts.length, '+');
  let result = [{conds: [], pieces: []}];
  for (const operand of operands) {
    const alts = evalOperand(operand, consts);
    const next = [];
    for (const r of result) for (const a of alts) if (compatible(r.conds, a.conds)) next.push({conds: [...r.conds, ...a.conds], pieces: [...r.pieces, ...a.pieces]});
    result = next;
  }
  return result;
}

function evalOperand(input, consts) {
  const ts = trimParens(input);
  if (ts.length !== input.length) return evalExpr(ts, consts);
  if (ts.length === 1 && ts[0].t === 'str') return [{conds: [], pieces: [{lit: ts[0].v}]}];
  if (ts.length === 1 && ts[0].t === 'tpl') {
    const pieces = [];
    for (const part of ts[0].parts) {
      if (part.s !== undefined) { if (part.s) pieces.push({lit: part.s}); continue; }
      const inner = tokenize(part.e);
      const resolved = inner.length === 1 && inner[0].t === 'id' ? consts.get(inner[0].v) : null;
      pieces.push(typeof resolved === 'string' ? {lit: resolved} : {dyn: part.e.trim()});
    }
    return [{conds: [], pieces}];
  }
  if (ts.length === 1 && ts[0].t === 'id' && typeof consts.get(ts[0].v) === 'string') return [{conds: [], pieces: [{lit: consts.get(ts[0].v)}]}];
  return [{conds: [], pieces: [{dyn: text(ts)}]}];
}

// pieces -> {kind: 'L'|'T'|'O', pattern, open}
export function classify(pieces) {
  let out = '';
  for (const p of pieces) out += p.lit !== undefined ? p.lit : '\u0001';
  const cut = out.indexOf('?');
  if (cut >= 0) out = out.slice(0, cut);
  const pattern = out.replace(/\u0001+/g, '{}');
  if (!out.includes('\u0001')) return {kind: 'L', pattern, open: false};
  const head = out.slice(0, out.indexOf('\u0001'));
  const open = [...pattern.matchAll(/\{\}/g)].some(m => (m.index > 0 && pattern[m.index - 1] !== '/') || (m.index + 2 < pattern.length && pattern[m.index + 2] !== '/'));
  return {kind: head.startsWith('/api/') ? 'T' : 'O', pattern, open, head};
}

function methodsOf(ts, consts) {
  const alts = evalExpr(ts, consts);
  const out = [];
  for (const a of alts) {
    if (a.pieces.length !== 1 || a.pieces[0].lit === undefined) return null;
    const v = a.pieces[0].lit.toUpperCase();
    if (!METHODS.has(v)) return null;
    out.push({v, conds: a.conds});
  }
  return out;
}

function optionsMethods(ts, consts) {
  if (!ts) return [{v: 'GET', conds: []}];
  ts = trimParens(ts);
  if (!(ts[0]?.v === '{' && ts[0].t === 'p' && matchClose(ts, 0) === ts.length - 1)) return null;
  // Evaluated in source order, last write wins: a later spread, computed key or accessor may override the method
  // at run time, so the method is unknown (null) from there on, unless a literal `method:` follows it again.
  let current = [{v: 'GET', conds: []}];
  for (const prop of splitTop(ts, 1, ts.length - 1, ',')) {
    if (!prop.length) continue;
    const key = prop[0];
    if (key.v === '...' || (key.t === 'p' && key.v === '[') || (['get', 'set', 'async'].includes(key.v) && prop[1]?.v === 'method')) { current = null; continue; }
    if ((key.t === 'id' || key.t === 'str') && key.v === 'method')
      current = prop[1]?.v === ':' ? methodsOf(prop.slice(2), consts) : null; // shorthand: the value lives in a variable
  }
  return current;
}

// Analyze one file. helpers: [{file, name, url, options?, method?: number|string, prefix?, scope?}]
export function analyzeCalls(file, source, helpers, passthroughFiles = []) {
  const toks = tokenize(maskCode(source, file));
  const {encl, functions} = functionFrames(toks);
  const consts = stringConsts(toks);
  const calls = [], problems = [];
  // aliases of the global fetch: `fetchImpl = fetch`, `f = globalThis.fetch`, `orig = window.fetch.bind(window)`
  // (followed transitively: `a = fetch; b = a;`). Any other use of the bare name fetch (passed on, .call, ternary ...)
  // cannot be followed and fails the guard instead of being tolerated.
  const sinks = new Set(SINKS);
  const passthrough = passthroughFiles.includes(file);
  const globalFetch = i => toks[i].v === 'fetch' && toks[i - 1]?.v === '.' && GLOBAL_OBJECTS.has(toks[i - 2]?.v);
  const aliasTarget = i => { const k = globalFetch(i) ? i - 2 : i; return toks[k - 1]?.v === '=' && toks[k - 2]?.t === 'id' ? toks[k - 2].v : null; };
  for (let grew = true; grew;) {
    grew = false;
    toks.forEach((t, i) => {
      if (t.t !== 'id' || toks[i + 1]?.v === '(' || !(sinks.has(t.v) || t.v === 'fetch')) return;
      if (toks[i - 1]?.v === '.' && !globalFetch(i)) return;
      const name = aliasTarget(i);
      if (name && !sinks.has(name)) { sinks.add(name); grew = true; }
    });
  }
  toks.forEach((t, i) => {
    if (passthrough || t.t !== 'id' || t.v !== 'fetch' || toks[i + 1]?.v === '(') return;
    if (toks[i - 1]?.v === '.' && !globalFetch(i)) return; // property of another object
    if (aliasTarget(i) || (toks[i + 1]?.v === ':' && ['{', ','].includes(toks[i - 1]?.v)) || toks[i - 1]?.v === 'typeof') return;
    problems.push(`${file}:${t.line}: fetch is used in a form the guard cannot follow (not a call, not a plain alias) - call it directly`);
  });
  const mine = helpers.filter(h => h.scope === 'global' || h.file === file);
  const helperOf = name => mine.find(h => h.name === name);
  const ordinals = new Map();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'id' || toks[i + 1]?.v !== '(') continue;
    const before = toks[i - 1];
    if (before?.v === '.' && !globalFetch(i)) continue;
    if (before?.t === 'id' && before.v === 'function') continue;
    const helper = helperOf(t.v);
    if (!sinks.has(t.v) && !helper) continue;
    const close = matchClose(toks, i + 1);
    if (toks[close + 1]?.v === '{') continue; // method definition
    const args = splitTop(toks, i + 2, close, ',');
    const frame = encl[i];
    const where = `${file}:${t.line}`;
    const urlArg = args[helper ? helper.url : 0];
    if (!urlArg?.length) { problems.push(`${where}: ${t.v}() call without URL argument`); continue; }
    const frameHelper = frame ? mine.find(h => h.name === frame.name) : null;
    const urlParam = frameHelper ? frame.params[frameHelper.url] : null;
    if (urlParam && urlArg.some(a => a.t === 'id' && a.v === urlParam)) continue; // pass-through inside a registered helper
    if (passthrough && urlArg.length === 1 && urlArg[0].t === 'id') continue; // registered pass-through file (device-fetch.js)
    let alts = evalExpr(urlArg, consts);
    if (helper?.prefix) alts = alts.map(a => ({conds: a.conds, pieces: [{lit: helper.prefix}, ...a.pieces]}));
    let methods;
    if (helper && typeof helper.method === 'string') methods = [{v: helper.method, conds: []}];
    else if (helper && typeof helper.method === 'number') methods = args[helper.method] ? methodsOf(args[helper.method], consts) : [{v: 'GET', conds: []}];
    else methods = optionsMethods(args[helper ? (helper.options ?? 99) : 1], consts);
    const fn = frame?.name ?? '(module)';
    const site = [];
    for (const alt of alts) {
      const c = classify(alt.pieces);
      if (c.kind === 'O' && urlArg.length === 1 && urlArg[0].t === 'id' && frame?.params.includes(urlArg[0].v))
        problems.push(`${where}: ${t.v}(${urlArg[0].v}) forwards a parameter of ${fn}() - register ${fn} in scripts/page-reads-helpers.mjs`);
      const chosen = methods ? methods.filter(m => compatible(alt.conds, m.conds)) : [{v: null, conds: []}];
      for (const m of chosen) {
        const call = {file, line: t.line, fn, kind: c.kind, pattern: c.pattern, open: c.open, head: c.head ?? null, method: m.v};
        site.push(call);
      }
    }
    // A call site whose URL is opaque, open-ended or whose method is unknown is not decided by the code alone:
    // it gets an ID (file#function@n) that must be bound to explicit alternatives (scripts/page-reads-bindings.mjs).
    if (site.some(c => c.kind === 'O' || c.method === null || (c.kind === 'T' && c.open))) {
      const key = `${file}#${fn}`;
      const id = `${key}@${(ordinals.get(key) ?? 0) + 1}`;
      ordinals.set(key, (ordinals.get(key) ?? 0) + 1);
      for (const c of site) if (c.kind === 'O' || c.method === null || (c.kind === 'T' && c.open)) c.id = id;
    }
    calls.push(...site);
  }
  return {calls, problems, functions};
}

export const readText = path => readFileSync(path, 'utf8');
