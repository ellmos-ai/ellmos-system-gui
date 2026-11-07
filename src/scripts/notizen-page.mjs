// /notizen: Anzeige und Bedienung der llm-note-Notizen (PB-11, #3994). Logik und Backend-Vertrag: src/lib/notes-client.mjs.
import {archiveNote, createNote, findBrowserNotes, importBrowserNotes, loadNotes, pendingNotice, unarchiveNote} from '../lib/notes-client.mjs';

const state = {kind: new URLSearchParams(location.search).get('kind') || 'all', search: '', includeArchived: false};
const $ = id => document.getElementById(id);
const KIND_LABEL = {note: '💭 Gedanken', logbook: '📓 Logbuch'};
let searchTimer;
let requestId = 0;

function setStatus(text, isError = false) {
  const el = $('notes-status');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  el.style.color = isError ? 'var(--danger, #c0392b)' : 'var(--text-muted)';
}

function setNotice(text) {
  const node = $('notes-notice');
  if (!node) return;
  node.textContent = text;
  node.hidden = !text;
}

function el(tag, text, style) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (style) node.style.cssText = style;
  return node;
}

function badge(text) {
  const node = el('span', text);
  node.className = 'badge';
  return node;
}

function renderEntry(entry) {
  const article = el('article', undefined, 'padding:0.85rem;border-radius:10px;border:1px solid var(--border);background:var(--bg-panel);' + (entry.is_archived ? 'opacity:0.65;' : ''));
  const head = el('div', undefined, 'display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin-bottom:0.35rem;');
  head.append(el('strong', `${KIND_LABEL[entry.entry_type] || '📝 Notiz'} · ${entry.title || '(ohne Titel)'}`));
  const badges = el('span');
  badges.append(badge(entry.category || 'Notiz'));
  if (entry.is_archived) badges.append(badge('archiviert'));
  head.append(badges);
  article.append(head, el('p', entry.content, 'margin:0 0 0.35rem 0;font-size:0.85rem;color:var(--text);white-space:pre-wrap;'));
  const foot = el('div', undefined, 'display:flex;justify-content:space-between;align-items:center;gap:0.5rem;');
  foot.append(el('small', entry.created_at || '', 'color:var(--text-muted);font-size:0.75rem;'));
  const button = el('button', entry.is_archived ? '↩ Wiederherstellen' : '🗄 Archivieren');
  button.type = 'button';
  button.className = 'btn btn-secondary btn-sm';
  button.addEventListener('click', () => changeArchive(entry, button));
  foot.append(button);
  article.append(foot);
  return article;
}

async function changeArchive(entry, button) {
  button.disabled = true;
  try {
    await (entry.is_archived ? unarchiveNote(entry.id) : archiveNote(entry.id));
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
    button.disabled = false;
  }
}

async function refresh() {
  const mine = ++requestId;
  const list = $('notes-list-container'), count = $('notes-count-badge');
  try {
    const data = await loadNotes(state);
    if (mine !== requestId) return;
    setStatus('');
    setNotice(pendingNotice(data));
    count.textContent = `${data.entries.length} Einträge${data.stats.archived ? ` · ${data.stats.archived} archiviert` : ''}`;
    list.replaceChildren(...(data.entries.length ? data.entries.map(renderEntry)
      : [el('p', 'Keine Notizen für diesen Filter.', 'margin:0;color:var(--text-muted);font-size:0.85rem;')]));
  } catch (error) {
    if (mine !== requestId) return;
    count.textContent = 'nicht verfügbar';
    list.replaceChildren();
    setStatus(error.message, true);
  }
}

function markActiveFilter() {
  document.querySelectorAll('.note-filter-btn').forEach(b => {
    const active = b.getAttribute('data-note-kind') === state.kind;
    b.classList.toggle('btn-primary', active);
    b.classList.toggle('btn-secondary', !active);
  });
}

document.querySelectorAll('.note-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => { state.kind = btn.getAttribute('data-note-kind') || 'all'; markActiveFilter(); refresh(); });
});
markActiveFilter();

$('notes-search-input')?.addEventListener('input', event => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.search = event.target.value || ''; refresh(); }, 250);
});

$('notes-archive-toggle')?.addEventListener('change', event => { state.includeArchived = event.target.checked; refresh(); });

$('note-create-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const status = $('note-save-status');
  try {
    await createNote({
      kind: $('note-kind-select')?.value, tag: $('note-tag-input')?.value,
      title: $('note-title-input')?.value, body: $('note-body-input')?.value,
    });
    $('note-title-input').value = '';
    $('note-body-input').value = '';
    status.textContent = 'Gespeichert.';
    await refresh();
  } catch (error) {
    status.textContent = error.message;
  }
});

// Früher lagen Notizen nur im Browser (localStorage). Einmaliges, vom Nutzer bestätigtes Übernehmen.
function offerBrowserNotes() {
  const found = findBrowserNotes();
  const box = $('notes-import');
  if (!found.length || !box) return;
  $('notes-import-text').textContent = `${found.length} Notizen aus früheren Browser-Sitzungen gefunden (ohne die zwei Beispielnotizen). `
    + 'Übernehmen legt sie in den Notizen an; das ursprüngliche Datum wird nicht übernommen. Danach werden sie aus dem Browser entfernt.';
  box.hidden = false;
  $('notes-import-later')?.addEventListener('click', () => { box.hidden = true; });
  $('notes-import-button')?.addEventListener('click', async event => {
    event.target.disabled = true;
    const {imported, failed} = await importBrowserNotes();
    $('notes-import-text').textContent = failed
      ? `${imported} übernommen, ${failed} nicht übernommen (sie bleiben im Browser). Bitte später erneut versuchen.`
      : `${imported} Notizen übernommen.`;
    event.target.hidden = !failed;
    event.target.disabled = false;
    await refresh();
  });
}

offerBrowserNotes();
refresh();
