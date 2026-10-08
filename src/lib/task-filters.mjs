const GROUPS = new Set(['all', 'user', 'auto', 'unassigned']);
const STATES = new Set(['all', 'open', 'done']);
export function readTaskFilters(search = '') {
  const params = new URLSearchParams(search);
  const requested = params.get('assignment_group');
  const assignment = GROUPS.has(requested) ? requested : params.get('assigned_to')?.toLowerCase() === 'user' ? 'user' : 'all';
  const raw = params.get('status');
  const status = ['nonterminal','pending','in_progress'].includes(raw) ? 'open'
    : ['completed','closed'].includes(raw) ? 'done' : STATES.has(raw) ? raw : 'open';
  const priority = ['P1','P2','P3','P4'].includes(params.get('priority')) ? params.get('priority') : '';
  return {assignment, status, priority};
}
export function taskFilterQuery(filters, offset = 0, limit = 100) {
  if (!GROUPS.has(filters.assignment) || !STATES.has(filters.status)
      || !['','P1','P2','P3','P4'].includes(filters.priority)
      || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1)
    throw new Error('Ungültige Aufgabenfilter.');
  const query = new URLSearchParams({status:filters.status === 'open' ? 'nonterminal' : filters.status,
    assignment_group:filters.assignment, limit:String(limit), offset:String(offset)});
  if (filters.priority) query.set('priority', filters.priority);
  return query;
}
export function writeTaskFilters(url, filters) {
  const result = new URL(url);
  result.searchParams.set('assignment_group', filters.assignment);
  result.searchParams.set('status', filters.status);
  if (filters.assignment === 'user') result.searchParams.set('assigned_to','user');
  else result.searchParams.delete('assigned_to');
  if (filters.priority) result.searchParams.set('priority',filters.priority);
  else result.searchParams.delete('priority');
  result.searchParams.delete('offset');
  return result;
}
export function readTaskPage(data, filters) {
  if (data?.success !== true || !Array.isArray(data.tasks))
    throw new Error('Ungültige Task-Antwort.');
  if (filters.assignment !== 'all' && data.applied_filters?.assignment_group !== filters.assignment)
    throw new Error('Die verbundene Task-API unterstützt die kombinierte Zuordnung noch nicht.');
  const total = Number.isSafeInteger(data.total) && data.total >= data.tasks.length ? data.total : null;
  return {tasks:data.tasks, total, hasMore:data.has_more === true};
}
export function taskCountLabel(count, total, offset) {
  if (total === null) return count + ' Aufgaben geladen · Gesamtzahl unbekannt';
  if (!count) return '0 von ' + total + ' passenden Aufgaben';
  return (offset + 1) + '–' + (offset + count) + ' von ' + total + ' passenden Aufgaben';
}
