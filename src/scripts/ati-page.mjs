// Client-Logik für /ati — liest /api/ati/* und /api/scanner/status via DOM-Textknoten
const byId = (id) => document.getElementById(id);

let tasks = [];
let sessions = [];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function setStatus(text, tone = 'info') {
  const node = byId('ati-status');
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

function renderTasks() {
  const list = byId('ati-tasks-list');
  if (!list) return;
  const q = (byId('ati-search')?.value || '').trim().toLocaleLowerCase('de');
  const st = byId('ati-filter-status')?.value || '';
  const filtered = tasks.filter((t) => {
    if (st && String(t.status || '').toLowerCase() !== st) return false;
    if (!q) return true;
    return [t.tool_name, t.task_text, t.source_file, t.aufwand].some((v) => String(v || '').toLocaleLowerCase('de').includes(q));
  });
  byId('ati-count').textContent = `${filtered.length} von ${tasks.length} geladen`;
  list.replaceChildren();
  if (!filtered.length) {
    list.append(el('p', 'ati-meta', tasks.length ? 'Keine Aufgaben passen zum Filter.' : 'Keine gescannten Aufgaben vorhanden.'));
    return;
  }
  for (const t of filtered) {
    const card = el('article', 'ati-item');
    const head = el('div', 'ati-item-head');
    head.append(el('strong', '', t.task_text || `Task #${t.id ?? '?'}`));
    head.append(el('span', 'badge', t.status || 'offen'));
    card.append(head);
    const meta = [t.tool_name, t.aufwand ? `Aufwand: ${t.aufwand}` : '', t.priority_score != null ? `Prio: ${t.priority_score}` : ''].filter(Boolean);
    if (meta.length) card.append(el('p', 'ati-meta', meta.join(' · ')));
    if (t.source_file) card.append(el('p', 'ati-meta', `${t.source_file}${t.line_number ? `:${t.line_number}` : ''}`));
    list.append(card);
  }
}

function renderSessions() {
  const list = byId('ati-sessions-list');
  if (!list) return;
  list.replaceChildren();
  if (!sessions.length) {
    list.append(el('p', 'ati-meta', 'Keine ATI-Sitzungen dokumentiert.'));
    return;
  }
  for (const s of sessions) {
    const card = el('article', 'ati-item');
    card.append(el('strong', '', s.session_id || `Sitzung #${s.id ?? '?'}`));
    card.append(el('p', 'ati-meta', `Start: ${s.started_at || '–'} · Erledigt: ${s.tasks_completed ?? 0} · Neu: ${s.tasks_created ?? 0}`));
    if (s.summary) card.append(el('p', 'ati-meta', s.summary));
    list.append(card);
  }
}

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || body.error || `HTTP ${res.status}`);
  return body;
}

async function loadAti() {
  setStatus('Lade ATI-Statistiken und Scanner-Daten …');
  try {
    const [statsData, tasksData, sessionsData, scanData] = await Promise.all([
      fetch('/api/ati/stats', { method: 'GET' }).then(readJson),
      fetch('/api/ati/tasks', { method: 'GET' }).then(readJson),
      fetch('/api/ati/sessions', { method: 'GET' }).then(readJson),
      fetch('/api/scanner/status', { method: 'GET' }).then(readJson),
    ]);
    tasks = Array.isArray(tasksData.tasks) ? tasksData.tasks : [];
    sessions = Array.isArray(sessionsData.sessions) ? sessionsData.sessions : [];

    byId('ati-kpi-total').textContent = String(statsData.total_tasks ?? scanData.total_tasks ?? tasks.length);
    byId('ati-kpi-open').textContent = String(statsData.open_tasks ?? '–');
    byId('ati-kpi-tools').textContent = String(statsData.tools_scanned ?? scanData.total_tools ?? '–');
    const last = scanData.last_run || {};
    byId('ati-kpi-last').textContent = last.finished_at ? String(last.finished_at).slice(0, 10) : '–';
    byId('ati-kpi-found').textContent = last.tasks_found != null ? `${last.tasks_found} Treffer (${last.tools_scanned ?? 0} Tools)` : 'Kein letzter Lauf';

    renderTasks();
    renderSessions();
    setStatus(`ATI-Daten geladen: ${statsData.open_tasks ?? 0} offene Aufgaben aus ${statsData.tools_scanned ?? 0} gescannten Tools.`);
  } catch (err) {
    setStatus(`ATI-Daten konnten nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

byId('ati-refresh')?.addEventListener('click', () => loadAti());
byId('ati-search')?.addEventListener('input', () => renderTasks());
byId('ati-filter-status')?.addEventListener('change', () => renderTasks());

loadAti();
