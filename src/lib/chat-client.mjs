// Chat client: talks to the routes the backend really serves (chat-control proxy, agent-history).
// No hidden queue: a message that did not reach the backend is reported as not sent, with status and reason.
const SLOT_RE = /^[A-Za-z0-9_-]{1,80}$/;
const WORKER_RE = /^[A-Za-z0-9._-]{1,64}$/;

export class ChatSendError extends Error {
  constructor(kind, status = null, reason = '') {
    super(reason || kind);
    this.kind = kind; // 'http' | 'refused' | 'network' | 'aborted' | 'empty'
    this.status = status;
    this.reason = reason;
  }
}

// Deep links: ?resume_session=<snapshot id>, ?slot_id=<slot>, ?agent=<slot or agent name>. Malformed or repeated values are ignored.
export function parseChatParams(search) {
  const params = new URLSearchParams(search);
  const one = key => { const all = params.getAll(key); return all.length === 1 ? all[0] : null; };
  const id = one('resume_session');
  const slot = one('slot_id'), agent = one('agent');
  return {
    resumeSession: id !== null && /^[1-9][0-9]{0,9}$/.test(id) && Number(id) <= 2147483647 ? Number(id) : null,
    slotId: slot !== null && SLOT_RE.test(slot) ? slot : null,
    agent: agent !== null && SLOT_RE.test(agent) ? agent : null,
  };
}

export function newChatId(slot, bytes = crypto.getRandomValues(new Uint8Array(16))) {
  if (!SLOT_RE.test(slot)) throw new Error('Ungültiger Steckplatz.');
  return `slot:${slot}:${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

async function post(url, body, signal) {
  let response;
  try {
    response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal});
  } catch (error) {
    throw new ChatSendError(error?.name === 'AbortError' ? 'aborted' : 'network', null, String(error?.message ?? ''));
  }
  let data = null;
  try { data = await response.json(); } catch { /* the status still tells the story */ }
  const reason = typeof data?.detail === 'string' ? data.detail : typeof data?.error === 'string' ? data.error : '';
  if (!response.ok) throw new ChatSendError('http', response.status, reason);
  if (data?.ok === false) throw new ChatSendError('refused', response.status, reason);
  return data ?? {};
}

export async function sendChatMessage(prompt, chatId, {signal} = {}) {
  const data = await post('/api/chat-control/chat', {prompt, chat_id: chatId}, signal);
  const answer = typeof data.answer === 'string' ? data.answer.trim() : '';
  if (!answer) throw new ChatSendError('empty', 200, '');
  return answer;
}

export const forkSession = (chatId, snapshotId, {signal} = {}) =>
  post('/api/chat-control/fork', {chat_id: chatId, snapshot_id: snapshotId}, signal);

export function resumeWorker(snapshotId, workerId, {signal, prompt} = {}) {
  if (!WORKER_RE.test(workerId)) return Promise.reject(new Error('Ungültige Worker-Kennung.'));
  const body = {worker_id: workerId};
  if (typeof prompt === 'string' && prompt.trim()) body.prompt = prompt.trim();
  return post(`/api/agent-history/sessions/${snapshotId}/resume`, body, signal);
}

export function describeSendError(error) {
  const reason = error.reason ? ` ${error.reason}.`.replace(/\.\.$/, '.') : '';
  switch (error.kind) {
    case 'http': return `Nicht gesendet (HTTP ${error.status}).${reason} Erneut senden?`;
    case 'refused': return `Nicht gesendet: das Backend hat die Nachricht abgelehnt.${reason} Erneut senden?`;
    case 'network': return 'Nicht gesendet: Verbindung zum Backend unterbrochen. Erneut senden?';
    case 'aborted': return 'Senden abgebrochen. Die Nachricht wurde nicht gesendet. Erneut senden?';
    default: return 'Das Backend hat keine Antwort geliefert. Erneut senden?';
  }
}

// A problem is visible at a glance: a failed answer, repeated returns, or flapping (return_count/flapping arrive with PB-1).
export const isProblem = row => (row.failed_count ?? 0) > 0 || (row.return_count ?? 0) >= 3 || row.flapping === true;

// How a stored session continues: in place (my current chat), as a fork into a fresh chat, as a worker restart, or not at all.
export function continueMode(row) {
  if (row.source === 'worker') return WORKER_RE.test(row.chat_id) ? 'worker' : 'none';
  if (row.source === 'system') return 'none';
  const mine = row.source === 'user' && !row.archived && (/^slot:[A-Za-z0-9_-]{1,80}:[a-f0-9]{32}$/.test(row.chat_id) || row.chat_id === 'gui-web');
  return mine ? 'in-place' : 'fork';
}
