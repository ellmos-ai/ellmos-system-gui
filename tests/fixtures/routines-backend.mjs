// Injected backend answers for the PB-6 routines tests and screenshots (synthetic data only).
// Shapes follow BACH system/gui/server.py: /api/daemon/jobs, /api/daemon/status, /api/recurring (a dict keyed by task id),
// /api/routines, and the bach.agent-triggers.v1 envelope of /api/agent-triggers.
export const JOBS = [
  {id: 1, name: 'DB Backup', description: 'Tägliche Sicherung der Nutzerdatenbank', job_type: 'cron', schedule: '0 2 * * *', is_active: 1,
    last_run: null, next_run: '2026-11-08 02:00:00', run_count: 0, last_result: null},
  {id: 2, name: 'Log Rotation', description: 'Alte Logs packen', job_type: 'interval', schedule: '1440', is_active: 1,
    last_run: '2026-09-01 03:00:12', next_run: null, run_count: 4, last_result: 'failed'},
  {id: 3, name: 'Translation QA', description: '', job_type: 'cron', schedule: '30 6 * * 1', is_active: 0,
    last_run: '2026-09-17 06:30:05', next_run: null, run_count: 9, last_result: 'success'},
];
export const RECURRING = {
  self_check: {enabled: true, task_text: 'Selbstprüfung des Systems', target: 'ati_tasks', interval_days: 14, last_run: '2026-10-31T09:00:00',
    next_due: '2026-11-14T09:00:00', days_until: 7, is_due: false},
  doc_review: {enabled: false, task_text: 'Dokumentation prüfen', target: 'ati_tasks', interval_days: 30, last_run: null, next_due: '2026-11-07T08:00:00',
    days_until: 0, is_due: true},
};
export const LIFE = [
  {id: 12, name: 'Abstellkammer ordnen', interval_type: 'jaehrlich', interval_value: 1, next_due_at: '2027-01-28 06:58:01',
    last_run_at: '2026-01-28 06:58:01', is_active: true, is_due_today: false, is_overdue: false},
  {id: 13, name: 'Rauchmelder prüfen', interval_type: 'monatlich', interval_value: 6, next_due_at: '2026-11-01', last_run_at: null,
    is_active: true, is_due_today: false, is_overdue: true},
];
export const TRIGGERS = [
  {id: 'team.weekly', agent_id: 'worker@mac', version: 3, revision: 3, enabled: true, deleted: false, executor: 'deliver-report',
    schedule: {kind: 'daily', time: '09:00', timezone: 'Europe/Berlin'}, payload: {}, authorities: []},
  {id: 'old.trigger', agent_id: 'worker@mac', version: 2, revision: 2, enabled: false, deleted: true, executor: 'deliver-report',
    schedule: {kind: 'interval', every_seconds: 3600}, payload: {}, authorities: []},
];
export const MODULE_AUTOMATIONS = [
  {id: 'automation-master:weekly-cleanup', name: 'weekly-cleanup', title: 'Wöchentliche Bereinigung',
    schedule: 'wöchentlich', last_run: '2026-11-01 04:00:00', next_run: '2026-11-08 04:00:00',
    last_result: 'success', enabled: true, source: 'automation-master'},
];
const envelope = value => ({schema: 'bach.agent-triggers.v1', provider: 'ellmos-scheduler', source: 'external_scheduler', state: 'available', ...value});

// fault: {bach: 503, recurring: 503, ocean: 404, life: 401, status: 500, module: 404}; a number is an HTTP status, 'down' makes the fetch throw.
export function routinesBackend(fault = {}, calls = []) {
  return async (path, options = {}) => {
    const url = new URL(path, 'http://x'), method = options.method || 'GET';
    calls.push(`${method} ${url.pathname}`);
    const bad = key => fault[key];
    const reply = (key, body) => {
      if (bad(key) === 'down') throw new TypeError('fetch failed');
      if (bad(key)) return {ok: false, status: bad(key), json: async () => ({})};
      return {ok: true, status: 200, json: async () => body};
    };
    if (method === 'GET' && url.pathname === '/api/daemon/jobs') return reply('bach', {jobs: JOBS, count: JOBS.length});
    if (method === 'GET' && url.pathname === '/api/daemon/status') return reply('status', {running: false, identity: 'stopped'});
    if (method === 'GET' && url.pathname === '/api/recurring') return reply('recurring', {success: true, count: 2, tasks: RECURRING});
    if (method === 'GET' && url.pathname === '/api/routines') return reply('life', {success: true, routines: LIFE});
    if (method === 'GET' && url.pathname === '/api/agent-triggers') return reply('ocean', envelope({triggers: TRIGGERS}));
    if (method === 'GET' && url.pathname === '/api/automations') return reply('module', {ok: true, source: 'automation-master', count: MODULE_AUTOMATIONS.length, items: MODULE_AUTOMATIONS, automations: MODULE_AUTOMATIONS});
    if (method === 'PUT' && /^\/api\/daemon\/jobs\/\d+\/toggle$/.test(url.pathname)) return reply('bach', {is_active: false});
    if (method === 'POST' && /^\/api\/daemon\/jobs\/\d+\/run$/.test(url.pathname)) return reply('bach', {status: 'started', job_id: 1});
    if (method === 'POST' && /^\/api\/recurring\/trigger\//.test(url.pathname)) return reply('recurring', {success: true});
    if (method === 'POST' && /^\/api\/routines\/\d+\/complete$/.test(url.pathname)) return reply('life', {success: true});
    return {ok: false, status: 404, json: async () => ({})};
  };
}
