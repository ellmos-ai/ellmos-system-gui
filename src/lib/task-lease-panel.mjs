const VERSION = /^[a-f0-9]{64}$/;
const WIRE_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
const TASK_STATES = new Set(['in_progress', 'progress']);

function timestamp(value) {
  if (typeof value !== 'string' || !WIRE_TIME.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validatePublicTaskLease(task, observation, receivedAt = Date.now()) {
  if (!task || !Number.isSafeInteger(task.id) || task.id <= 0
      || !TASK_STATES.has(String(task.status || '').trim().toLowerCase())
      || typeof task.task_version !== 'string' || !VERSION.test(task.task_version)
      || !Number.isSafeInteger(task.claim_fence) || task.claim_fence < 0
      || !observation || typeof observation !== 'object' || Array.isArray(observation)
      || observation.task_id !== task.id || observation.status !== task.status
      || observation.task_version !== task.task_version
      || observation.fence !== task.claim_fence
      || !Number.isSafeInteger(receivedAt) || receivedAt < 0
      || 'lease_id' in observation || 'own' in observation) return {state:'unavailable'};
  const serverNow = timestamp(observation.server_now);
  if (serverNow === null) return {state:'unavailable'};
  if (observation.leased === false) return {state:'unleased'};
  const expiresAt = timestamp(observation.expires_at);
  if (observation.leased !== true || observation.legacy !== false
      || observation.fence <= 0 || expiresAt === null
      || expiresAt <= serverNow || expiresAt - serverNow > 7 * 86400000)
    return {state:'unavailable'};
  return {state:'active', taskId:task.id, taskVersion:task.task_version,
    fence:observation.fence, receivedAt, deadline:receivedAt + expiresAt - serverNow,
    expiresAt};
}

export function leaseCountdown(lease, now = Date.now()) {
  if (lease?.state !== 'active' || !Number.isSafeInteger(now)
      || now < lease.receivedAt || now - lease.receivedAt > 120000) return null;
  const seconds = Math.ceil((lease.deadline - now) / 1000);
  if (seconds <= 0) return null;
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`
    : seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
}

export function sortTaskLeaseRows(rows, enabled) {
  if (!enabled) return rows;
  return rows.map((row, index) => ({row, index})).sort((a, b) =>
    (a.row.lease?.state === 'active' ? a.row.lease.deadline : Infinity)
    - (b.row.lease?.state === 'active' ? b.row.lease.deadline : Infinity)
    || a.index - b.index).map(entry => entry.row);
}

export async function loadTaskLeaseRows(fetchImpl = fetch, {maxPages = 5, concurrency = 4} = {}) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10
      || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error('Ungültiges Lease-Leselimit.');
  const tasks = [];
  let partial = false;
  let hasMore = false;
  for (let page = 0; page < maxPages; page++) {
    const query = `status=in_progress,progress&limit=100&offset=${page * 100}`;
    let data;
    try {
      const response = await fetchImpl('/api/tasks?' + query,
        {redirect:'error', signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw new Error('Task-Liste nicht verfügbar');
      data = await response.json();
      if (data?.success !== true || !Array.isArray(data.tasks) || data.tasks.length > 100
          || typeof data.has_more !== 'boolean'
          || data.applied_filters?.status !== 'in_progress,progress')
        throw new Error('Task-Filter nicht bestätigt');
    } catch (_) { partial = true; break; }
    tasks.push(...data.tasks);
    hasMore = data.has_more;
    if (!hasMore) break;
  }
  if (hasMore) partial = true;
  const seen = new Set();
  const rows = tasks.map(task => {
    if (!Number.isSafeInteger(task?.id) || task.id <= 0 || seen.has(task.id)) {
      partial = true;
      return null;
    }
    seen.add(task.id);
    return {task, lease:{state:'unavailable'}};
  }).filter(Boolean);
  let next = 0;
  await Promise.all(Array.from({length:Math.min(concurrency, rows.length)}, async () => {
    while (next < rows.length) {
      const row = rows[next++];
      try {
        const response = await fetchImpl(`/api/tasks/${row.task.id}/lease`,
          {redirect:'error', signal:AbortSignal.timeout(8000)});
        if (!response.ok) throw new Error('Lease nicht verfügbar');
        row.lease = validatePublicTaskLease(row.task, await response.json(), Date.now());
      } catch (_) { row.lease = {state:'unavailable'}; }
      if (row.lease.state === 'unavailable') partial = true;
    }
  }));
  return {rows, partial, complete:!partial, scanned:tasks.length};
}
