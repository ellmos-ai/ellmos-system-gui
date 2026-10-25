const WIRE_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
const SHA256_OBSERVATION = /^sha256:[a-f0-9]{64}$/;
const MAX_TTL = 7 * 86400000;
const MAX_CONFIRMATION_AGE = 120000;

function timestamp(value) {
  if (typeof value !== 'string' || value.length > 40 || !WIRE_TIME.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function executionBinding(worker) {
  if (!worker || typeof worker.id !== 'string' || !worker.id || worker.id.length > 200
      || worker.runtime_verified !== true || worker.running !== true) return null;
  const execution = worker.execution;
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)
      || execution.schema !== 'bach.worker-execution.v1' || execution.state !== 'running'
      || execution.terminal !== false || execution.worker_id !== worker.id
      || !Number.isSafeInteger(execution.active_task_id) || execution.active_task_id <= 0
      || typeof execution.generation !== 'string' || !execution.generation || execution.generation.length > 200
      || typeof execution.lease_worker_id !== 'string' || !execution.lease_worker_id || execution.lease_worker_id.length > 200
      || timestamp(execution.heartbeat_at) === null) return null;
  if (('active_task_id' in worker && worker.active_task_id !== execution.active_task_id)
      || ('generation' in worker && worker.generation !== execution.generation)) return null;
  return {
    workerId: worker.id,
    taskId: execution.active_task_id,
    generation: execution.generation,
    holder: execution.lease_worker_id,
    identity: JSON.stringify([worker.id, execution.generation, execution.active_task_id, execution.lease_worker_id])
  };
}

function confirmedLease(worker, binding, receivedAt) {
  const observation = worker?.active_task_lease;
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)
      || observation.schema !== 'bach.task-lease.v1' || observation.state !== 'active'
      || observation.source !== 'native_task_db' || observation.lease_id_kind !== 'observation_sha256'
      || !SHA256_OBSERVATION.test(observation.lease_id)
      || observation.task_id !== binding.taskId || observation.holder !== binding.holder
      || !Number.isSafeInteger(observation.fence) || observation.fence <= 0) return null;
  const observedAt = timestamp(observation.observed_at);
  const heartbeatAt = timestamp(observation.heartbeat_at);
  const expiresAt = timestamp(observation.expires_at);
  const controllerHeartbeatAt = timestamp(worker.execution.heartbeat_at);
  if (observedAt === null || heartbeatAt === null || expiresAt === null
      || controllerHeartbeatAt === null || controllerHeartbeatAt > observedAt
      || heartbeatAt > observedAt || expiresAt <= observedAt || expiresAt - observedAt > MAX_TTL) return null;
  return {
    identity: binding.identity,
    taskId: binding.taskId,
    fence: observation.fence,
    receivedAt,
    deadline: receivedAt + expiresAt - observedAt,
    expiresAt
  };
}

function duration(seconds) {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  return `${seconds} s`;
}

function expiryLabel(expiresAt) {
  return new Date(expiresAt).toLocaleString('de-DE');
}

function messageFor(observation, now) {
  if (!observation) return 'Task-Lease im aktuellen Worker-Readback nicht bestätigt.';
  if (now < observation.readAt || now - observation.readAt > MAX_CONFIRMATION_AGE)
    return 'Worker-Readback älter als 2 min · aktuelle Task-Lease nicht bestätigt.';
  const record = observation.lease;
  if (!record) return observation.state === 'absent'
    ? 'Keine aktive Task-Lease im aktuellen Worker-Readback gemeldet.'
    : observation.state === 'unbound'
      ? 'Worker-Ausführung und Task-Lease nicht gemeinsam bestätigt.'
      : 'Task-Lease im aktuellen Worker-Readback nicht bestätigt.';
  if (now < record.receivedAt || now - record.receivedAt > MAX_CONFIRMATION_AGE)
    return 'Letzter Worker-Readback älter als 2 min · aktuelle Task-Lease nicht bestätigt.';
  const remaining = Math.ceil((record.deadline - now) / 1000);
  const until = expiryLabel(record.expiresAt);
  if (remaining <= 0) return observation.current
    ? `Bestätigte Ablaufzeit ${until} erreicht · aktueller Lease-Status wird neu geprüft.`
    : `Zuletzt bestätigte Ablaufzeit ${until} erreicht · aktuelle Lease nicht bestätigt.`;
  const countdown = duration(remaining);
  return observation.current
    ? `Task-Lease für #${record.taskId} · bestätigt bis ${until} · ${countdown}`
    : `Zuletzt bestätigte Task-Lease für #${record.taskId} · Ablauf ${until} · ${countdown} · aktuelle Lease nicht bestätigt`;
}

export function mountWorkerLeaseCountdown(documentRef = globalThis.document) {
  const toggle = documentRef?.getElementById('running-lease-countdown-toggle');
  const confirmedByWorker = new Map();
  if (!toggle) return {update() {}, clear() {}, dispose() {}};

  function render(now = Date.now()) {
    const cards = documentRef.querySelectorAll('#running-workers-list [data-worker-id]');
    for (const card of cards) {
      let status = card.querySelector('[data-worker-lease-countdown]');
      if (!toggle.checked) {
        status?.remove();
        continue;
      }
      const workerId = card.dataset.workerId;
      const observation = confirmedByWorker.get(workerId);
      if (!status) {
        status = documentRef.createElement('p');
        status.dataset.workerLeaseCountdown = '';
        status.className = 'worker-lease-countdown text-muted';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'off');
        const actions = card.querySelector('.agent-overview-actions');
        if (actions) card.insertBefore(status, actions);
        else card.append(status);
      }
      status.textContent = messageFor(observation, now);
    }
  }

  function update(workers) {
    const now = Date.now();
    const seen = new Set();
    if (Array.isArray(workers)) {
      for (const worker of workers) {
        const binding = executionBinding(worker);
        if (!binding) {
          if (typeof worker?.id === 'string') {
            seen.add(worker.id);
            confirmedByWorker.set(worker.id, {state:'unbound', readAt:now, identity:null, lease:null, current:false});
          }
          continue;
        }
        seen.add(binding.workerId);
        const lease = confirmedLease(worker, binding, now);
        if (lease) {
          confirmedByWorker.set(binding.workerId, {identity:binding.identity, lease, readAt:now, state:'active', current:true});
          continue;
        }
        const previous = confirmedByWorker.get(binding.workerId);
        if (previous?.identity === binding.identity && previous.lease && now >= previous.lease.receivedAt
            && now - previous.lease.receivedAt <= MAX_CONFIRMATION_AGE) {
          confirmedByWorker.set(binding.workerId, {...previous, readAt:now,
            state:Object.prototype.hasOwnProperty.call(worker, 'active_task_lease') ? 'invalid' : 'absent', current:false});
        } else {
          confirmedByWorker.set(binding.workerId, {identity:binding.identity, lease:null, readAt:now,
            state:Object.prototype.hasOwnProperty.call(worker, 'active_task_lease') ? 'invalid' : 'absent', current:false});
        }
      }
    }
    for (const workerId of confirmedByWorker.keys()) {
      if (!seen.has(workerId)) confirmedByWorker.delete(workerId);
    }
    render(now);
  }

  function clear() {
    confirmedByWorker.clear();
    render();
  }

  const onToggleChange = () => render();
  toggle.addEventListener('change', onToggleChange);
  const timer = globalThis.setInterval?.(() => {
    if (!documentRef.hidden && toggle.checked) render();
  }, 1000);
  const onVisibilityChange = () => { if (!documentRef.hidden && toggle.checked) render(); };
  documentRef.addEventListener('visibilitychange', onVisibilityChange);
  return {
    update,
    clear,
    dispose() {
      if (timer !== undefined) globalThis.clearInterval?.(timer);
      documentRef.removeEventListener('visibilitychange', onVisibilityChange);
      toggle.removeEventListener('change', onToggleChange);
      confirmedByWorker.clear();
    }
  };
}
