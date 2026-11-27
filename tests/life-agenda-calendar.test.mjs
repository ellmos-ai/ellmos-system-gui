import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const page = readFileSync(new URL('src/pages/life.astro', root), 'utf8');

function createDomNode(tag = 'div') {
  const attrs = new Map();
  const classes = new Set();
  const listeners = new Map();
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    attrs,
    listeners,
    _className: '',
    _textContent: '',
    href: '',
    download: '',
    type: '',
    get className() {
      return [...classes].join(' ');
    },
    set className(value) {
      classes.clear();
      for (const token of String(value || '').split(/\s+/).filter(Boolean)) classes.add(token);
      this._className = [...classes].join(' ');
    },
    classList: {
      add(...names) { names.forEach((n) => classes.add(n)); },
      remove(...names) { names.forEach((n) => classes.delete(n)); },
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) { classes.delete(name); return false; }
          classes.add(name); return true;
        }
        if (force) classes.add(name); else classes.delete(name);
        return Boolean(force);
      },
      contains(name) { return classes.has(name); },
    },
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = v == null ? '' : String(v); },
    set innerHTML(_v) { assert.fail('Darstellung darf kein innerHTML verwenden (XSS-Schutz)'); },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.get(k) ?? null; },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    click() { listeners.get('click')?.(); },
    remove() { this.removed = true; },
  };
}

function textDeep(node) {
  if (!node) return '';
  return [node.textContent || '', ...(node.children || []).map(textDeep)].filter(Boolean).join(' ');
}

function loadCalendarAndAgendaContext({ fetchImpl, onOpen, onDownload } = {}) {
  const elements = {
    'cal-silo-filters': createDomNode('div'),
    'calendar-load-status': createDomNode('p'),
    'life-agenda-status': createDomNode('p'),
    'life-agenda-list': createDomNode('div'),
  };
  const horizonButtons = ['all', 'short', 'mid', 'long'].map((horizon) => {
    const btn = createDomNode('button');
    btn.setAttribute('data-agenda-horizon', horizon);
    if (horizon === 'all') btn.classList.add('active');
    return btn;
  });
  const createdAnchors = [];
  const doc = {
    body: createDomNode('body'),
    getElementById(id) { return elements[id] ?? null; },
    querySelectorAll(selector) {
      if (selector === '[data-agenda-horizon]') return horizonButtons;
      if (selector === '[data-agenda-export]') return [];
      return [];
    },
    createElement(tag) {
      const el = createDomNode(tag);
      if (tag === 'a') {
        el.click = () => { if (onDownload) onDownload(el); };
        createdAnchors.push(el);
      }
      return el;
    },
  };
  const start = page.indexOf('function localDateKey(');
  const end = page.indexOf('const MONTH_NAMES =', start);
  assert.ok(start !== -1 && end > start, 'Kalender-/Agenda-Skriptblock muss in life.astro vorhanden sein');

  const context = vm.createContext({
    document: doc,
    window: { open: (url, target, rel) => { if (onOpen) onOpen(url, target, rel); return {}; } },
    URL: {
      createObjectURL: (blob) => `blob:test/${blob.kind || 'data'}`,
      revokeObjectURL: () => {},
    },
    setTimeout: () => 0,
    encodeURIComponent,
    lifeApiFetch: fetchImpl,
    loadCalendarEvents: async () => {},
  });
  vm.runInContext(page.slice(start, end), context);
  return { context, elements, horizonButtons, createdAnchors };
}

test('#cal-export-toolbar offers PDF-Kalenderblatt and exports format=pdf', async () => {
  const toolbarStart = page.indexOf('id="cal-export-toolbar"');
  const toolbarEnd = page.indexOf('</div>', toolbarStart);
  assert.ok(toolbarStart !== -1 && toolbarEnd > toolbarStart);
  const toolbarHtml = page.slice(toolbarStart, toolbarEnd);
  assert.match(toolbarHtml, /data-cal-export="pdf"/);
  assert.match(toolbarHtml, /PDF-Kalenderblatt/);

  const calls = [];
  const downloads = [];
  const { context, elements } = loadCalendarAndAgendaContext({
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, blob: async () => ({ kind: 'pdf' }) };
    },
    onDownload: (anchor) => downloads.push({ href: anchor.href, download: anchor.download }),
  });

  await context.exportCalendarReport('pdf');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\/api\/calendar\/export\?/);
  assert.match(calls[0], /format=pdf/);
  assert.equal(downloads.length, 1);
  assert.match(downloads[0].download, /^ocean-kalender-month-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.equal(elements['calendar-load-status'].textContent, 'Kalender-Export (PDF) erstellt.');
});

test('#cal-silo-filters renders terminpilot profile badge safely from /api/calendar/profiles', async () => {
  const xssName = 'TerminPilot <img src=x onerror=alert(1)>';
  const { context, elements } = loadCalendarAndAgendaContext({
    fetchImpl: async (url) => {
      assert.equal(url, '/api/calendar/profiles');
      return {
        ok: true,
        json: async () => ({
          profiles: [
            { id: 'user', name: 'Nutzer', color: '#38bdf8', count: 2 },
            { id: 'terminpilot', name: xssName, color: 'red;background:url(x)', count: 4 },
          ],
        }),
      };
    },
  });

  await context.loadCalendarProfiles();
  const buttons = elements['cal-silo-filters'].children.filter((n) => n.tagName === 'BUTTON');
  const tpBtn = buttons.find((b) => b.dataset.calSilo === 'terminpilot');
  assert.ok(tpBtn, 'TerminPilot-Button muss im Silo-Filter gerendert werden');
  const badge = tpBtn.children.find((c) => c.className.includes('cal-silo-badge'));
  assert.ok(badge, 'TerminPilot-Button braucht ein Farb-Badge');
  assert.equal(badge.style.backgroundColor, '#14b8a6');
  assert.ok(textDeep(tpBtn).includes(`${xssName} (4)`));

  // Minimales TerminPilot-Profil ohne expliziten Namen/Farbwert nutzt sauberen Standard
  const minimal = loadCalendarAndAgendaContext({
    fetchImpl: async () => ({ ok: true, json: async () => ({ profiles: [{ id: 'terminpilot' }] }) }),
  });
  await minimal.context.loadCalendarProfiles();
  const minTpBtn = minimal.elements['cal-silo-filters'].children.find((n) => n.dataset?.calSilo === 'terminpilot');
  assert.ok(minTpBtn);
  assert.equal(textDeep(minTpBtn), 'TerminPilot');
  assert.equal(minTpBtn.children[0].style.backgroundColor, '#14b8a6');
});

test('#life-agenda-panel markup and XSS-safe rendering of weight, progress, horizon, deadline', async () => {
  assert.match(page, /id="life-agenda-panel"/);
  assert.match(page, /Agenda &amp; Schwerpunkte/);
  for (const [horizon, label] of [['all', 'Alle'], ['short', 'Kurzfristig'], ['mid', 'Mittelfristig'], ['long', 'Langfristig']]) {
    assert.match(page, new RegExp(`data-agenda-horizon="${horizon}"[^>]*>${label}<`));
  }
  for (const fmt of ['pdf', 'html', 'md', 'txt']) {
    assert.match(page, new RegExp(`data-agenda-export="${fmt}"`));
  }

  const fnStart = page.indexOf('// ── AGENDA & SCHWERPUNKTE ──');
  const fnEnd = page.indexOf('const MONTH_NAMES =', fnStart);
  const agendaCode = page.slice(fnStart, fnEnd);
  assert.doesNotMatch(agendaCode, /console\.\w+\s*\(/);
  assert.doesNotMatch(agendaCode, /\.innerHTML\s*=/);

  const requestedUrls = [];
  const opened = [];
  const downloads = [];
  const xssTitle = 'Plan <script>alert(1)</script> & Fokus';
  const { context, elements, horizonButtons } = loadCalendarAndAgendaContext({
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      if (url.startsWith('/api/agenda/export')) {
        return { ok: true, blob: async () => ({ kind: 'export' }) };
      }
      return {
        ok: true,
        json: async () => ({
          available: true,
          items: [
            {
              id: 7,
              title: xssTitle,
              weight: 4.5,
              priority: 'hoch',
              horizon: 'short',
              status: 'active',
              progress: 120,
              category: 'Gesundheit',
              deadline: '2026-12-01',
            },
          ],
        }),
      };
    },
    onOpen: (url) => opened.push(url),
    onDownload: (a) => downloads.push(a.download),
  });

  await context.loadAgendaItems('short');
  assert.equal(requestedUrls[0], '/api/agenda?horizon=short');
  const row = elements['life-agenda-list'].children[0];
  assert.ok(row, 'Agenda-Zeile muss gerendert sein');
  const text = textDeep(row);
  assert.ok(text.includes(xssTitle));
  assert.ok(text.includes('Kurzfristig'));
  assert.ok(text.includes('Gewichtung: 4.5'));
  assert.ok(text.includes('Priorität: hoch'));
  assert.ok(text.includes('Frist: 2026-12-01'));
  assert.ok(text.includes('100 %'));

  const shortBtn = horizonButtons.find((b) => b.getAttribute('data-agenda-horizon') === 'short');
  assert.equal(shortBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(shortBtn.classList.contains('active'), true);

  for (const fmt of ['pdf', 'md', 'txt', 'html']) {
    await context.exportAgendaReport(fmt);
  }
  assert.deepEqual(requestedUrls.slice(1), [
    '/api/agenda/export?format=pdf&horizon=short',
    '/api/agenda/export?format=md&horizon=short',
    '/api/agenda/export?format=txt&horizon=short',
    '/api/agenda/export?format=html&horizon=short',
  ]);
  assert.deepEqual(downloads, [
    'ocean-agenda-short.pdf',
    'ocean-agenda-short.md',
    'ocean-agenda-short.txt',
  ]);
  assert.equal(opened.length, 1);
});

test('#life-agenda-panel shows honest empty states for available=false, empty items and HTTP errors', async () => {
  const responses = [
    { ok: true, json: async () => ({ available: false, message: 'Agenda-Adapter pausiert.', items: [] }) },
    { ok: true, json: async () => ({ available: true, items: [] }) },
    { ok: false, status: 503 },
  ];
  const { context, elements } = loadCalendarAndAgendaContext({
    fetchImpl: async () => responses.shift(),
  });

  await context.loadAgendaItems('all');
  assert.equal(elements['life-agenda-list'].children[0].textContent, 'Agenda-Adapter pausiert.');

  await context.loadAgendaItems('mid');
  assert.match(elements['life-agenda-list'].children[0].textContent, /keine Agenda-Schwerpunkte/);

  await context.loadAgendaItems('long');
  assert.match(elements['life-agenda-status'].textContent, /HTTP 503/);
  assert.match(elements['life-agenda-list'].children[0].textContent, /nicht geladen werden/);
});

test('#life-agenda-panel wiring handles horizon button clicks and ignores stale responses', async () => {
  const pendingResolvers = [];
  const urls = [];
  const { context, elements, horizonButtons } = loadCalendarAndAgendaContext({
    fetchImpl: (url) => {
      urls.push(url);
      return new Promise((resolve) => pendingResolvers.push(resolve));
    },
  });
  context.setupAgendaControls();
  const midBtn = horizonButtons.find((b) => b.getAttribute('data-agenda-horizon') === 'mid');
  const longBtn = horizonButtons.find((b) => b.getAttribute('data-agenda-horizon') === 'long');
  midBtn.click();
  longBtn.click();
  assert.deepEqual(urls, ['/api/agenda?horizon=mid', '/api/agenda?horizon=long']);

  // Neuere Antwort (long) kommt zuerst, ältere Antwort (mid) danach -> darf long nicht überschreiben
  pendingResolvers[1]({
    ok: true,
    json: async () => ({ available: true, items: [{ id: 2, title: 'Langfristiger Schwerpunkt', horizon: 'long', progress: 40 }] }),
  });
  await new Promise((r) => setTimeout(r, 0));
  pendingResolvers[0]({
    ok: true,
    json: async () => ({ available: true, items: [{ id: 1, title: 'Veralteter Mid-Stand', horizon: 'mid', progress: 10 }] }),
  });
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(elements['life-agenda-list'].children.length, 1);
  assert.ok(textDeep(elements['life-agenda-list'].children[0]).includes('Langfristiger Schwerpunkt'));
  assert.ok(!textDeep(elements['life-agenda-list']).includes('Veralteter Mid-Stand'));
});
