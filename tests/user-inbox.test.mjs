import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {readInboxState, inboxQuery, writeInboxUrl, redirectTarget, readInboxPage, changeBody, changeError, confirmChange, taskDraft} from '../src/lib/user-inbox.mjs';

// Handlerantworten: tests/fixtures/user-inbox-handler.json (erzeugt aus BACH system/gui/api/user_inbox.py @ c71e4605, Zeilen 44-47 Liste, 63 PATCH).
const handler = JSON.parse(readFileSync(new URL('./fixtures/user-inbox-handler.json', import.meta.url), 'utf8'));
const row = (id, status = 'unread') => ({id, sender: 'claude', recipient: 'user', subject: `Betreff ${id}`, body: 'Text', status, created_at: '2026-10-10T10:00:00', read_at: null});
const list = (messages, extra = {}) => ({schema: 'bach.user-inbox.v1', source: 'assistant-core.messages', recipient: 'user', messages,
  total: messages.length, unread: 1, offset: 0, limit: 50, has_more: false, ...extra});

test('old /user-inbox and /messages links land on the tab and keep only status and search', () => {
  assert.equal(redirectTarget(''), '/agenten/sessions?tab=inbox');
  assert.equal(redirectTarget('?status=unread&search=rechnung%20%25&x=1'), '/agenten/sessions?tab=inbox&status=unread&search=rechnung+%25');
  assert.equal(redirectTarget('?status=deleted'), '/agenten/sessions?tab=inbox');
  assert.equal(redirectTarget('?search=a', '#m'), '/agenten/sessions?tab=inbox&search=a#m');
  assert.ok(!redirectTarget('?status=read').startsWith('/user-inbox'), 'no redirect loop');
});

test('state round-trips through the tab URL and the API query', () => {
  const state = readInboxState('?tab=inbox&status=archived&search=foo');
  assert.deepEqual(state, {status: 'archived', search: 'foo'});
  const url = writeInboxUrl('http://h/agenten/sessions?tab=inbox&status=read', {status: 'all', search: ''});
  assert.equal(url.search, '?tab=inbox');
  const q = inboxQuery(state, 50);
  assert.deepEqual(Object.fromEntries(q), {status: 'archived', search: 'foo', offset: '50', limit: '50'});
  assert.throws(() => inboxQuery({status: 'deleted', search: ''}), /Ungültige/);
  assert.throws(() => inboxQuery({status: 'all', search: 'x'.repeat(301)}), /Ungültige/);
  assert.throws(() => inboxQuery({status: 'all', search: ''}, -1), /Ungültige/);
});

test('list responses are validated like the handler returns them', () => {
  const page = readInboxPage(list([row(2), row(1, 'read')], {total: 3, has_more: true}));
  assert.equal(page.total, 3); assert.equal(page.hasMore, true); assert.equal(page.messages.length, 2);
  assert.throws(() => readInboxPage({...list([]), schema: 'x'}), /ungültig/);
  assert.throws(() => readInboxPage(list([{...row(1), recipient: 'claude'}])), /unpassende/);
  assert.throws(() => readInboxPage(null), /ungültig/);
});

test('status change sends expected_status, 409 is shown and nothing is overwritten', () => {
  assert.deepEqual(changeBody(row(5, 'unread'), 'read'), {status: 'read', expected_status: 'unread'});
  assert.throws(() => changeBody(row(5, 'deleted'), 'read'), /Ungültige/);
  assert.throws(() => changeBody(row(5), 'deleted'), /Ungültige/);
  assert.match(changeError(409), /geändert.*nichts überschrieben/);
  assert.match(changeError(404), /existiert nicht mehr/);
  assert.match(changeError(500), /konnte nicht geändert/);
  confirmChange({id: 5, recipient: 'user', status: 'read'}, 5, 'read');
  assert.throws(() => confirmChange({id: 5, recipient: 'user', status: 'unread'}, 5, 'read'), /bestätigt/);
});

test('task draft only prefills the form and keeps its source', () => {
  const d = taskDraft({...row(7), subject: 'Rechnung prüfen', body: 'Bitte bis Freitag.'});
  assert.equal(d.title, 'Rechnung prüfen');
  assert.match(d.description, /^Bitte bis Freitag\.\n\nQuelle: Inbox-Nachricht #7 von claude/);
  assert.equal(taskDraft({...row(8), subject: ''}).title, 'Nachricht von claude');
  assert.equal(taskDraft({...row(9), subject: 'x'.repeat(600)}).title.length, 500);
});

test('real handler responses pass the validators and drive status changes', () => {
  const page = readInboxPage(handler.list_all);
  assert.equal(page.unread, 1); assert.equal(page.messages.length, 2); assert.equal(page.total, 2);
  const unread = page.messages.find(m => m.status === 'unread');
  assert.deepEqual(changeBody(unread, 'read'), {status: 'read', expected_status: 'unread'});
  confirmChange(handler.patch_ok, unread.id, 'read');
  assert.equal(handler.patch_conflict.status_code, 409); assert.match(changeError(handler.patch_conflict.status_code), /nichts überschrieben/);
  assert.equal(handler.patch_missing.status_code, 404); assert.match(changeError(handler.patch_missing.status_code), /existiert nicht mehr/);
});

test('missing or invalid unread count is a contract error, never an invented zero', () => {
  const ok = handler.list_all;
  for (const unread of [undefined, null, -1, 1.5, '1', NaN]) {
    const bad = {...ok}; if (unread === undefined) delete bad.unread; else bad.unread = unread;
    assert.throws(() => readInboxPage(bad), /ungültig/, String(unread));
  }
  assert.equal(readInboxPage({...ok, unread: 0}).unread, 0);
});
