// Browser wiring for the Ocean catalog views (#2018). DOM is built with createElement/textContent only:
// catalog values (names, descriptions, ids) are only ever set as text.
import {loadCatalog} from './catalog-projection.mjs';
import {loadSkill} from './capability-board-client.mjs';
import {bundleCards, stackCards, skillRows, filterRows, countsLine, sourceRows, catalogNotes} from './catalog-views.mjs';

const root = document.getElementById('catalog-views');
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};
const clear = node => { while (node.firstChild) node.removeChild(node.firstChild); return node; };
const part = id => root.querySelector('[data-part="' + id + '"]');

function badge(text, tone) { return el('span', 'cv-badge' + (tone ? ' cv-' + tone : ''), text); }

function compositionCard(card) {
  const article = el('article', 'cv-card');
  const head = el('div', 'cv-card-head');
  head.append(el('h4', null, card.name), badge(card.version ? 'v' + card.version : 'Version unbekannt', card.version ? '' : 'unknown'));
  article.append(head);
  if (card.id !== card.name) article.append(el('p', 'cv-id', card.id));
  article.append(el('p', 'cv-desc', card.description || 'Keine Beschreibung deklariert.'));
  if (card.problems.length) {
    const problems = el('ul', 'cv-problems');
    for (const problem of card.problems) problems.append(el('li', null, problem));
    article.append(problems);
  }
  const declared = el('section', 'cv-block');
  declared.append(el('h5', null, 'Deklariert (Katalogangabe, nicht geprüft)'));
  if (card.declared.empty) declared.append(el('p', 'cv-muted', 'Keine Bestandteile deklariert.'));
  for (const group of card.declared.groups) {
    const list = el('div', 'cv-group');
    list.append(el('h6', null, group.label + ' (' + group.entries.length + ')'));
    const ul = el('ul');
    for (const entry of group.entries) {
      const li = el('li');
      li.append(el('span', 'cv-type', entry.typeLabel), ' ', el('strong', null, entry.name));
      if (entry.version) li.append(' ', el('span', 'cv-muted', 'v' + entry.version));
      if (!entry.resolved) li.append(' ', badge('nicht im Katalog', 'unknown'));
      ul.append(li);
    }
    list.append(ul);
    declared.append(list);
  }
  const measured = el('section', 'cv-block');
  measured.append(el('h5', null, 'Gemessen'), el('p', card.measured.measured ? '' : 'cv-muted', card.measured.text), el('p', 'cv-muted', card.git));
  article.append(declared, measured);
  return article;
}

function renderCards(target, cards, emptyText) {
  clear(target);
  if (!cards.length) { target.append(el('p', 'cv-muted', emptyText)); return; }
  for (const card of cards) target.append(compositionCard(card));
}

const fullTexts = new Map();
async function readFullText(row) {
  if (!fullTexts.has(row.textId)) fullTexts.set(row.textId, loadSkill(row.textId).catch(error => { fullTexts.delete(row.textId); throw error; }));
  return fullTexts.get(row.textId);
}

function skillRow(row) {
  const details = el('details', 'cv-skill');
  const summary = el('summary');
  summary.append(el('strong', null, row.name), ' ', badge(row.version ? 'v' + row.version : 'Version unbekannt', row.version ? '' : 'unknown'));
  if (row.category) summary.append(' ', badge(row.category));
  details.append(summary);
  details.append(el('p', 'cv-desc', row.description || 'Keine Beschreibung deklariert.'));
  details.append(el('p', 'cv-muted', row.id + (row.pathLabel ? ' · ' + row.pathLabel : '') + (row.languages ? ' · Sprachen: ' + row.languages.join(', ') : '')));
  for (const problem of row.problems) details.append(el('p', 'cv-problem', problem));
  const status = el('p', 'cv-muted');
  status.setAttribute('role', 'status');
  const pre = el('pre', 'cv-fulltext');
  pre.hidden = true;
  const actions = el('div', 'cv-actions');
  const copyId = el('button', 'btn', 'Kennung kopieren');
  copyId.type = 'button';
  const copyText = el('button', 'btn', 'Volltext kopieren');
  copyText.type = 'button';
  const copy = async (value, label) => {
    try { await navigator.clipboard.writeText(value); status.textContent = label + ' kopiert.'; }
    catch { status.textContent = 'Kopieren nicht möglich (Zwischenablage gesperrt).'; }
  };
  copyId.addEventListener('click', () => copy(row.textId || row.id, 'Kennung'));
  actions.append(copyId, copyText);
  details.append(actions, status, pre);
  if (!row.textId) {
    copyText.disabled = true;
    status.textContent = 'Volltext nicht lesbar: Der Skillname ist keine gültige Bibliothekskennung.';
  }
  let loaded = false;
  const show = async () => {
    status.textContent = 'Volltext wird geladen …';
    try {
      const source = await readFullText(row);
      pre.textContent = source.content;
      pre.hidden = false;
      loaded = true;
      status.textContent = 'Quellenversion ' + source.source_version.slice(0, 12) + ' · ' + source.content.length + ' Zeichen';
      return source;
    } catch (error) {
      pre.hidden = true;
      status.textContent = 'Volltext nicht verfügbar: ' + error.message;
      return null;
    }
  };
  copyText.addEventListener('click', async () => {
    const source = loaded ? await readFullText(row) : await show();
    if (source) await copy(source.content, 'Volltext');
  });
  if (row.textId) details.addEventListener('toggle', () => { if (details.open && !loaded) show(); });
  return details;
}

function renderSkills(catalog, query) {
  const rows = skillRows(catalog);
  const hits = filterRows(rows, query);
  const target = clear(part('skills'));
  part('skill-hits').textContent = query ? hits.length + ' Treffer von ' + catalog.counts.skill : '';
  if (!hits.length) { target.append(el('p', 'cv-muted', rows.length ? 'Kein Skill passt zur Suche.' : 'Der Katalog enthält keine Skills.')); return; }
  for (const row of hits) target.append(skillRow(row));
}

function renderSources(catalog) {
  const target = clear(part('sources'));
  const ul = el('ul', 'cv-sources');
  for (const source of sourceRows(catalog)) {
    const li = el('li', source.ok ? '' : 'cv-bad');
    li.append(el('strong', null, source.id), ' ', badge(source.status, source.ok ? '' : 'bad'), ' ', el('span', 'cv-muted', source.pathLabel));
    if (source.error) li.append(' ', el('span', 'cv-problem', source.error));
    if (!source.generatedAt) li.append(' ', el('span', 'cv-muted', 'Erzeugungszeit unbekannt'));
    ul.append(li);
  }
  target.append(ul);
  if (catalog.errors.length) {
    const errors = el('ul', 'cv-problems');
    for (const error of catalog.errors) errors.append(el('li', null, error.source + ': ' + error.reason + (error.item ? ' (' + error.item + ')' : '')));
    target.append(el('h5', null, 'Auslassungen und Fehler (' + catalog.errors.length + ')'), errors);
  }
}

function renderHead(catalog) {
  const counts = clear(part('counts'));
  for (const entry of countsLine(catalog)) counts.append(badge(entry.label + ': ' + entry.count));
  const notes = clear(part('notes'));
  for (const note of catalogNotes(catalog)) notes.append(el('p', 'cv-muted', note));
}

function showFailure(error) {
  const status = part('status');
  status.textContent = 'Katalog nicht verfügbar: ' + (error.failure ? error.failure.label : error.message);
  status.className = 'cv-problem';
  for (const id of ['bundles', 'stacks', 'skills', 'sources', 'counts', 'notes'])
    clear(part(id)).append(el('p', 'cv-muted', 'Unbekannt – keine Katalogantwort.'));
}

let searchHandler = null;
async function refresh() {
  const status = part('status');
  status.className = 'cv-muted';
  status.textContent = 'Katalog wird geladen …';
  let catalog;
  try { catalog = await loadCatalog({}); }
  catch (error) { showFailure(error); return; }
  status.textContent = 'Stand ' + catalog.generatedAt + ' · Host ' + (catalog.host.id || 'unbekannt') + (catalog.host.source === 'declared' ? ' (deklariert)' : '');
  renderHead(catalog);
  renderCards(part('bundles'), bundleCards(catalog), 'Der Katalog enthält keine Bundles.');
  renderCards(part('stacks'), stackCards(catalog), 'Der Katalog enthält keine Stacks.');
  renderSources(catalog);
  const search = part('skill-search');
  renderSkills(catalog, search.value);
  if (searchHandler) search.removeEventListener('input', searchHandler);
  searchHandler = () => renderSkills(catalog, search.value);
  search.addEventListener('input', searchHandler);
}

if (root) {
  part('refresh').addEventListener('click', refresh);
  refresh();
}
