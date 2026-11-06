import {parseChatParams, newChatId, sendChatMessage, describeSendError, forkSession, resumeWorker, isProblem, continueMode, ChatSendError} from '../lib/chat-client.mjs';
import {loadSessionPage, loadSession} from '../lib/transcript-history.mjs';

const $ = id => document.getElementById(id);
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = String(text); if (cls) n.className = cls; return n; };
const stamp = value => { const d = new Date(value ?? ''); return Number.isFinite(d.getTime()) ? d.toLocaleString('de-DE', {dateStyle: 'short', timeStyle: 'short'}) : 'Zeit nicht erfasst'; };
const SOURCE_LABEL = {user: 'Ich', buddha: 'Buddha', worker: 'Worker', system: 'System'};

function initialize() {
  const log = $('chat-messages'), input = $('chat-input'), form = $('chat-composer'), sendBtn = $('chat-send-btn');
  const statusEl = $('chat-status'), slotSelect = $('chat-slot-select'), listEl = $('chat-history-list');
  if (!log || !form) return;
  const params = parseChatParams(location.search);
  const state = {source: 'user', problems: false, offset: 0, rows: [], counts: null, hasMore: false, slot: 'buddha_chat',
    chatId: '', viewing: null, epoch: 0, listRequest: 0};

  // The slot chosen by a deep link joins the list of slots (the backend decides whether it is usable).
  const wanted = params.slotId ?? params.agent;
  if (wanted && ![...slotSelect.options].some(o => o.value === wanted)) slotSelect.append(new Option(wanted, wanted));
  if (wanted) state.slot = wanted;
  slotSelect.value = state.slot;
  const storageKey = () => 'bach_slot_chat_' + state.slot + '_role'; // same key the former chat page used
  const remember = () => { try { localStorage.setItem(storageKey(), state.chatId); } catch { /* storage may be off */ } };
  const remembered = () => { try { return localStorage.getItem(storageKey()) || ''; } catch { return ''; } };

  const setStatus = (text, error = false) => { statusEl.textContent = text; statusEl.dataset.error = String(error); };
  function setComposer(enabled, hint) {
    input.disabled = !enabled; sendBtn.disabled = !enabled;
    input.placeholder = enabled ? 'Nachricht eingeben oder per Diktat sprechen …' : hint;
  }

  function bubble(role, author, text, extra) {
    const div = node('div', undefined, 'chat-bubble chat-bubble-' + role);
    div.append(node('div', author, 'chat-bubble-author'));
    div.append(node('div', text, 'chat-bubble-text'));
    if (extra) div.append(extra);
    log.append(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }
  function renderMessages(messages) {
    log.replaceChildren();
    const visible = messages.filter(m => m.role !== 'tool');
    if (!visible.length) log.append(node('p', 'Keine sichtbaren Nachrichten gespeichert.', 'text-muted'));
    for (const m of visible) {
      const failed = m.answer_status === 'failed';
      const b = bubble(m.role === 'user' ? 'user' : 'assistant', (m.role === 'user' ? 'Du' : 'Agent') + (failed ? ' · Fehlgeschlagen' : ''), m.content || 'Kein sichtbarer Ausgabetext gespeichert.');
      if (failed) b.classList.add('chat-bubble-failed');
    }
  }
  function greeting() {
    log.replaceChildren();
    bubble('assistant', 'Buddha Chat', 'Neuer Chat. Schreib unten eine Nachricht oder wähle links einen früheren Verlauf.');
  }

  // ---- history list
  function renderCounts() {
    for (const button of document.querySelectorAll('[data-chat-source]')) {
      const key = button.dataset.chatSource;
      button.setAttribute('aria-pressed', String(key === state.source));
      button.querySelector('.chat-count').textContent = state.counts ? String(state.counts[key]) : '';
    }
  }
  function renderList() {
    renderCounts();
    listEl.replaceChildren();
    for (const row of state.rows) {
      const li = node('li');
      const button = node('button', undefined, 'chat-history-item'); button.type = 'button'; button.dataset.snapshotId = String(row.id);
      if (state.viewing?.id === row.id) button.setAttribute('aria-current', 'true');
      button.append(node('span', row.name || 'Gespeicherter Dialog', 'chat-history-name'));
      const meta = node('span', undefined, 'chat-history-meta');
      meta.append(stamp(row.created_at) + ' · ' + row.stored_message_count + ' Nachrichten' + (row.archived ? ' · archiviert' : ''));
      if (isProblem(row)) {
        const parts = [];
        if (row.failed_count > 0) parts.push(row.failed_count + (row.failed_count === 1 ? ' Fehler' : ' Fehler'));
        if (row.return_count >= 3) parts.push(row.return_count + 'x zurückgegeben');
        if (row.flapping) parts.push('wechselt hin und her');
        meta.append(node('span', parts.join(', '), 'chat-problem'));
      }
      button.append(meta);
      button.addEventListener('click', () => openSession(row.id));
      li.append(button); listEl.append(li);
    }
    $('chat-history-more').hidden = !state.hasMore;
  }
  async function refreshList(reset = true) {
    const request = ++state.listRequest;
    if (reset) { state.offset = 0; state.rows = []; }
    const note = $('chat-history-state');
    note.hidden = false; note.dataset.error = 'false'; note.textContent = 'Verläufe werden geladen …';
    try {
      const data = await loadSessionPage({offset: state.offset, limit: 25, source: state.source, problems: state.problems});
      if (request !== state.listRequest) return;
      state.rows = state.rows.concat(data.sessions); state.counts = data.source_counts ?? null; state.hasMore = data.has_more;
      state.offset = state.rows.length;
      note.hidden = state.rows.length > 0;
      if (!state.rows.length) note.textContent = state.problems ? 'Keine Verläufe mit Problemen in dieser Auswahl.' : 'Keine Verläufe in dieser Auswahl.';
      renderList();
      return data;
    } catch (error) {
      if (request !== state.listRequest) return;
      note.dataset.error = 'true'; note.textContent = 'Verläufe nicht verfügbar: ' + error.message;
      renderList();
    }
  }

  // ---- opening and continuing a stored session
  function setActions(row) {
    const bar = $('chat-session-bar'); bar.replaceChildren();
    if (!row) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.append(node('strong', row.name || 'Gespeicherter Dialog'));
    bar.append(node('span', SOURCE_LABEL[row.source] + ' · ' + stamp(row.created_at) + (row.archived ? ' · archiviert' : ''), 'text-muted'));
    const mode = continueMode(row);
    const act = (label, handler) => { const b = node('button', label, 'btn btn-secondary btn-sm'); b.type = 'button'; b.addEventListener('click', handler); bar.append(b); };
    if (mode === 'in-place') bar.append(node('span', 'Du schreibst in diesem Chat weiter.', 'text-muted'));
    if (mode === 'fork') act('Als neuen Chat fortsetzen', () => continueAsFork(row));
    if (mode === 'worker') act('Worker fortsetzen', () => continueWorker(row));
    if (mode === 'none') bar.append(node('span', 'Dieser Verlauf ist nur zum Lesen.', 'text-muted'));
  }
  async function openSession(id) {
    const epoch = ++state.epoch;
    setStatus('Verlauf wird geladen …');
    try {
      const data = await loadSession(id);
      if (epoch !== state.epoch) return;
      const row = {id, name: data.name, chat_id: data.chat_id ?? '', source: data.chat_source ?? 'system', archived: data.archived === true, created_at: data.created_at};
      state.viewing = row;
      renderMessages(data.messages); setActions(row);
      const mode = continueMode(row);
      if (mode === 'in-place') { state.chatId = row.chat_id; remember(); setComposer(true); }
      else setComposer(false, 'Zum Weiterschreiben „Als neuen Chat fortsetzen“ wählen oder links „Neuer Chat“.');
      setStatus('Verlauf geladen: ' + data.messages.filter(m => m.role !== 'tool').length + ' sichtbare Nachrichten.');
      renderList();
    } catch (error) {
      if (epoch === state.epoch) setStatus('Verlauf nicht verfügbar: ' + error.message, true);
    }
  }
  async function continueAsFork(row) {
    const chatId = newChatId(state.slot);
    setStatus('Chat wird fortgesetzt …');
    try {
      await forkSession(chatId, row.id);
      state.chatId = chatId; remember(); state.viewing = null; setActions(null); setComposer(true);
      setStatus('Als neuer Chat fortgesetzt. Du kannst weiterschreiben.');
      await refreshList();
    } catch (error) {
      setStatus(error instanceof ChatSendError ? 'Fortsetzen fehlgeschlagen' + (error.status ? ' (HTTP ' + error.status + ')' : '') + (error.reason ? ': ' + error.reason : '') : error.message, true);
    }
  }
  async function continueWorker(row) {
    if (!confirm('Den Worker „' + row.chat_id + '“ mit diesem Verlauf neu starten?')) return;
    setStatus('Worker wird fortgesetzt …');
    try { await resumeWorker(row.id, row.chat_id); setStatus('Worker „' + row.chat_id + '“ wurde mit dem Übergabezettel gestartet.'); }
    catch (error) { setStatus(error instanceof ChatSendError ? 'Worker nicht fortgesetzt' + (error.status ? ' (HTTP ' + error.status + ')' : '') + (error.reason ? ': ' + error.reason : '') : error.message, true); }
  }
  function startNewChat() {
    state.epoch++; state.viewing = null; state.chatId = newChatId(state.slot); remember();
    setActions(null); greeting(); setComposer(true); setStatus('Neuer Chat im Steckplatz „' + state.slot + '“.'); renderList(); input.focus();
  }

  // ---- sending
  let sending = false;
  async function send(text) {
    if (sending || !text) return;
    sending = true; sendBtn.disabled = true;
    const retry = log.querySelector('.chat-bubble-error'); retry?.remove();
    bubble('user', 'Du', text);
    setStatus('Sende Nachricht …');
    try {
      const answer = await sendChatMessage(text, state.chatId);
      bubble('assistant', state.slot, answer);
      setStatus('Antwort empfangen.');
      refreshList();
    } catch (error) {
      if (!(error instanceof ChatSendError)) throw error;
      const again = node('button', 'Erneut senden', 'btn btn-secondary btn-sm'); again.type = 'button';
      const shown = bubble('error', 'Fehler', describeSendError(error), again);
      shown.setAttribute('role', 'alert');
      again.addEventListener('click', () => { shown.previousElementSibling?.remove(); shown.remove(); sending = false; send(text); });
      setStatus('Senden fehlgeschlagen.', true);
    } finally { sending = false; sendBtn.disabled = input.disabled; }
  }
  form.addEventListener('submit', event => { event.preventDefault(); const text = input.value.trim(); if (!text) return; input.value = ''; send(text); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });

  // ---- controls
  for (const button of document.querySelectorAll('[data-chat-source]'))
    button.addEventListener('click', () => { state.source = button.dataset.chatSource; refreshList(); });
  $('chat-problems').addEventListener('change', event => { state.problems = event.target.checked; refreshList(); });
  $('chat-history-more').addEventListener('click', () => refreshList(false));
  $('chat-new').addEventListener('click', startNewChat);
  slotSelect.addEventListener('change', () => { state.slot = slotSelect.value; startNewChat(); });

  // ---- start: deep link first, then the remembered chat, otherwise a fresh one
  (async () => {
    const firstPage = await refreshList();
    if (params.resumeSession) { await openSession(params.resumeSession); return; }
    if (!wanted) {
      const last = remembered();
      const row = last && firstPage?.sessions.find(r => r.chat_id === last && !r.archived);
      if (row) { await openSession(row.id); return; }
    }
    startNewChat();
  })();
}

// ---- voice dictation (unchanged behaviour)
function initVoice() {
  const input = $('chat-input'), voiceBtn = $('voice-dictate-btn'), statusEl = $('chat-status');
  let recognition = null, listening = false;
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    recognition = new SpeechRec();
    recognition.continuous = false; recognition.interimResults = true;
    recognition.onresult = event => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      if (input && transcript) input.value = transcript;
    };
    recognition.onend = () => { listening = false; voiceBtn?.setAttribute('aria-pressed', 'false'); if (statusEl) statusEl.textContent = 'Diktat beendet (ellmos-voice-io).'; };
  }
  voiceBtn?.addEventListener('click', () => {
    if (typeof window.bachDictateIntoElement === 'function') { window.bachDictateIntoElement(input, voiceBtn, statusEl); return; }
    if (!recognition) { if (statusEl) statusEl.textContent = 'ellmos-voice-io: Lokaler Browser-Audio-Stream wird vorbereitet …'; return; }
    if (listening) { recognition.stop(); listening = false; voiceBtn.setAttribute('aria-pressed', 'false'); }
    else {
      recognition.lang = document.documentElement.lang || 'de-DE'; recognition.start(); listening = true;
      voiceBtn.setAttribute('aria-pressed', 'true'); if (statusEl) statusEl.textContent = 'Höre zu (ellmos-voice-io aktiv) …';
    }
  });
}

initialize();
initVoice();
