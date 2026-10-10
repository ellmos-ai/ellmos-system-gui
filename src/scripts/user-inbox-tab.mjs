import {INBOX_LIMIT, readInboxState, inboxQuery, writeInboxUrl, readInboxPage, changeBody, changeError, confirmChange, taskDraft} from '../lib/user-inbox.mjs';
const el = id => document.getElementById(id);
const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
function initialize() {
  if (!el('inbox-panel')) return;
  const initial = readInboxState(location.search);
  let offset = 0, selected = null, busy = false, generation = 0, loaded = false;
  el('inbox-status').value = initial.status; el('inbox-search').value = initial.search;
  const state = () => ({status: el('inbox-status').value, search: el('inbox-search').value.trim()});
  const error = text => { el('inbox-error').textContent = text; el('inbox-error').hidden = !text; };
  function display(row) {
    selected = row;
    el('inbox-detail-title').textContent = row ? (row.subject || 'Ohne Betreff') : 'Nachricht auswählen';
    el('inbox-detail-meta').textContent = row ? [row.sender || 'Unbekannter Absender', row.created_at || '', row.status].join(' · ') : '';
    el('inbox-body').textContent = row ? (row.body || '') : '';
    el('inbox-actions').hidden = !row;
    if (row) {
      el('inbox-toggle-read').textContent = row.status === 'unread' ? 'Als gelesen markieren' : 'Als ungelesen markieren';
      el('inbox-archive').hidden = row.status === 'archived';
    }
    for (const b of el('inbox-list').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Boolean(row && Number(b.dataset.id) === row.id)));
  }
  async function load() {
    const request = ++generation;
    error(''); busy = true; loaded = true;
    el('inbox-back').disabled = true; el('inbox-next').disabled = true;
    try {
      const response = await fetch('/api/user-inbox?' + inboxQuery(state(), offset));
      if (!response.ok) throw new Error('Nachrichten konnten nicht geladen werden.');
      const page = readInboxPage(await response.json());
      if (request !== generation) return;
      el('inbox-list').replaceChildren();
      for (const row of page.messages) {
        const button = node('button', ''); button.type = 'button'; button.className = 'inbox-message'; button.dataset.id = String(row.id);
        button.append(node('strong', row.subject || 'Ohne Betreff'), node('small', [row.sender || 'Unbekannt', row.created_at || '', row.status].join(' · ')));
        button.addEventListener('click', () => display(row)); el('inbox-list').append(button);
      }
      if (!page.messages.length) el('inbox-list').append(node('p', 'Keine Nachrichten für diese Auswahl.'));
      el('inbox-count').textContent = page.total + ' Nachrichten · ' + page.unread + ' ungelesen';
      el('inbox-page').textContent = 'Seite ' + (Math.floor(offset / INBOX_LIMIT) + 1);
      el('inbox-back').disabled = offset === 0; el('inbox-next').disabled = !page.hasMore;
      display(selected ? page.messages.find(r => r.id === selected.id) || null : null);
    } catch (e) {
      if (request !== generation) return;
      el('inbox-list').replaceChildren(); display(null);
      el('inbox-count').textContent = 'Inbox nicht verfügbar'; error(e.message);
    } finally { if (request === generation) busy = false; }
  }
  function filtersChanged() {
    offset = 0; selected = null;
    history.replaceState(null, '', writeInboxUrl(location.href, state()));
    load();
  }
  async function change(status) {
    if (!selected || busy) return;
    busy = true; error('');
    const row = selected;
    for (const b of el('inbox-actions').querySelectorAll('button')) b.disabled = true;
    try {
      const response = await fetch('/api/user-inbox/' + row.id, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(changeBody(row, status))});
      if (!response.ok) throw new Error(changeError(response.status));
      confirmChange(await response.json(), row.id, status);
      busy = false; await load();
    } catch (e) { error(e.message); }
    finally { busy = false; for (const b of el('inbox-actions').querySelectorAll('button')) b.disabled = false; }
  }
  el('inbox-status').addEventListener('change', filtersChanged);
  el('inbox-search-form').addEventListener('submit', e => { e.preventDefault(); filtersChanged(); });
  el('inbox-back').addEventListener('click', () => { offset = Math.max(0, offset - INBOX_LIMIT); load(); });
  el('inbox-next').addEventListener('click', () => { offset += INBOX_LIMIT; load(); });
  el('inbox-toggle-read').addEventListener('click', () => change(selected.status === 'unread' ? 'read' : 'unread'));
  el('inbox-archive').addEventListener('click', () => change('archived'));
  // Nur Vorbelegung des bestehenden Task-Formulars (POST /api/tasks, status pending); kein Workerstart, keine Lease.
  el('inbox-make-task').addEventListener('click', () => {
    if (!selected) return;
    const dialog = el('inbox-task-create'), form = dialog.querySelector('form'), draft = taskDraft(selected);
    form.elements.title.value = draft.title; form.elements.description.value = draft.description;
    document.querySelector('[data-task-create-open="inbox-task-create"]').click();
  });
  document.addEventListener('bach:inbox-show', () => { if (!loaded) load(); });
  document.addEventListener('bach:inbox-refresh', load);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, {once: true}); else initialize();
