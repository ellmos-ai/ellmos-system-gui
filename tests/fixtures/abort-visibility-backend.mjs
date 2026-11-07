// Injected backend answers for the PB-4 browser test and the before/after screenshots (synthetic data only).
const task = (id, title, status = 'pending') => ({id, title, status, priority: 'P2', assigned_to: 'BACH', description: 'Beschreibung ' + id});
export const TASKS = [task(101, 'Schleife mit Flattern'), task(102, 'Zweimal zurückgegeben'), task(103, 'Einmal zurückgegeben'),
  task(104, 'Blockierte Aufgabe', 'blocked'), task(105, 'Erledigt trotz Rückgaben', 'done')];
const summary = (count, reason, over = {}) => ({available: true, contract: 'task-returns.v1', return_count: count, last_return_reason: reason,
  last_return_at: '2026-11-07T08:00:00+00:00', consecutive_identical: count, flapping: false, host_scoped: false, ...over});
export const RETURNS = {
  101: summary(65, 'host_precondition:twin_status_unknown', {flapping: true, host_scoped: true}),
  102: summary(2, 'task_scope_unavailable'),
  103: summary(1, 'task_scope_unavailable'),
  104: summary(5, 'repeated_return:task_scope_unavailable'),
  105: summary(9, 'task_scope_unavailable'),
};
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString().replace('Z', '');
export const EVENTS = [
  {task_id: 101, task_title: 'Schleife mit Flattern', at: ago(2), worker: 'worker-9e4c@MAC', reason: 'host_precondition:twin_status_unknown', outcome: 'return'},
  {task_id: 102, task_title: 'Zweimal zurückgegeben', at: ago(30), worker: 'worker-45dc@MAC', reason: 'task_scope_unavailable', outcome: 'return'},
  {task_id: 101, task_title: 'Schleife mit Flattern', at: ago(31), worker: 'worker-9e4c@MAC', reason: 'host_precondition:twin_status_unknown', outcome: 'return'},
];
export const WORKERS = {
  schema: 'bach.workers.status.v1', availability: 'available', workers: [
    {id: 'worker-run', name: 'Läufer', backend: 'ollama', model: 'qwen', status: 'running', runtime_verified: true, running: true,
      worker_active: true, active_task_id: 101, current_activity: 'Arbeitet', tool_round: 1},
    {id: 'worker-wait', name: 'Wartender', backend: 'ollama', model: 'qwen', status: 'running', runtime_verified: true, running: false,
      worker_active: true, current_activity: 'Host-Voraussetzung fehlt (twin_status_unknown); Versuch 3, nächster in 240 s',
      precondition_wait: {state: 'waiting_precondition', code: 'twin_status_unknown', attempt: 3, next_check_at: new Date(Date.now() + 240000).toISOString()}},
    {id: 'worker-ended', name: 'Abgebrochener', backend: 'ollama', model: 'qwen', status: 'completed', runtime_verified: true, running: false,
      worker_active: false, generation: 'a'.repeat(32), current_activity: '',
      execution: {schema: 'bach.worker-execution.v1', state: 'terminal', terminal: true, generation: 'a'.repeat(32),
        provider_request: {schema: 'bach.provider-request.v1', request_id: 'c'.repeat(32), generation: 'a'.repeat(32), task_id: 101,
          task_fence_available: false, task_fence: null, state: 'terminal', phase: 'runtime_call_complete', phase_at: '2026-11-07T08:00:00+00:00',
          terminal_reason: 'total_deadline', details_available: true, lease_version_bound: false}}},
  ]};
export const SESSIONS = {schema: 'bach.chat-sessions.v1', source: 'session_snapshots', snapshot_type: 'chat-transcript.v1', agent_id: null,
  context: 'global', archive: 'all', offset: 0, limit: 25, total: 2, has_more: false, source_filter: 'all', problems: false,
  source_counts: {user: 1, buddha: 0, worker: 1, system: 0}, save_limits: {max_messages: 200, max_content_chars: 20000},
  sessions: [
    {id: 1, session_id: 's1', name: 'Worker-Lauf', created_at: '2026-11-07T08:00:00', chat_id: 'worker-9e4c', source: 'worker', archived: false,
      stored_message_count: 3, failed_count: 0, context_class: null, agent_id: null},
    {id: 2, session_id: 's2', name: 'Gespräch', created_at: '2026-11-07T07:00:00', chat_id: '12345', source: 'user', archived: false,
      stored_message_count: 2, failed_count: 0, context_class: null, agent_id: null}]};

export function backend(requests) {
  return route => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
    requests.push(url.pathname + url.search);
    if (url.pathname === '/api/tasks') {
      const status = url.searchParams.get('status');
      return json({success: true, tasks: TASKS, total: TASKS.length, has_more: false,
        applied_filters: {status, assignment_group: url.searchParams.get('assignment_group')}});
    }
    if (/^\/api\/tasks\/10\d$/.test(url.pathname)) return json(TASKS.find(t => `/api/tasks/${t.id}` === url.pathname));
    if (url.pathname === '/api/task-returns') {
      const ids = url.searchParams.get('ids').split(',');
      return json({tasks: Object.fromEntries(ids.filter(id => RETURNS[id]).map(id => [id, RETURNS[id]]))});
    }
    if (url.pathname === '/api/task-returns/timeline') {
      const hours = Number(url.searchParams.get('hours'));
      const only = url.searchParams.get('task_id');
      const events = EVENTS.filter(e => !only || e.task_id === Number(only));
      return json({schema: 'bach.task-return-timeline.v1', hours, total: events.length + (hours === 168 ? 40 : 0), truncated: hours === 168,
        by_reason: {task_scope_unavailable: events.length}, events});
    }
    if (url.pathname === '/api/system/workers') return json(WORKERS);
    if (url.pathname === '/api/agent-history/sessions') {
      const source = url.searchParams.get('source') || 'all';
      const sessions = SESSIONS.sessions.filter(s => source === 'all' || s.source === source);
      return json({...SESSIONS, sessions, total: sessions.length, source_filter: source});
    }
    return json({detail: 'nicht im Test'}, 404);
  };
}
