// User-Inbox-Vertrag: BACH system/gui/api/user_inbox.py (GET/PATCH /api/user-inbox).
export const INBOX_STATUSES = ['all', 'unread', 'read', 'archived'];
export const INBOX_LIMIT = 50;
export const INBOX_TARGET = '/agenten/sessions';

// user_inbox.py:19-20: status Literal, search max_length=300.
export function readInboxState(search = '') {
  const params = new URLSearchParams(search);
  const status = INBOX_STATUSES.includes(params.get('status')) ? params.get('status') : 'all';
  return {status, search: (params.get('search') || '').slice(0, 300)};
}

// user_inbox.py:19-23: status, search, offset>=0, limit 1..100.
export function inboxQuery(state, offset = 0, limit = INBOX_LIMIT) {
  if (!INBOX_STATUSES.includes(state.status) || String(state.search || '').length > 300 ||
      !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Ungültige Inbox-Filter.');
  return new URLSearchParams({status: state.status, search: state.search || '', offset: String(offset), limit: String(limit)});
}

export function writeInboxUrl(href, state) {
  const url = new URL(href);
  url.searchParams.set('tab', 'inbox');
  if (state.status !== 'all') url.searchParams.set('status', state.status); else url.searchParams.delete('status');
  if (state.search) url.searchParams.set('search', state.search); else url.searchParams.delete('search');
  return url;
}

// Alter Link /user-inbox (und BACH-Kette /messages -> 307 /user-inbox): nur status/search werden uebernommen.
export function redirectTarget(search = '', hash = '') {
  const url = writeInboxUrl('http://x' + INBOX_TARGET, readInboxState(search));
  return url.pathname + url.search + (hash || '');
}

// user_inbox.py:44-47: Antwortform der Liste.
export function readInboxPage(data) {
  if (!data || data.schema !== 'bach.user-inbox.v1' || data.recipient !== 'user' || !Array.isArray(data.messages) ||
      !Number.isSafeInteger(data.total) || data.total < 0 ||
      !Number.isSafeInteger(data.unread) || data.unread < 0 || typeof data.has_more !== 'boolean')
    throw new Error('Die Inbox-Antwort ist ungültig.');
  if (data.messages.some(r => !Number.isSafeInteger(r.id) || String(r.recipient).trim().toLowerCase() !== 'user'))
    throw new Error('Die Inbox enthält eine unpassende Nachricht.');
  return {messages: data.messages, total: data.total, unread: data.unread, hasMore: data.has_more};
}

// user_inbox.py:51-64: PATCH mit expected_status, 409 bei Konflikt, 404 unbekannt.
export function changeBody(row, status) {
  if (!row || !['unread', 'read', 'archived'].includes(row.status) || !['unread', 'read', 'archived'].includes(status))
    throw new Error('Ungültige Statusänderung.');
  return {status, expected_status: row.status};
}
export function changeError(code) {
  if (code === 409) return 'Der Status hat sich geändert. Bitte aktualisieren; es wurde nichts überschrieben.';
  if (code === 404) return 'Die Nachricht existiert nicht mehr. Bitte aktualisieren.';
  return 'Nachrichtenstatus konnte nicht geändert werden.';
}
export function confirmChange(data, id, status) {
  if (!data || data.id !== id || data.recipient !== 'user' || data.status !== status)
    throw new Error('Die Statusänderung konnte nicht bestätigt werden.');
}

// "Task erzeugen ohne Start": nur Vorbelegung des bestehenden Formulars (POST /api/tasks, status pending, keine Lease).
export function taskDraft(row) {
  const sender = String(row?.sender || 'Unbekannt');
  const title = String(row?.subject || '').trim() || 'Nachricht von ' + sender;
  const source = 'Quelle: Inbox-Nachricht #' + row.id + ' von ' + sender + (row.created_at ? ' (' + row.created_at + ')' : '');
  return {title: title.slice(0, 500), description: (String(row.body || '').trim() + '\n\n' + source).trim()};
}
