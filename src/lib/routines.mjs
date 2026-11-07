// PB-6 (#3990): one list of routines and jobs from every source the backend can answer for.
// Each source is probed on every load; nothing is declared "unavailable" by constant. A source that cannot answer says why.
import {parseTrigger} from './agent-triggers.mjs';

export const SOURCE_KEYS = ['bach', 'ocean', 'module', 'life'];
export const SOURCE_LABEL = {bach: 'BACH', ocean: 'Ocean', module: 'Modul', life: 'Life · persönlich'};
// The module source has no HTTP path in the backend yet (W1 diagnosis section 13.1). When one exists, add a reader here.
const MODULE_REASON = 'kein Backend-Pfad für Modul-Automationen (BACH-Adapter fehlt)';

const reasonFor = status => status === 401 || status === 403 ? 'Geräteanmeldung erforderlich'
  : status === 404 ? 'Pfad nicht vorhanden (Backend ohne diese Schnittstelle)' : `Schnittstelle nicht verfügbar (HTTP ${status})`;

// Wall time as the backend stores it (no zone) is shown as is; only values that carry a zone are converted to Berlin time.
export function formatWhen(value, fallback = 'Nicht geplant') {
  if (value == null || String(value).trim() === '') return fallback;
  const text = String(value).trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return text;
  const [, y, mo, d, h, mi, zone] = m;
  if (zone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('de-DE', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(text)).map(p => [p.type, p.value]));
    return `${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute}`;
  }
  return h == null ? `${d}.${mo}.${y}` : `${d}.${mo}.${y}, ${h}:${mi}`;
}

const safeId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const NONE = {toggle: null, run: null, complete: null};
const finish = item => ({dataSource: 'measured', detail: '', result: null, overdue: false, controls: NONE, ...item,
  nextText: formatWhen(item.next, item.source === 'ocean' ? 'Nicht gemeldet' : 'Nicht geplant'),
  lastText: formatWhen(item.last, item.source === 'ocean' ? 'Nicht gemeldet' : 'Noch nie')});

function intervalText(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return String(minutes ?? 'Nicht geplant');
  if (n % 1440 === 0) return `alle ${n / 1440} Tage`;
  if (n % 60 === 0) return `alle ${n / 60} Std.`;
  return `alle ${n} Min.`;
}
const jobSchedule = job => job.job_type === 'cron' ? `Cron ${job.schedule}` : job.job_type === 'interval' ? intervalText(job.schedule)
  : job.job_type === 'event' ? 'bei Ereignis' : job.schedule ? String(job.schedule) : 'nur manuell';

const fromJob = job => safeId(job?.id) && typeof job.name === 'string' ? finish({
  id: `bach-job:${job.id}`, source: 'bach', kind: 'job', origin: 'Daemon-Job', name: job.name, detail: job.description || '',
  schedule: jobSchedule(job), next: job.next_run, last: job.last_run, result: job.last_result || null, active: !!job.is_active,
  controls: {toggle: {method: 'PUT', url: `/api/daemon/jobs/${job.id}/toggle`}, run: {method: 'POST', url: `/api/daemon/jobs/${job.id}/run`}, complete: null},
}) : null;

const fromRecurring = ([key, task]) => /^[A-Za-z0-9_.:-]{1,128}$/.test(key) && task && typeof task === 'object' ? finish({
  id: `bach-recurring:${key}`, source: 'bach', kind: 'routine', origin: 'Wiederkehrende Aufgabe', name: task.task_text || key, detail: key,
  schedule: `alle ${task.interval_days ?? '?'} Tage`, next: task.next_due, last: task.last_run, active: task.enabled === true,
  overdue: task.enabled === true && task.is_due === true,
  controls: {toggle: null, run: {method: 'POST', url: `/api/recurring/trigger/${encodeURIComponent(key)}`}, complete: null},
}) : null;

const fromLife = item => safeId(item?.id) && typeof item === 'object' ? finish({
  id: `life:${item.id}`, source: 'life', kind: 'routine', origin: 'Persönliche Routine', name: String(item.name || '').trim() || 'Unbenannte Routine',
  schedule: [item.interval_type, item.interval_value ? `alle ${item.interval_value}` : ''].filter(Boolean).join(' · ') || 'Nicht geplant',
  next: item.next_due_at, last: item.last_run_at || item.last_completed_at, active: item.is_active === true, overdue: item.is_overdue === true,
  controls: item.is_due_today === true || item.is_overdue === true ? {...NONE, complete: {method: 'POST', url: `/api/routines/${item.id}/complete`}} : NONE,
}) : null;

function triggerSchedule(s) {
  if (s.kind === 'daily') return `täglich ${s.time || ''}`.trim();
  if (s.kind === 'once') return `einmalig ${formatWhen(s.at, 'ohne Termin')}`;
  if (s.kind === 'cron') return `Cron ${s.expression ?? s.cron ?? ''}`.trim();
  if (s.kind === 'event') return 'bei Ereignis';
  const seconds = s.every_seconds ?? s.interval_seconds ?? s.seconds;
  return seconds ? `alle ${seconds} s` : 'Intervall';
}
const fromTrigger = trigger => trigger.deleted ? null : finish({
  id: `ocean:${trigger.id}`, source: 'ocean', kind: 'job', origin: 'Scheduler-Auslöser', name: trigger.id, detail: trigger.agent_id,
  schedule: triggerSchedule(trigger.schedule), next: null, last: null, active: trigger.enabled,
});

const acceptTriggers = data => data?.schema === 'bach.agent-triggers.v1' && data.provider === 'ellmos-scheduler'
  && data.source === 'external_scheduler' && data.state === 'available' && Array.isArray(data.triggers) ? data.triggers.map(parseTrigger) : null;

// The client owns the fetcher, so the page-reads guard can follow every call (scripts/page-reads-helpers.mjs: read).
export function createRoutinesClient(fetcher = globalThis.fetch) {
  async function read(url, accept) {
    let response;
    try { response = await fetcher(url, {redirect: 'error'}); } catch { return {reason: 'keine Verbindung zum Backend'}; }
    if (!response.ok) return {reason: reasonFor(response.status)};
    try {
      const value = accept(await response.json());
      if (value) return {value};
    } catch { /* falls through to the contract message */ }
    return {reason: 'Antwort ohne bestätigten Vertrag'};
  }

  async function load() {
    const [jobs, recurring, daemon, ocean, life] = await Promise.all([
      read('/api/daemon/jobs', d => Array.isArray(d?.jobs) ? d.jobs : null),
      read('/api/recurring', d => d?.success === true && d.tasks && typeof d.tasks === 'object' ? Object.entries(d.tasks) : null),
      read('/api/daemon/status', d => d && typeof d.running === 'boolean' ? d : null),
      read('/api/agent-triggers', acceptTriggers),
      read('/api/routines', d => d?.success === true && Array.isArray(d.routines) ? d.routines : null),
    ]);
    const sources = {}, items = [];
    const take = (_key, result, map) => result.value ? map(result.value).filter(Boolean) : [];
    const bach = [take('bach', jobs, v => v.map(fromJob)), take('bach', recurring, v => v.map(fromRecurring))];
    const failed = [jobs.reason && `Daemon-Jobs: ${jobs.reason}`, recurring.reason && `Wiederkehrende Aufgaben: ${recurring.reason}`].filter(Boolean);
    const bachItems = bach.flat();
    sources.bach = {state: failed.length === 0 ? 'available' : failed.length === 2 ? 'unavailable' : 'partial', reason: failed.join('; ') || null,
      count: bachItems.length, note: daemon.value?.running === false && jobs.value ? 'Der BACH-Daemon ist gestoppt: Jobs laufen nicht von selbst.' : null};
    const oceanItems = take('ocean', ocean, v => v.map(fromTrigger));
    sources.ocean = {state: ocean.value ? 'available' : 'unavailable', reason: ocean.reason || null, count: oceanItems.length, note: null};
    sources.module = {state: 'unavailable', reason: MODULE_REASON, count: 0, note: null};
    const lifeItems = take('life', life, v => v.map(fromLife));
    sources.life = {state: life.value ? 'available' : 'unavailable', reason: life.reason || null, count: lifeItems.length, note: null};
    items.push(...bachItems, ...oceanItems, ...lifeItems);
    return {items, sources};
  }

  // Controls are built from backend data: 4 routes, bound in scripts/page-reads-bindings.mjs.
  async function run(control) {
    let response;
    try { response = await fetcher(control.url, {method: control.method, redirect: 'error'}); } catch { throw new Error('keine Verbindung zum Backend'); }
    if (!response.ok) throw new Error(reasonFor(response.status));
    const data = await response.json().catch(() => ({}));
    if (data?.success === false) throw new Error('Aktion von der Quelle nicht bestätigt');
  }

  return {load, run};
}

export function filterRoutines(items, {source = 'all', kind = 'all', query = ''} = {}) {
  const q = query.trim().toLowerCase();
  return items.filter(item => (source === 'all' || item.source === source) && (kind === 'all' || item.kind === kind)
    && (!q || [item.name, item.origin, item.detail, item.schedule, SOURCE_LABEL[item.source]].some(v => String(v).toLowerCase().includes(q))));
}

// A job that never ran or whose last run failed is the thing the user most needs to see (the daily backup never ran).
export function attention(item) {
  if (item.result === 'failed' || item.result === 'timeout') return {code: 'failed', text: item.result === 'timeout' ? 'Letzter Lauf: Zeitüberschreitung' : 'Letzter Lauf fehlgeschlagen'};
  if (item.source === 'bach' && item.kind === 'job' && item.active && !item.last) return {code: 'never-run', text: 'Noch nie gelaufen'};
  if (item.overdue) return {code: 'overdue', text: 'Fällig'};
  return null;
}
