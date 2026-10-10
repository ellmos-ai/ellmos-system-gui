import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');

function tokens(selectorPattern) {
  const match = new RegExp('^' + selectorPattern + '\\s*\\{([\\s\\S]*?)\\n\\}', 'm').exec(css);
  assert.ok(match, 'missing theme block ' + selectorPattern);
  return Object.fromEntries([...match[1].matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
const root = tokens(':root');
const themes = {
  dark: root,
  light: {...root, ...tokens('\\[data-theme="light"\\]')},
  warm: {...root, ...tokens('\\[data-theme="warm"\\]')},
  ocean: {...root, ...tokens('\\[data-theme="ocean"\\]')},
  colorful: {...root, ...tokens('\\[data-theme="colorful"\\],\\s*\\[data-theme="custom"\\]')},
};

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const blend = (fg, bg, alpha) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));
const resolve = (theme, name) => {
  let value = theme[name];
  for (let depth = 0; depth < 5 && /^var\(/.test(value); depth++) value = theme[value.slice(4, -1)];
  assert.match(value, /^#[0-9a-f]{6}$/i, name + ' = ' + value);
  return rgb(value);
};
const SURFACES = ['--bg-dark', '--bg-panel', '--bg-card', '--bg-elevated'];
// fixed badge tints from main.css (.badge-*: rgba of the dark-theme status colors, alpha .08 and .15)
const TINT = {success: [74, 222, 128], warning: [245, 197, 66], error: [239, 83, 80], 'accent-blue': [91, 141, 239]};

test('text and muted text reach 4.5:1 on every surface of every theme', () => {
  for (const [name, theme] of Object.entries(themes)) {
    for (const token of ['--text', '--text-muted', '--text-dim']) {
      for (const surface of SURFACES) {
        const value = ratio(resolve(theme, token), resolve(theme, surface));
        assert.ok(value >= 4.5, `${name} ${token} on ${surface}: ${value.toFixed(2)}`);
      }
    }
  }
});

test('status and accent text variants reach 4.5:1 on surfaces and on the tinted badge backgrounds', () => {
  for (const [name, theme] of Object.entries(themes)) {
    for (const kind of ['success', 'warning', 'error', 'accent-blue', 'accent']) {
      const text = resolve(theme, `--${kind}-text`);
      for (const surface of SURFACES) {
        assert.ok(ratio(text, resolve(theme, surface)) >= 4.5, `${name} --${kind}-text on ${surface}`);
        if (TINT[kind]) for (const alpha of [0.08, 0.15]) {
          const value = ratio(text, blend(TINT[kind], resolve(theme, surface), alpha));
          assert.ok(value >= 4.5, `${name} --${kind}-text on ${surface} tinted ${alpha}: ${value.toFixed(2)}`);
        }
      }
    }
  }
});

test('the base colors of surfaces and borders stay unchanged (only text variants differ)', () => {
  assert.equal(themes.light['--success'], '#22a854');
  assert.equal(themes.light['--warning'], '#c49000');
  assert.equal(themes.warm['--accent'], '#a64b2a');
  assert.equal(themes.colorful['--accent-blue'], '#7c6cf0');
  assert.equal(themes.ocean['--accent-blue'], '#0284c7');
  assert.equal(themes.colorful['--bg-card'], '#251d48');
});

test('no stylesheet or page uses a base status/accent color as text any more', () => {
  const offenders = [];
  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { if (entry !== 'assets') walk(path); continue; }
      if (!/\.(astro|css|mjs|js)$/.test(entry)) continue;
      const text = readFileSync(path, 'utf8');
      for (const m of text.matchAll(/(?<![-\w])color:\s*var\(--(success|warning|error|accent-blue|accent)\)/g)) offenders.push(path + ': ' + m[0]);
    }
  };
  walk(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  assert.deepEqual(offenders, []);
});
