// Browser wiring for the "Zuordnung" tab of /skills (P-1963-P2). DOM via createElement/textContent only; no inline handlers.
// The draft lives in memory only: the database behind /api/skills-board/hierarchy is the single store.
import {GROUPS, createHierarchyClient, cloneLists, diffAssignments, hasChanges, loadedView, derivedExpertNote} from './hierarchy-assignment.mjs';

const root = document.getElementById('assignment-panel');
if (root) {
  const client = createHierarchyClient();
  const part = id => root.querySelector('[data-part="' + id + '"]');
  const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined && text !== null) n.textContent = text; return n; };
  const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const button = (label, handler, className) => { const b = el('button', 'btn' + (className ? ' ' + className : ''), label); b.type = 'button'; b.addEventListener('click', handler); return b; };
  const MAX_AVAILABLE = 200;
  // state.view: loading | error:<kind> | empty | ready. `data` is the last parsed answer, `base` the stored lists of the selected agent.
  const state = {view: 'loading', error: null, data: null, agent: '', base: null, draft: null, preview: false, busy: false, filter: '', loaded: false, token: 0};
  const names = (group, ids) => ids.map(id => (state.data.items[group].find(i => i.id === id) || {name: id}).name + ' (' + id + ')');

  function status(message, problem) { const n = part('status'); n.textContent = message || ''; n.className = problem ? 'as-problem' : 'as-muted'; }

  function setDraftFor(agentId) {
    state.agent = agentId;
    state.base = cloneLists(state.data.assignments[agentId]);
    state.draft = cloneLists(state.base);
    state.preview = false;
  }

  function add(group, id) { if (!state.draft[group].includes(id)) state.draft[group].push(id); state.preview = false; render(); focusItem(group, id); }
  function remove(group, id) { state.draft[group] = state.draft[group].filter(i => i !== id); state.preview = false; render(); focusItem(group, id); }
  function focusItem(group, id) {
    const target = root.querySelector('[data-group="' + group + '"][data-id="' + CSS.escape(id) + '"] button') || root.querySelector('[data-part="agent"]');
    if (target) target.focus();
  }

  function itemRow(group, item, assigned) {
    const li = el('li', 'as-item'); li.dataset.group = group; li.dataset.id = item.id;
    const text = el('span', 'as-name', item.name); text.title = item.description || '';
    li.append(text, el('span', 'as-id as-muted', item.id));
    li.append(assigned ? button('Entfernen', () => remove(group, item.id)) : button('Zuordnen', () => add(group, item.id)));
    li.querySelector('button').setAttribute('aria-label', (assigned ? 'Entfernen: ' : 'Zuordnen: ') + item.name);
    if (!assigned && state.data.writable) {
      li.draggable = true;
      li.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', group + '\n' + item.id); event.dataTransfer.effectAllowed = 'move'; });
    }
    return li;
  }

  function groupBox(group) {
    const {key, label} = group;
    const box = el('section', 'as-group'); box.setAttribute('aria-labelledby', 'as-h-' + key);
    box.append(Object.assign(el('h3', null, label), {id: 'as-h-' + key}));
    const assignedIds = new Set(state.draft[key]);
    const lookup = id => state.data.items[key].find(i => i.id === id) || {id, name: id, description: ''};
    const assignedList = el('ul', 'as-list'); assignedList.setAttribute('aria-label', label + ': zugeordnet');
    for (const id of [...assignedIds].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1)) assignedList.append(itemRow(key, lookup(id), true));
    if (!assignedIds.size) assignedList.append(el('li', 'as-muted', 'Nichts zugeordnet.'));
    const query = state.filter.trim().toLocaleLowerCase('de');
    const free = state.data.items[key].filter(i => !assignedIds.has(i.id) && (!query || (i.name + ' ' + i.id).toLocaleLowerCase('de').includes(query)));
    const freeList = el('ul', 'as-list'); freeList.setAttribute('aria-label', label + ': verfügbar');
    for (const item of free.slice(0, MAX_AVAILABLE)) freeList.append(itemRow(key, item, false));
    if (!free.length) freeList.append(el('li', 'as-muted', state.data.items[key].length ? 'Keine passenden Einträge.' : 'Die Quelle kennt keine ' + label + '.'));
    if (free.length > MAX_AVAILABLE) freeList.append(el('li', 'as-muted', (free.length - MAX_AVAILABLE) + ' weitere – Suche eingrenzen.'));
    if (state.data.writable) {
      assignedList.addEventListener('dragover', event => event.preventDefault());
      assignedList.addEventListener('drop', event => {
        event.preventDefault();
        const [g, id] = (event.dataTransfer.getData('text/plain') || '').split('\n');
        if (g === key && state.data.items[key].some(i => i.id === id)) add(key, id);
      });
    }
    const cols = el('div', 'as-cols');
    const left = el('div'); left.append(el('h4', null, 'Zugeordnet (' + assignedIds.size + ')'), assignedList);
    const right = el('div'); right.append(el('h4', null, 'Verfügbar (' + free.length + ')'), freeList);
    cols.append(left, right); box.append(cols);
    return box;
  }

  function renderPreview() {
    const box = clear(part('preview')); box.hidden = !state.preview;
    if (!state.preview) return;
    const diff = diffAssignments(state.base, state.draft);
    box.append(el('h3', null, 'Vorschau der Änderung für ' + (state.data.items.agents.find(a => a.id === state.agent) || {name: state.agent}).name));
    if (!hasChanges(diff)) { box.append(el('p', 'as-muted', 'Keine Änderung gegenüber dem gespeicherten Stand.')); return; }
    const ul = el('ul');
    for (const {key, label} of GROUPS) {
      for (const text of names(key, diff[key].added)) ul.append(el('li', 'as-added', '+ ' + label + ': ' + text));
      for (const text of names(key, diff[key].removed)) ul.append(el('li', 'as-removed', '− ' + label + ': ' + text));
    }
    box.append(ul, el('p', 'as-muted', 'Beim Speichern wird die Reihenfolge der Zuordnungen dieses Agenten alphabetisch neu vergeben; die Anzeige verwendet diese Reihenfolge ohnehin schon. Nichts wird gespeichert, bevor Sie bestätigen.'));
    const confirmButton = button('Bestätigen und speichern', save, 'btn-primary'); confirmButton.disabled = state.busy;
    box.append(confirmButton, button('Zurück zur Bearbeitung', () => { state.preview = false; render(); }));
    box.scrollIntoView({block: 'nearest'});
  }

  async function save() {
    if (state.busy) return;
    state.busy = true; status('Speichern: aktueller Stand wird geprüft, geschrieben und erneut gelesen …'); render();
    const agent = state.agent;
    try {
      const {after, verification, summary} = await client.save(agent, state.base, state.draft);
      state.data = after;
      if (after.assignments[agent]) setDraftFor(agent);
      if (verification.ok) status('Gespeichert und per Lesen bestätigt (' + summary.inserted + ' neu, ' + summary.updated + ' geändert, ' + summary.deleted + ' entfernt).');
      else {
        const lines = verification.problems.map(p => p.group + ': fehlt ' + (p.missing.join(', ') || '–') + ' · unerwartet ' + (p.extra.join(', ') || '–'));
        status('Abweichung beim Zurücklesen – die Datenbank zeigt nicht, was gespeichert werden sollte: ' + lines.join(' | ') + ' ' + derivedExpertNote(verification.problems), true);
      }
    } catch (error) {
      status('Nicht gespeichert: ' + error.message, true);
      if (error.kind === 'conflict') await load();
    } finally { state.busy = false; render(); }
  }

  function renderStatusView() {
    const box = clear(part('view')); box.hidden = false;
    const v = state.view;
    if (v === 'loading') box.append(el('p', 'as-muted', 'Zuordnungen werden geladen …'));
    else if (v === 'empty') box.append(el('p', 'as-muted', 'Die Quelle meldet keine Agenten. Das ist ein leerer Bestand, kein Fehler.'));
    else if (v === 'source-unavailable') box.append(el('p', 'as-problem', 'Datenquelle nicht verfügbar: die Antwort enthält keine Agenten und stammt nicht aus der Datenbank (_meta.source ' + (state.data.source ?? 'fehlt') + ').'), el('p', 'as-muted', 'Nur Lesen. Das ist ein Fehler, kein leerer Bestand; es wird nichts gespeichert.'));
    else if (v.startsWith('error:')) {
      const kind = v.slice(6);
      const title = {unavailable: 'Zuordnung nicht verfügbar: dieses System bietet den Adapter nicht an.', auth: 'Keine Berechtigung: Geräteanmeldung fehlt oder ungültig.', 'table-missing': 'Zuordnungstabelle nicht verfügbar (Tabelle fehlt im Backend).',
        invalid: 'Anfrage abgelehnt.', network: 'Backend nicht erreichbar.', contract: 'Unerwartete Antwort der Quelle.'}[kind] || 'Fehler beim Laden.';
      box.append(el('p', 'as-problem', title), el('p', 'as-muted', state.error.message + ' – das ist ein Fehler, kein leerer Bestand.'));
    } else box.hidden = true;
  }

  function render() {
    renderStatusView();
    const ready = state.view === 'ready';
    part('workspace').hidden = !ready;
    if (!ready) return;
    const select = part('agent');
    if (select.options.length !== state.data.items.agents.length || select.dataset.source !== String(state.data.items.agents.map(a => a.id))) {
      clear(select);
      for (const a of state.data.items.agents) select.append(Object.assign(el('option', null, a.name + ' (' + a.id + ')'), {value: a.id}));
      select.dataset.source = String(state.data.items.agents.map(a => a.id));
    }
    select.value = state.agent; select.disabled = state.busy;
    part('readonly').hidden = state.data.writable;
    if (!state.data.writable) clear(part('readonly')).append(el('p', 'as-problem', 'Nur Lesen: die Quelle meldet ihren Stand nicht aus der Datenbank (_meta.source ' + (state.data.source ?? 'fehlt') + '). Speichern ist gesperrt, damit nichts Ungeladenes überschrieben wird.'));
    const groups = clear(part('groups'));
    for (const group of GROUPS) groups.append(groupBox(group));
    const diff = diffAssignments(state.base, state.draft);
    const review = part('review'); review.disabled = state.busy || !state.data.writable || !hasChanges(diff);
    part('reset').disabled = state.busy || !hasChanges(diff);
    renderPreview();
  }

  async function load() {
    const token = ++state.token;
    state.view = 'loading'; state.error = null; render();
    try {
      if (await client.declared() === 'undeclared') {
        const unavailable = Object.assign(new Error('Der Adapter deklariert die Route /api/skills-board/hierarchy nicht (GET und PUT).'), {kind: 'unavailable'});
        throw unavailable;
      }
      const data = await client.load();
      if (token !== state.token) return;
      state.data = data;
      const view = loadedView(data);
      if (view !== 'ready') { state.view = view; render(); return; }
      setDraftFor(data.items.agents.some(a => a.id === state.agent) ? state.agent : data.items.agents[0].id);
      state.view = 'ready';
    } catch (error) {
      if (token !== state.token) return;
      state.view = 'error:' + (error.kind || 'server'); state.error = error;
    }
    render();
  }

  part('agent').addEventListener('change', event => {
    if (hasChanges(diffAssignments(state.base, state.draft)) && !window.confirm('Ungespeicherte Änderungen für diesen Agenten verwerfen?')) { event.target.value = state.agent; return; }
    setDraftFor(event.target.value); render();
  });
  part('filter').addEventListener('input', event => { state.filter = event.target.value; render(); });
  part('review').addEventListener('click', () => { state.preview = true; render(); });
  part('reset').addEventListener('click', () => { setDraftFor(state.agent); status(''); render(); });
  part('reload').addEventListener('click', () => {
    if (state.draft && hasChanges(diffAssignments(state.base, state.draft)) && !window.confirm('Ungespeicherte Änderungen verwerfen und neu laden?')) return;
    status(''); load();
  });

  // Tabs (Anleitungen | Zuordnung): arrow keys move between the tabs, the hash #zuordnung selects the second one.
  const tabs = [...document.querySelectorAll('[data-skills-tab]')];
  const panels = {anleitungen: document.getElementById('skills-panel'), zuordnung: root};
  function selectTab(name, focus) {
    for (const tab of tabs) { const on = tab.dataset.skillsTab === name; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; if (on && focus) tab.focus(); }
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name;
    document.getElementById('board-actions').hidden = name !== 'anleitungen';
    try { history.replaceState(null, '', name === 'zuordnung' ? '#zuordnung' : location.pathname + location.search); } catch { /* not essential */ }
    if (name === 'zuordnung' && !state.loaded) { state.loaded = true; load(); }
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => selectTab(tab.dataset.skillsTab, false));
    tab.addEventListener('keydown', event => {
      const move = {ArrowRight: 1, ArrowLeft: -1}[event.key];
      if (move) { event.preventDefault(); selectTab(tabs[(index + move + tabs.length) % tabs.length].dataset.skillsTab, true); }
      if (event.key === 'Home') { event.preventDefault(); selectTab(tabs[0].dataset.skillsTab, true); }
      if (event.key === 'End') { event.preventDefault(); selectTab(tabs[tabs.length - 1].dataset.skillsTab, true); }
    });
  }
  selectTab(location.hash === '#zuordnung' ? 'zuordnung' : 'anleitungen', false);
}
