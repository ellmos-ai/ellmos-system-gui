import {isTaskCalendarDate} from './task-created-date.mjs';

const GROUPS = new Set(['all', 'user', 'auto', 'unassigned']);
const SORTS = new Set(['priority', 'created_desc', 'created_asc']);
export const TASK_STATUS_FILTERS = Object.freeze([
  'all', 'open', 'done', 'pending', 'in_progress', 'review', 'blocked', 'cancelled', 'archived', 'duplicate',
]);
const STATES = new Set(TASK_STATUS_FILTERS);
const apiStatus = status => status === 'open' ? 'nonterminal' : status;

function dateFilters(filters) {
  const createdFrom = (filters.createdFrom || '').trim();
  const createdTo = (filters.createdTo || '').trim();
  const sort = filters.sort ?? 'priority';
  if ((createdFrom && !isTaskCalendarDate(createdFrom)) || (createdTo && !isTaskCalendarDate(createdTo)))
    throw new Error('Ungültiges Datum. Erwartet: YYYY-MM-DD.');
  if (createdFrom && createdTo && createdFrom > createdTo)
    throw new Error('Ungültiger Zeitraum: Das Von-Datum liegt nach dem Bis-Datum.');
  if (!SORTS.has(sort)) throw new Error('Ungültige Task-Sortierung.');
  return {createdFrom, createdTo, sort};
}

export function readTaskFilters(search = '') {
  const params = new URLSearchParams(search);
  const requested = params.get('assignment_group');
  const assignment = GROUPS.has(requested) ? requested : params.get('assigned_to')?.toLowerCase() === 'user' ? 'user' : 'all';
  const raw = params.get('status');
  const status = raw === 'nonterminal' ? 'open'
    : ['completed', 'closed'].includes(raw) ? 'done'
    : raw === 'progress' ? 'in_progress'
    : raw === 'todo' ? 'pending'
    : raw === 'canceled' ? 'cancelled'
    : STATES.has(raw) ? raw : 'open';
  const priority = ['P1','P2','P3','P4'].includes(params.get('priority')) ? params.get('priority') : '';
  const q = (params.get('q') || '').trim().slice(0, 200);
  const agent = (params.get('assigned_to') || '').trim();
  // Keep malformed deep-link values until validation, rather than broadening a query.
  const createdFrom = (params.get('created_from') || '').trim();
  const createdTo = (params.get('created_to') || '').trim();
  const sort = params.get('sort') ?? 'priority';
  return {assignment, status, priority, q, agent: assignment === 'user' && agent.toLowerCase() === 'user' ? '' : agent,
    createdFrom, createdTo, sort};
}
export function taskFilterQuery(filters, offset = 0, limit = 100) {
  if (!GROUPS.has(filters.assignment) || !STATES.has(filters.status)
      || !['','P1','P2','P3','P4'].includes(filters.priority)
      || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1)
    throw new Error('Ungültige Aufgabenfilter.');
  const q = (filters.q || '').trim(), agent = (filters.agent || '').trim();
  if (q.length > 200 || agent.length > 100) throw new Error('Ungültige Aufgabenfilter.');
  const {createdFrom, createdTo, sort} = dateFilters(filters);
  const query = new URLSearchParams({status:apiStatus(filters.status),
    assignment_group:filters.assignment, limit:String(limit), offset:String(offset), sort});
  if (filters.priority) query.set('priority', filters.priority);
  if (q) query.set('q', q);
  if (agent) query.set('assigned_to', agent);
  if (createdFrom) query.set('created_from', createdFrom);
  if (createdTo) query.set('created_to', createdTo);
  return query;
}
export function writeTaskFilters(url, filters) {
  const result = new URL(url);
  result.searchParams.set('assignment_group', filters.assignment);
  result.searchParams.set('status', filters.status);
  if (filters.agent) result.searchParams.set('assigned_to', filters.agent);
  else if (filters.assignment === 'user') result.searchParams.set('assigned_to','user');
  else result.searchParams.delete('assigned_to');
  if (filters.q) result.searchParams.set('q', filters.q);
  else result.searchParams.delete('q');
  if (filters.priority) result.searchParams.set('priority',filters.priority);
  else result.searchParams.delete('priority');
  for (const [query, key] of [['created_from','createdFrom'], ['created_to','createdTo']]) {
    if (filters[key]) result.searchParams.set(query, filters[key]);
    else result.searchParams.delete(query);
  }
  result.searchParams.set('sort', filters.sort ?? 'priority');
  result.searchParams.delete('offset');
  return result;
}
export function readTaskPage(data, filters) {
  if (data?.success !== true || !Array.isArray(data.tasks))
    throw new Error('Ungültige Task-Antwort.');
  if (filters.assignment !== 'all' && data.applied_filters?.assignment_group !== filters.assignment)
    throw new Error('Die verbundene Task-API unterstützt die kombinierte Zuordnung noch nicht.');
  if (data.applied_filters?.status !== apiStatus(filters.status))
    throw new Error('Die verbundene Task-API hat den gewählten Statusfilter nicht bestätigt.');
  const {createdFrom, createdTo, sort} = dateFilters(filters);
  if ((createdFrom || createdTo) && (
      data.applied_filters?.created_from !== createdFrom || data.applied_filters?.created_to !== createdTo
      || data.applied_filters?.created_date_semantics !== 'stored_calendar'))
    throw new Error('Die verbundene Task-API hat den gewählten Datumsfilter nicht bestätigt.');
  if (data.applied_filters?.sort !== sort)
    throw new Error('Die verbundene Task-API hat die gewählte Sortierung nicht bestätigt.');
  const searchApplied = !filters.q || typeof data.applied_filters?.q === 'string';
  const total = Number.isSafeInteger(data.total) && data.total >= data.tasks.length ? data.total : null;
  // Ohne applied_filters.q hat das Backend die Suche ignoriert: Seite nicht anzeigen, nicht clientseitig filtern.
  if (!searchApplied) return {tasks:[], total:null, hasMore:false, searchUnsupported:true};
  return {tasks:data.tasks, total, hasMore:data.has_more === true, searchUnsupported:false};
}
export function taskCountLabel(count, total, offset) {
  if (total === null) return count + ' Aufgaben geladen · Gesamtzahl unbekannt';
  if (!count) return '0 von ' + total + ' passenden Aufgaben';
  return (offset + 1) + '–' + (offset + count) + ' von ' + total + ' passenden Aufgaben';
}
