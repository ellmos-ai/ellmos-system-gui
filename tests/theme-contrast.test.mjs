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

// Writer area of the main worker; migrates to the -text tokens there (see P-CONTRAST hauptworker-uebergabe).
const PENDING = [];

test('no stylesheet or page uses a base status/accent color as text any more', () => {
  const offenders = [];
  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { if (entry !== 'assets') walk(path); continue; }
      if (!/\.(astro|css|mjs|js)$/.test(entry) || PENDING.some(p => path.split('\\').join('/').endsWith(p))) continue;
      const text = readFileSync(path, 'utf8');
      for (const m of text.matchAll(/(?<![-\w])color:\s*var\(--(success|warning|error|accent-blue|accent)\)/g)) offenders.push(path + ': ' + m[0]);
    }
  };
  walk(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  assert.deepEqual(offenders, []);
});

test('colorful/custom primary gradient (normal, hover, active nav) keeps white text at 4.5:1 over all 21 steps', () => {
  const theme = themes.colorful;
  const white = [255, 255, 255];
  for (const [from, to] of [['--primary-grad-from', '--primary-grad-to'], ['--primary-grad-hover-from', '--primary-grad-hover-to']]) {
    for (let i = 0; i <= 20; i++) {
      const stop = blend(resolve(theme, from), resolve(theme, to), 1 - i / 20);
      const value = ratio(white, stop);
      assert.ok(value >= 4.5, `${from}..${to} step ${i}: ${value.toFixed(2)}`);
    }
  }
  assert.equal(theme['--accent'], '#ff6b8a', 'accent itself stays unchanged for all other uses');
  assert.equal(theme['--accent-blue'], '#7c6cf0');
});

test('colorful/custom primary rules use the gradient tokens (not accent) and keep white text', () => {
  const rules = {
    '.btn-primary': /\[data-theme="colorful"\] \.btn-primary,\s*\[data-theme="custom"\] \.btn-primary\s*\{([^}]*)\}/,
    '.nav-item.active': /\[data-theme="colorful"\] \.nav-item\.active,\s*\[data-theme="custom"\] \.nav-item\.active\s*\{([^}]*)\}/,
  };
  for (const [selector, pattern] of Object.entries(rules)) {
    const rule = pattern.exec(css);
    assert.ok(rule, 'rule missing for ' + selector);
    assert.match(rule[1], /linear-gradient\(135deg,\s*var\(--primary-grad-from\),\s*var\(--primary-grad-to\)\)/, selector);
    assert.match(rule[1], /color:\s*#fff;/, selector);
  }
  const hover = [...css.matchAll(/\[data-theme="colorful"\] \.btn-primary:hover,\s*\[data-theme="custom"\] \.btn-primary:hover\s*\{([^}]*)\}/g)].map(m => m[1]).join('\n');
  assert.match(hover, /var\(--primary-grad-hover-from\),\s*var\(--primary-grad-hover-to\)/);
  assert.match(css, /\[data-theme="custom"\] \.btn-primary:hover \{ color: #fff; \}/);
});

// ---- PB-5b (#3989, B-15): shell surfaces, the talk popover and the new tile/pill components in all five themes ----
const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url), 'utf8');
const talkPage = readFileSync(new URL('../src/pages/talk.astro', import.meta.url), 'utf8');
const tileCss = readFileSync(new URL('../src/styles/agent-tile.css', import.meta.url), 'utf8');
const hex = value => { assert.match(value, /^#[0-9a-f]{6}$/i, value); return rgb(value); };

// The color a selector ends up with: the first rule in cascade priority that sets `color: var(--token)`.
function ruleColorToken(source, selectors) {
  for (const selector of selectors) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('(?:^|\\n|,)\\s*' + escaped + '\\s*(?:,[^{]*)?\\{([^}]*)\\}', 'g');
    for (const rule of source.matchAll(pattern)) {
      const color = /(?<![-\w])color:\s*var\((--[\w-]+)/.exec(rule[1]);
      if (color) return color[1];
    }
  }
  return null;
}

test('sidebar items (pinned domains) keep 4.5:1 on the shell navy in every theme', () => {
  const title = ruleColorToken(css, ['.app-sidebar .dropdown-item-title', '.dropdown-item-title']);
  const desc = ruleColorToken(css, ['.app-sidebar .dropdown-item-desc', '.dropdown-item-desc']);
  const label = ruleColorToken(css, ['.sidebar-domain-pins-label']);
  assert.ok(title && desc && label, `tokens ${title} ${desc} ${label}`);
  for (const [name, theme] of Object.entries(themes)) {
    for (const [what, token] of [['title', title], ['description', desc], ['label', label]]) {
      for (const surface of ['--shell-sidebar', '--shell-sidebar-hover', '--shell-sidebar-active']) {
        const value = ratio(resolve(theme, token), resolve(theme, surface));
        assert.ok(value >= 4.5, `${name}: pinned domain ${what} (${token}) on ${surface}: ${value.toFixed(2)}`);
      }
    }
  }
});

test('the talk popover and the talk page rows use theme tokens, no fixed dark surface or fixed light text', () => {
  const start = header.indexOf('.talk-console-popover {');
  const popover = header.slice(start, header.indexOf('</style>', start));
  assert.ok(start > 0 && popover.length > 2000);
  assert.deepEqual([...popover.matchAll(/rgba\(15,\s*23,\s*42/g)].map(m => m[0]), [], 'fixed dark slate surface');
  assert.deepEqual([...popover.matchAll(/(?<![-\w])color:\s*(#[0-9a-f]{3,6})/gi)].map(m => m[0]), [], 'fixed text color');
  assert.doesNotMatch(talkPage, /row\.style\.background|rgba\(15, 23, 42, 0\.7\)/, 'transcript rows are styled by class');
  assert.match(talkPage, /\.talk-transcript-row\s*\{[^}]*background:\s*var\(--bg-elevated\)[^}]*color:\s*var\(--text\)/s);
});

test('agent tile: text, indicators and the error panel are readable in every theme', () => {
  for (const [name, theme] of Object.entries(themes)) {
    const card = resolve(theme, '--bg-card');
    for (const token of ['--text', '--text-muted']) assert.ok(ratio(resolve(theme, token), card) >= 4.5, `${name} ${token} on tile`);
    for (const token of ['--success-text', '--accent-blue-text', '--text-muted', '--error-text', '--text-dim']) {
      const value = ratio(resolve(theme, token), card);
      assert.ok(value >= 3, `${name} status dot ${token} on tile: ${value.toFixed(2)} (needs 3:1 as a graphic)`);
    }
    const errorPanel = blend(TINT.error, card, 0.09);
    for (const token of ['--text', '--error-text']) {
      const value = ratio(resolve(theme, token), errorPanel);
      assert.ok(value >= 4.5, `${name} ${token} on the tile error panel: ${value.toFixed(2)}`);
    }
  }
  assert.match(tileCss, /\.agent-tile-status\[data-tone="ok"\]\s*\{\s*--tile-tone:\s*var\(--success-text\)/);
  assert.deepEqual([...tileCss.matchAll(/(?<![-\w])color:\s*#[0-9a-f]{3,6}/gi)].map(m => m[0]), [], 'tile text never uses a fixed color');
});

test('header pills: text and indicator dots are readable on the shell topbar', () => {
  const shell = themes.dark;
  const bar = hex(shell['--shell-topbar']);
  const hover = hex(shell['--shell-sidebar-hover']);
  for (const surface of [bar, hover]) assert.ok(ratio(hex(shell['--shell-text']), surface) >= 4.5);
  for (const tone of ['#5fd08f', '#7cb6ff', '#aec3d4', '#ff8f8c', '#8aa3b8']) {
    const value = ratio(hex(tone), bar);
    assert.ok(value >= 3, `pill dot ${tone} on the topbar: ${value.toFixed(2)}`);
  }
  assert.ok(header.includes('--pill-tone: #5fd08f') && css.includes('--pill-tone: #5fd08f'));
});
