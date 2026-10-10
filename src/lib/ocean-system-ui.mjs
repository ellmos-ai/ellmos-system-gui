// Browser wiring for System/Ocean (#2017/#2019). DOM via createElement/textContent only; no inline handlers.
import {loadCatalog} from './catalog-projection.mjs';
import authoredRaw from '../data/schaltplan-authored.json';
import {VIEWS, viewFromSearch, parseAuthored, schaltplanModel, gesamtModel, satelliteModel, STATUS_LABEL} from './ocean-system.mjs';

const root = document.getElementById('ocean-system');
const SVG = 'http://www.w3.org/2000/svg';
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined && text !== null) n.textContent = text; return n; };
const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
const part = id => root.querySelector('[data-part="' + id + '"]');
const badge = (text, tone) => el('span', 'os-badge' + (tone ? ' os-' + tone : ''), text);

let redraw = null;
let catalog = null;
let authored = null;
let view = viewFromSearch(location.search);
let lang = 'de';
const state = {query: '', publicOnly: false, org: '', visibility: '', domain: '', gitState: '', pinned: null, hovered: null};

function setView(next, push) {
  view = next;
  if (push) { const url = new URL(location.href); url.searchParams.set('tab', 'ocean'); url.searchParams.set('view', next); history.pushState({}, '', url); }
  render();
}

function renderTabs() {
  const nav = clear(part('tabs'));
  for (const v of VIEWS) {
    const a = el('a', 'os-tab' + (v.id === view ? ' active' : ''), v.label);
    a.href = '?tab=ocean&view=' + v.id;
    if (v.id === view) a.setAttribute('aria-current', 'page');
    a.addEventListener('click', event => { event.preventDefault(); setView(v.id, true); });
    nav.append(a);
  }
}

function field(labelText, control) { const l = el('label'); l.append(el('span', null, labelText), control); return l; }
function searchBox(onInput) {
  const input = el('input'); input.type = 'search'; input.value = state.query; input.placeholder = 'Suchen …'; input.autocomplete = 'off';
  input.addEventListener('input', () => {
    state.query = input.value; const pos = input.selectionStart; onInput();
    const next = root.querySelector('input[type=search]'); if (next) { next.focus(); next.setSelectionRange(pos, pos); }
  });
  return field('Suchen', input);
}
function select(labelText, options, key, onChange, allLabel) {
  const s = el('select');
  s.append(Object.assign(el('option', null, allLabel), {value: ''}));
  for (const [value, count] of options) s.append(Object.assign(el('option', null, value + ' (' + count + ')'), {value}));
  s.value = state[key];
  s.addEventListener('change', () => { state[key] = s.value; onChange(); });
  return field(labelText, s);
}
function pills(options, key, onChange, allLabel) {
  const box = el('div', 'os-pills'); box.setAttribute('role', 'group');
  const make = (value, label) => {
    const b = el('button', 'os-pill' + (state[key] === value ? ' on' : ''), label); b.type = 'button'; b.setAttribute('aria-pressed', String(state[key] === value));
    b.addEventListener('click', () => { state[key] = value; onChange(); }); box.append(b);
  };
  make('', allLabel);
  for (const [value, count] of options) make(value, value + ' (' + count + ')');
  return box;
}
function kpi(total, hits, noun) {
  const box = el('div', 'os-kpi');
  box.append(badge('Gesamt ' + noun + ': ' + total), badge('Treffer: ' + hits, hits === total ? '' : 'hit'));
  return box;
}

// ------------------------------------------------------------ Schaltplan
function moduleButton(m) {
  const b = el('button', 'os-mod' + (m.hit ? '' : ' dim') + (state.pinned === m.key ? ' pinned' : '')); b.type = 'button'; b.dataset.key = m.key;
  b.append(el('span', 'os-led os-led-' + m.status), m.name);
  if (!m.isPublic) b.append(el('span', 'os-lock', m.visibility === 'Sichtbarkeit unbekannt' ? '?' : 'nicht öffentlich'));
  return b;
}

function zoneBox(zone, icons) {
  const z = el('div', 'os-zone'); z.dataset.area = zone.id; z.dataset.key = 'area:' + zone.id;
  const h = el('h4'); h.append(el('span', 'os-ic', icons[zone.id] || '▣'), el('span', 'os-ttl', (zone.dir ? zone.dir + ' · ' : '') + zone.name[lang]));
  if (zone.cross) h.append(badge('Querschnitt', 'unknown'));
  z.append(h, el('p', 'os-q', zone.q[lang]));
  const mods = el('div', 'os-mods');
  for (const m of zone.modules) mods.append(moduleButton(m));
  if (!zone.modules.length) mods.append(el('p', 'os-muted', 'Keine Module im Katalog.'));
  z.append(mods);
  return z;
}

function panelFor(model) {
  const body = clear(part('panel'));
  const key = state.pinned || state.hovered;
  if (!key) { body.append(el('p', 'os-muted', 'Bereich oder Modul wählen: Zweck, Status und Zusammenspiel erscheinen hier. Ein Klick pinnt die Ansicht.')); return; }
  const zones = model.zones.concat(model.unassigned ? [model.unassigned] : []);
  if (key.startsWith('area:')) {
    const zone = zones.find(z => 'area:' + z.id === key);
    if (!zone) return;
    body.append(el('h4', null, zone.name[lang]), el('p', 'os-desc', zone.desc[lang]), badge('Deklariert (kuratiert, nicht gemessen)', 'unknown'));
    const edges = model.edges.filter(e => e.from === zone.id || e.to === zone.id);
    const ul = el('ul');
    for (const e of edges) {
      const other = zones.find(z => z.id === (e.from === zone.id ? e.to : e.from));
      const li = el('li'); li.append(el('strong', null, (e.both ? '↔ ' : e.from === zone.id ? '→ ' : '← ') + (other ? other.name[lang] : '?')), el('br'), e.desc[lang]);
      ul.append(li);
    }
    body.append(edges.length ? ul : el('p', 'os-muted', 'Keine kuratierte Verbindung deklariert.'));
    return;
  }
  const mod = zones.flatMap(z => z.modules).find(m => m.key === key);
  if (!mod) return;
  body.append(el('h4', null, mod.name));
  const meta = el('div', 'os-meta');
  meta.append(badge(STATUS_LABEL[mod.status] + (mod.statusRaw ? ' (' + mod.statusRaw + ')' : '')), badge(mod.visibility), badge(mod.version ? 'v' + mod.version : 'Version unbekannt', mod.version ? '' : 'unknown'), badge(mod.git, 'unknown'));
  body.append(meta, el('p', 'os-desc', mod.description || 'Keine Beschreibung im Katalog.'));
  const links = (title, rows, kind) => {
    if (!rows.length) return;
    body.append(el('h5', null, title));
    const ul = el('ul');
    for (const r of rows) {
      const li = el('li'); li.append(el('code', null, r.capability));
      const others = kind === 'req' ? r.providers : r.consumers;
      li.append(' ', el('span', 'os-muted', kind === 'req' ? (r.requirement === 'optional' ? 'optional · ' : 'erforderlich · ') + (others.length ? 'bereitgestellt von ' + others.join(', ') : 'kein Anbieter im Katalog') : (others.length ? 'genutzt von ' + others.join(', ') : 'kein Nutzer im Katalog')));
      ul.append(li);
    }
    body.append(ul);
  };
  links('Stellt bereit (deklariert)', mod.links.provides, 'prov');
  links('Benötigt (deklariert)', mod.links.requires, 'req');
  if (mod.repoUrl) { const a = el('a', null, 'Repository ansehen'); a.href = mod.repoUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; body.append(a); }
  if (state.pinned) body.append(el('p', 'os-muted', 'Gepinnt – erneuter Klick löst.'));
}

function drawWires(model) {
  const wrap = part('boardwrap'); const board = part('board'); const svg = part('wires'); const g = svg.querySelector('g');
  clear(g); wrap.querySelectorAll('.os-wlabel').forEach(n => n.remove());
  const w = wrap.getBoundingClientRect();
  svg.setAttribute('width', w.width); svg.setAttribute('height', w.height);
  const hotArea = (() => { const k = state.pinned || state.hovered; if (!k) return null; if (k.startsWith('area:')) return k.slice(5); const z = model.zones.find(zz => zz.modules.some(m => m.key === k)); return z ? z.id : null; })();
  const anchor = (r, o) => {
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2, dx = (o.left + o.right) / 2 - cx, dy = (o.top + o.bottom) / 2 - cy;
    return Math.abs(dx) * (r.height / r.width) > Math.abs(dy) ? {x: (dx > 0 ? r.right : r.left) - w.left, y: cy + dy * 0.15 - w.top} : {x: cx + dx * 0.15 - w.left, y: (dy > 0 ? r.bottom : r.top) - w.top};
  };
  model.edges.forEach((e, i) => {
    const zf = board.querySelector('[data-area="' + e.from + '"]'), zt = board.querySelector('[data-area="' + e.to + '"]');
    if (!zf || !zt) return;
    const rf = zf.getBoundingClientRect(), rt = zt.getBoundingClientRect(), p1 = anchor(rf, rt), p2 = anchor(rt, rf);
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2, nx = -(p2.y - p1.y), ny = p2.x - p1.x, nl = Math.hypot(nx, ny) || 1, bend = 18 * (i % 2 === 0 ? 1 : -1);
    const hot = hotArea && (e.from === hotArea || e.to === hotArea);
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', 'M' + p1.x + ',' + p1.y + ' Q' + (mx + nx / nl * bend) + ',' + (my + ny / nl * bend) + ' ' + p2.x + ',' + p2.y);
    path.setAttribute('class', 'os-wire' + (hot ? ' hot' : '')); path.setAttribute('fill', 'none');
    g.append(path);
    const label = el('div', 'os-wlabel' + (hot ? ' hot' : ''), e.label[lang]);
    label.style.left = (mx + nx / nl * bend * 0.9) + 'px'; label.style.top = (my + ny / nl * bend * 0.9) + 'px';
    wrap.append(label);
  });
}

function renderSchaltplan(host) {
  const model = schaltplanModel(catalog, authored, {query: state.query, publicOnly: state.publicOnly});
  const bar = el('div', 'os-toolbar');
  bar.append(searchBox(() => renderSchaltplan(host)));
  const pub = el('input'); pub.type = 'checkbox'; pub.checked = state.publicOnly;
  pub.addEventListener('change', () => { state.publicOnly = pub.checked; renderSchaltplan(host); });
  const pl = el('label', 'os-check'); pl.append(pub, el('span', null, 'nur Öffentliches'));
  const langBtn = el('button', 'btn', lang === 'de' ? 'EN' : 'DE'); langBtn.type = 'button';
  langBtn.addEventListener('click', () => { lang = lang === 'de' ? 'en' : 'de'; renderSchaltplan(host); });
  bar.append(pl, langBtn, kpi(model.total, model.hits, 'Module'));
  clear(host).append(bar);
  const note = el('p', 'os-muted');
  note.textContent = 'Deklariert: Bereiche, Verbindungen und Schichten (kuratiert). Aus dem Katalog: Module, Status, Sichtbarkeit. Die Verbindungen sind keine Messung.';
  host.append(note);
  const layout = el('div', 'os-layout');
  const wrap = el('div', 'os-boardwrap'); wrap.dataset.part = 'boardwrap';
  const board = el('div', 'os-board'); board.dataset.part = 'board';
  for (const z of model.zones) board.append(zoneBox(z, authored.icons));
  if (model.unassigned) board.append(zoneBox(model.unassigned, authored.icons));
  const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('class', 'os-wires'); svg.dataset.part = 'wires'; svg.append(document.createElementNS(SVG, 'g'));
  wrap.append(board, svg);
  const panel = el('aside', 'os-panel'); const panelBody = el('div'); panelBody.dataset.part = 'panel'; panel.append(panelBody);
  layout.append(wrap, panel); host.append(layout);
  const refreshAll = () => { panelFor(model); drawWires(model); layout.querySelectorAll('.os-zone').forEach(z => z.classList.toggle('hot', (state.pinned || state.hovered) === z.dataset.key || (state.pinned || state.hovered || '').startsWith('module:') && z.querySelector('.os-mod[data-key="' + (state.pinned || state.hovered) + '"]'))); layout.querySelectorAll('.os-mod').forEach(b => b.classList.toggle('pinned', state.pinned === b.dataset.key)); };
  redraw = () => drawWires(model);
  layout.addEventListener('mouseover', ev => { const m = ev.target.closest('.os-mod'), z = ev.target.closest('.os-zone'); const next = m ? m.dataset.key : z ? z.dataset.key : null; if (next !== state.hovered) { state.hovered = next; refreshAll(); } });
  layout.addEventListener('click', ev => { const m = ev.target.closest('.os-mod'), z = ev.target.closest('.os-zone'); const next = m ? m.dataset.key : z ? z.dataset.key : null; state.pinned = next && next === state.pinned ? null : next; refreshAll(); });
  const layers = el('section', 'os-layers'); layers.append(el('h4', null, authored.ui[lang].layersH), el('p', 'os-muted', authored.ui[lang].layersSub));
  const stack = el('div', 'os-stack');
  for (const l of model.layers) { const d = el('div', 'os-layer'); d.append(el('strong', null, l.n[lang]), el('p', 'os-muted', l.d[lang])); stack.append(d); }
  layers.append(stack, el('p', 'os-muted', authored._meta.note));
  host.append(layers);
  refreshAll();
  requestAnimationFrame(redraw);
}

// ------------------------------------------------------------ Gesamtschaltplan
function renderGesamt(host) {
  const model = gesamtModel(catalog, authored, {query: state.query, org: state.org, visibility: state.visibility});
  const rerender = () => renderGesamt(host);
  clear(host);
  const bar = el('div', 'os-toolbar'); bar.append(searchBox(rerender), select('Sichtbarkeit', model.visibilities, 'visibility', rerender, 'Alle'), kpi(model.total, model.hits, 'Module und Satelliten'));
  host.append(bar, pills(model.orgs, 'org', rerender, 'Alle Organisationen'), el('p', 'os-muted', model.tierNote));
  const grid = el('div', 'os-columns');
  const col = (title, entries) => {
    const c = el('section', 'os-col'); c.append(el('h4', null, title + ' (' + entries.length + ')'));
    for (const e of entries) {
      const row = el('div', 'os-entry'); row.append(el('strong', null, e.name), ' ', badge(e.kind), ' ', badge(e.visibility, e.isPublic ? '' : 'unknown'));
      row.append(el('p', 'os-muted', (e.org || 'Organisation unbekannt') + ' · stellt bereit: ' + e.provides + ' · benötigt: ' + e.requires + ' · ' + e.git)); c.append(row);
    }
    if (!entries.length) c.append(el('p', 'os-muted', 'Keine Treffer.'));
    return c;
  };
  for (const c of model.columns) grid.append(col((c.dir ? c.dir + ' · ' : '') + c.name[lang], c.entries));
  if (model.other.length) grid.append(col('Ohne deklarierte Architekturspalte', model.other));
  host.append(grid);
  const wiring = el('section', 'os-wiring'); wiring.append(el('h4', null, 'Deklarierte Capability-Verdrahtung (requires/optional in den Modulmanifesten)'));
  const ul = el('ul');
  for (const w of model.wiring) for (const l of w.links) {
    const li = el('li'); li.append(el('strong', null, w.module), ' benötigt ', el('code', null, l.capability), ' (' + (l.requirement === 'optional' ? 'optional' : 'erforderlich') + ') ', el('span', 'os-muted', l.providers.length ? '← ' + l.providers.join(', ') : '← kein Anbieter im Katalog')); ul.append(li);
  }
  wiring.append(model.wiring.length ? ul : el('p', 'os-muted', 'Kein Modul deklariert Anforderungen.'));
  host.append(wiring);
}

// ------------------------------------------------------------ Satelliten
function renderSatelliten(host) {
  const model = satelliteModel(catalog, {query: state.query, org: state.org, domain: state.domain, gitState: state.gitState});
  const rerender = () => renderSatelliten(host);
  clear(host);
  const bar = el('div', 'os-toolbar');
  bar.append(searchBox(rerender), select('Domäne', model.domains, 'domain', rerender, 'Alle Domänen'), select('Git-Zustand', model.gitStates, 'gitState', rerender, 'Alle'), kpi(model.total, model.hits, 'Satelliten'));
  host.append(bar, pills(model.orgs, 'org', rerender, 'Alle Organisationen'));
  const states = el('p', 'os-muted'); states.textContent = 'Git-Zustände im Katalog: ' + model.gitStates.map(([s, n]) => s + ' ' + n).join(' · ') + '. „unknown“ heißt: kein Hostbeleg, nicht „sauber“.';
  host.append(states);
  const table = el('table', 'os-table'); const head = el('tr');
  for (const h of ['Satellit', 'Organisation', 'Domäne', 'Sichtbarkeit', 'Herkunft', 'Git']) head.append(el('th', null, h));
  const thead = el('thead'); thead.append(head); table.append(thead);
  const tbody = el('tbody');
  for (const r of model.rows) {
    const tr = el('tr'); const name = el('td'); name.append(el('strong', null, r.name), el('div', 'os-muted', r.description || 'Keine Beschreibung.'));
    tr.append(name, el('td', null, r.org || 'unbekannt'), el('td', null, r.domain || 'unbekannt'), el('td', null, r.visibility));
    tr.append(el('td', null, (r.provenance || 'Herkunft unbekannt') + (r.upstream ? ' · ' + r.upstream : '')));
    const git = el('td'); git.append(badge(r.git, r.gitState === 'unknown' ? 'unknown' : r.gitState === 'dirty' ? 'bad' : ''));
    git.append(el('div', 'os-muted', r.gitState === 'unknown' ? 'kein Hostbeleg' : (r.gitBranch ? r.gitBranch + ' · ' : '') + (r.observedAt ? 'beobachtet ' + r.observedAt : 'Zeitpunkt unbekannt')));
    tr.append(git); tbody.append(tr);
  }
  table.append(tbody);
  const scroll = el('div', 'os-scroll'); scroll.append(table);
  host.append(model.rows.length ? scroll : el('p', 'os-muted', model.total ? 'Kein Satellit passt zu den Filtern.' : 'Der Katalog enthält keine Satelliten.'));
}

function render() {
  renderTabs();
  const status = part('status');
  const host = part('content');
  if (!catalog) return;
  state.pinned = null; state.hovered = null; redraw = null;
  ({schaltplan: renderSchaltplan, gesamtschaltplan: renderGesamt, satelliten: renderSatelliten})[view](host);
  status.className = 'os-muted';
  status.textContent = 'Stand ' + catalog.generatedAt + ' · Host ' + (catalog.host.id || 'unbekannt') + (catalog.host.source === 'declared' ? ' (deklariert)' : '') +
    (catalog.truncated ? ' · Antwort gekürzt' : '') + (catalog.errors.length ? ' · ' + catalog.errors.length + ' Quellfehler/Auslassungen' : '') +
    (catalog.sources.some(s => s.availability !== 'available') ? ' · Quellen fehlen oder fehlerhaft: ' + catalog.sources.filter(s => s.availability !== 'available').map(s => s.id).join(', ') : '');
}

async function load() {
  const status = part('status');
  status.className = 'os-muted'; status.textContent = 'Katalog wird geladen …';
  try { authored = parseAuthored(authoredRaw); } catch (error) { status.textContent = error.message; status.className = 'os-problem'; return; }
  try { catalog = await loadCatalog({}); }
  catch (error) {
    catalog = null;
    status.className = 'os-problem'; status.textContent = 'Katalog nicht verfügbar: ' + (error.failure ? error.failure.label : error.message);
    clear(part('content')).append(el('p', 'os-muted', 'Unbekannt – keine Katalogantwort. Es werden keine Ersatzdaten gezeigt.'));
    renderTabs();
    return;
  }
  render();
}

if (root) {
  part('refresh').addEventListener('click', load);
  window.addEventListener('popstate', () => { view = viewFromSearch(location.search); render(); });
  window.addEventListener('resize', () => { if (catalog && view === 'schaltplan' && redraw) requestAnimationFrame(redraw); });
  renderTabs();
  load();
}
