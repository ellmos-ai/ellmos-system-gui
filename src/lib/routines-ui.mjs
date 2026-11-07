// PB-6 (#3990): renders the routines board. The rows are made here with createElement; their rules live in the page's
// <style is:global> (a scoped style would not reach them, see scripts/verify-scoped-styles.mjs).
import {SOURCE_KEYS, SOURCE_LABEL, attention, createRoutinesClient, filterRoutines} from './routines.mjs';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const RESULT = {success: ['badge badge-success', 'Erfolgreich'], failed: ['badge badge-error', 'Fehlgeschlagen'], timeout: ['badge badge-error', 'Zeitüberschreitung']};
const STATE_TEXT = {available: 'erreichbar', partial: 'teilweise erreichbar', unavailable: 'nicht erreichbar'};

export function sourceCardText(source) {
  if (source.state === 'unavailable') return `nicht erreichbar: ${source.reason}`;
  const count = `${source.count} ${source.count === 1 ? 'Eintrag' : 'Einträge'}`;
  return `${STATE_TEXT[source.state]} · ${count}`;
}

function cell(label, className = '') {
  const node = el('div', `routine-cell ${className}`.trim());
  node.setAttribute('role', 'cell');
  node.dataset.label = label;
  return node;
}

function nameCell(item) {
  const node = cell('Routine / Job', 'routine-name');
  const title = el('div', 'routine-title');
  const strong = el('strong', '', item.name);
  title.append(strong);
  const flag = attention(item);
  if (flag) {
    const badge = el('span', `badge ${flag.code === 'failed' ? 'badge-error' : 'badge-warning'} routine-flag`, flag.text);
    badge.dataset.flag = flag.code;
    title.append(badge);
  }
  node.append(title, el('small', 'routine-origin', `${SOURCE_LABEL[item.source]} · ${item.origin}`));
  if (item.detail) node.title = item.detail;
  return node;
}

function lastCell(item) {
  const node = cell('Letzter Lauf');
  node.append(el('span', '', item.lastText));
  if (RESULT[item.result]) {
    const [cls, text] = RESULT[item.result];
    node.append(el('span', `${cls} routine-result`, text));
  }
  return node;
}

export function mountRoutines(root, {client = createRoutinesClient(), confirmRun = message => globalThis.confirm(message)} = {}) {
  const $ = selector => root.querySelector(selector);
  const view = {items: [], sources: null, source: 'all', kind: 'all', query: ''};
  const say = message => { $('#routine-status').textContent = message; };

  function renderSources() {
    for (const key of SOURCE_KEYS) {
      const card = $(`[data-source-card="${key}"]`), source = view.sources?.[key];
      if (!card || !source) continue;
      card.dataset.state = source.state;
      card.querySelector('[data-source-state]').textContent = sourceCardText(source);
      const note = card.querySelector('[data-source-note]');
      note.textContent = source.state === 'partial' ? source.reason : source.note || '';
      note.hidden = !note.textContent;
    }
  }

  function toggleControl(item) {
    if (!item.controls.toggle) {
      const node = el('span', 'routine-state is-readonly', item.active ? 'Aktiv' : 'Pausiert');
      node.append(el('small', '', 'nur lesbar'));
      return node;
    }
    const button = el('button', 'btn btn-sm routine-toggle', item.active ? 'Aktiv' : 'Pausiert');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(item.active));
    button.title = item.active ? 'Pausieren' : 'Aktivieren';
    button.addEventListener('click', () => act(item, item.controls.toggle, item.active ? 'pausiert' : 'aktiviert'));
    return button;
  }

  function actionButtons(item) {
    const node = cell('Aktion', 'routine-actions');
    const add = (text, control, done, ask) => {
      const button = el('button', 'btn btn-sm', text);
      button.type = 'button';
      button.addEventListener('click', () => { if (!ask || confirmRun(ask)) act(item, control, done); });
      node.append(button);
    };
    if (item.controls.run) add('Jetzt ausführen', item.controls.run, 'gestartet; das Ergebnis erscheint nach dem Lauf', `„${item.name}“ jetzt ausführen?`);
    if (item.controls.complete) add('Erledigt', item.controls.complete, 'als erledigt gemeldet');
    if (!node.children.length) node.append(el('span', 'routine-none', 'Keine Aktion'));
    return node;
  }

  function row(item) {
    const node = el('article', 'routine-row');
    node.setAttribute('role', 'row');
    node.dataset.id = item.id;
    node.dataset.source = item.dataSource;
    node.dataset.origin = item.source;
    const planung = cell('Planung'); planung.textContent = item.schedule;
    const next = cell('Nächster Lauf'); next.textContent = item.nextText;
    const toggle = cell('Run-Schalter'); toggle.append(toggleControl(item));
    node.append(nameCell(item), planung, next, lastCell(item), toggle, actionButtons(item));
    return node;
  }

  function render() {
    const list = $('#routine-list');
    list.replaceChildren();
    const items = filterRoutines(view.items, view);
    $('#routine-count').textContent = `${items.length} ${items.length === 1 ? 'Eintrag' : 'Einträge'}`;
    const source = view.sources?.[view.source];
    if (!items.length) {
      list.append(el('p', 'routine-empty', source?.state === 'unavailable'
        ? `${SOURCE_LABEL[view.source]}: nicht erreichbar: ${source.reason}`
        : 'Keine Einträge für diese Auswahl.'));
      return;
    }
    items.forEach(item => list.append(row(item)));
  }

  async function load() {
    say('Quellen werden geprüft…');
    const {items, sources} = await client.load();
    Object.assign(view, {items, sources});
    const reachable = SOURCE_KEYS.filter(key => sources[key].state !== 'unavailable').length;
    say(`${reachable} von ${SOURCE_KEYS.length} Quellen erreichbar, ${items.length} Einträge gelesen.`);
    renderSources(); render();
  }

  async function act(item, control, done) {
    say(`„${item.name}“ wird ausgeführt…`);
    try { await client.run(control); } catch (error) { say(`„${item.name}“: ${error.message}. Es wurde nichts geändert.`); return; }
    await load();
    say(`„${item.name}“ ${done}.`);
  }

  const sync = () => {
    Object.assign(view, {source: $('#routine-source-filter').value, kind: $('#routine-kind-filter').value, query: $('#routine-search').value});
    render();
  };
  $('#routine-source-filter').addEventListener('change', sync);
  $('#routine-kind-filter').addEventListener('change', sync);
  $('#routine-search').addEventListener('input', sync);
  $('#routine-refresh').addEventListener('click', load);
  return load();
}
