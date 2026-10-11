// Browser wiring for /prompt-library (P-1963-P3). DOM is built with createElement/textContent only; no inline handlers.
import {createPromptClient, createLatest, createDebouncer, listState, storeChatDraft} from './prompt-library.mjs';

const root = document.getElementById('prompt-library');
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined && text !== null) n.textContent = text; return n; };
const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
const part = id => root.querySelector('[data-part="' + id + '"]');
const client = createPromptClient();
const latestList = createLatest();
const latestDetail = createLatest();
const state = {currentId: null, query: '', category: '', loading: false, error: null, prompts: [], categories: []};

function status(message, isError) {
  const node = part('status');
  node.textContent = message || '';
  node.className = isError ? 'pl-problem' : 'pl-muted';
}

function field(labelText, control) { const l = el('label'); l.append(el('span', null, labelText), control); return l; }
function input(id, value) { const i = el('input'); i.type = 'text'; i.dataset.field = id; i.value = value || ''; return i; }
function textarea(id, value) { const t = el('textarea', 'pl-textarea'); t.dataset.field = id; t.value = value || ''; t.spellcheck = false; return t; }
function button(label, handler, className) { const b = el('button', 'btn' + (className ? ' ' + className : ''), label); b.type = 'button'; b.addEventListener('click', handler); return b; }

function renderCategories() {
  const select = part('category');
  const current = state.category;
  clear(select).append(Object.assign(el('option', null, 'Alle Kategorien'), {value: ''}));
  for (const c of state.categories) select.append(Object.assign(el('option', null, c), {value: c}));
  select.value = state.categories.includes(current) ? current : '';
}

function renderList() {
  const list = clear(part('list'));
  const kind = listState({loading: state.loading, error: state.error, prompts: state.prompts, filtered: !!(state.query || state.category)});
  const message = {
    loading: 'Prompts werden geladen …',
    empty: 'Die Bibliothek enthält noch keine Prompts. Neu anlegen oder aus PromptBoard importieren.',
    'no-match': 'Kein Prompt passt zu Suche und Kategorie.',
  }[kind];
  if (kind.startsWith('error:')) {
    const box = el('div', 'pl-problem');
    box.append(el('strong', null, 'Liste nicht verfügbar: '), state.error.message);
    list.append(box, el('p', 'pl-muted', 'Das ist ein Fehler, kein leerer Bestand.'));
    return;
  }
  if (message) { list.append(el('p', 'pl-muted', message)); return; }
  for (const p of state.prompts) {
    const item = el('button', 'pl-item' + (p.id === state.currentId ? ' active' : '')); item.type = 'button';
    item.dataset.id = String(p.id);
    const name = el('span', 'pl-item-name', p.name);
    if (p.category) name.append(' ', el('span', 'pl-badge', p.category));
    item.append(name, el('span', 'pl-item-meta', p.purpose || ''));
    item.addEventListener('click', () => openPrompt(p.id));
    list.append(item);
  }
}

async function loadList() {
  const token = latestList.next();
  state.loading = true; state.error = null; renderList();
  try {
    const data = await client.list({q: state.query, category: state.category});
    if (!latestList.isCurrent(token)) return;
    state.prompts = data.prompts; state.categories = data.categories; state.loading = false;
    renderCategories(); part('count').textContent = data.prompts.length + ' Prompts';
  } catch (error) {
    if (!latestList.isCurrent(token)) return;
    state.loading = false; state.error = error; state.prompts = [];
    part('count').textContent = 'Unbekannt';
  }
  renderList();
}

function detailTitle(text) { part('detail-title').textContent = text; }

function showMessage(text) { clear(part('detail')).append(el('p', 'pl-muted', text)); }

async function openPrompt(id) {
  const token = latestDetail.next();
  state.currentId = id; renderList();
  detailTitle('Wird geladen …'); showMessage('Prompt wird geladen …');
  try {
    const data = await client.get(id);
    if (!latestDetail.isCurrent(token)) return;
    renderDetail(data.prompt, data.versions);
  } catch (error) {
    if (!latestDetail.isCurrent(token)) return;
    detailTitle('Prompt nicht verfügbar');
    clear(part('detail')).append(el('p', 'pl-problem', (error.kind === 'notfound' ? 'Prompt nicht gefunden (evtl. gelöscht). ' : '') + error.message));
    if (error.kind === 'notfound') { state.currentId = null; loadList(); }
  }
}

function renderDetail(p, versions) {
  detailTitle(p.name + ' (#' + p.id + ')');
  const box = clear(part('detail'));
  const text = textarea('text', p.text), tags = input('tags', p.tags);
  box.append(field('Text (Speichern archiviert den alten Stand als Version)', text), field('Tags (kommagetrennt)', tags));
  if (p.purpose || p.category) box.append(el('p', 'pl-muted', [p.category && 'Kategorie: ' + p.category, p.purpose && 'Zweck: ' + p.purpose].filter(Boolean).join(' · ')));
  const actions = el('div', 'pl-actions');
  actions.append(
    button('Speichern (neue Version)', async () => {
      try { const r = await client.update(p.id, {text: text.value, tags: tags.value}); status('Gespeichert, alter Stand als v' + r.archivedVersion + ' archiviert'); openPrompt(p.id); }
      catch (error) { status(error.message, true); }
    }, 'btn-primary'),
    button('Text kopieren', async () => {
      try { await navigator.clipboard.writeText(text.value); status('In Zwischenablage kopiert'); }
      catch { status('Kopieren nicht möglich (Zwischenablage gesperrt)', true); }
    }),
    button('Im Chat als Entwurf öffnen', () => {
      try { storeChatDraft(text.value); window.location.assign('/chat'); }
      catch (error) { status(error instanceof RangeError ? 'Der Entwurf ist zu groß' : 'Bitte zuerst einen nicht leeren Prompt wählen (oder Entwurf nicht übergebbar)', true); }
    }),
    Object.assign(button('Löschen', async () => {
      if (!confirm('Prompt inkl. Versionshistorie löschen?')) return;
      try { await client.remove(p.id); state.currentId = null; detailTitle('Kein Prompt gewählt'); showMessage('Gelöscht.'); loadList(); }
      catch (error) { status(error.message, true); }
    }), {className: 'btn pl-danger'}),
  );
  box.append(actions, el('h4', null, 'Versionshistorie'));
  if (!versions.length) box.append(el('p', 'pl-muted', 'Noch keine archivierten Versionen.'));
  for (const v of versions) {
    const row = el('div', 'pl-version'); row.append(el('strong', null, 'v' + v.versionNumber), ' ' , el('span', 'pl-muted', v.createdAt || 'Zeitpunkt unbekannt'), el('pre', null, v.text));
    box.append(row);
  }
}

function startCreate() {
  state.currentId = null; renderList();
  detailTitle('Neuer Prompt');
  const box = clear(part('detail'));
  const name = input('name'), category = input('category'), purpose = input('purpose'), tags = input('tags'), text = textarea('text');
  box.append(field('Name (eindeutig)', name), field('Kategorie', category), field('Zweck (Kurzbeschreibung)', purpose), field('Tags (kommagetrennt)', tags), field('Text', text));
  const actions = el('div', 'pl-actions');
  actions.append(button('Anlegen', async () => {
    try { const id = await client.create({name: name.value, text: text.value, category: category.value, purpose: purpose.value, tags: tags.value}); status('Angelegt (#' + id + ')'); await loadList(); openPrompt(id); }
    catch (error) { status(error.message, true); }
  }, 'btn-primary'));
  box.append(actions);
}

async function importPromptBoard() {
  try { const r = await client.importPromptBoard(); status('Import: ' + r.imported + ' neu, ' + r.skipped + ' vorhanden, ' + r.invalid + ' ungültig' + (r.source ? ' (' + r.source + ')' : '')); loadList(); }
  catch (error) { status(error.message, true); }
}

if (root) {
  const debounced = createDebouncer(() => loadList(), 300);
  part('search').addEventListener('input', event => { state.query = event.target.value.trim(); debounced.call(); });
  part('category').addEventListener('change', event => { state.category = event.target.value; loadList(); });
  part('new').addEventListener('click', startCreate);
  part('import').addEventListener('click', importPromptBoard);
  part('refresh').addEventListener('click', loadList);
  loadList();
}
