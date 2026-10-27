const phaseLabels = Object.freeze({
  registered: "Anfrage registriert",
  request_starting: "Anfrage startet",
  transport_open: "Verbindung geöffnet",
  awaiting_response_headers: "Wartet auf Antwort",
  response_headers_received: "Antwortkopf empfangen",
  first_stream_chunk_received: "Erste Antwortdaten empfangen",
  response_completed: "Antwort abgeschlossen",
  request_aborted: "Anfrage abgebrochen",
  request_failed: "Anfrage fehlgeschlagen",
  response_cleanup_complete: "Antwortbereinigung abgeschlossen",
  client_cleanup_complete: "Verbindungsbereinigung abgeschlossen",
  runtime_call_complete: "Aufruf beendet",
});

const terminalReasons = new Set([
  "worker_stop",
  "total_deadline",
  "httpx_read_timeout",
  "provider_error",
  "backend_error",
  "backend_returned",
  "runtime_cancelled",
  "dispatch_rejected",
  "response_completed",
]);

function validRequest(worker) {
  if (!worker || typeof worker !== "object" || Array.isArray(worker)) return null;
  const execution = worker.execution;
  const request = execution?.provider_request;
  if (!execution || typeof execution !== "object" || Array.isArray(execution)
      || !request || typeof request !== "object" || Array.isArray(request)) return null;
  if (execution.schema !== "bach.worker-execution.v1"
      || !["running", "terminal"].includes(execution.state)
      || typeof execution.terminal !== "boolean"
      || (execution.state === "running" && execution.terminal)
      || (execution.state === "terminal" && !execution.terminal)
      || typeof execution.generation !== "string"
      || !/^[0-9a-f]{32}$/.test(execution.generation)
      || ("generation" in worker && worker.generation !== execution.generation)
      || request.schema !== "bach.provider-request.v1"
      || typeof request.request_id !== "string"
      || !/^[0-9a-f]{32}$/.test(request.request_id)
      || request.generation !== execution.generation
      || !Number.isSafeInteger(request.task_id) || request.task_id <= 0
      || typeof request.state !== "string"
      || !["active", "terminal"].includes(request.state)
      || typeof request.phase !== "string" || !Object.hasOwn(phaseLabels, request.phase)
      || typeof request.phase_at !== "string" || request.phase_at.length > 40
      || !Number.isFinite(Date.parse(request.phase_at))
      || (request.terminal_reason !== null
          && (typeof request.terminal_reason !== "string"
              || !terminalReasons.has(request.terminal_reason)))
      || typeof request.details_available !== "boolean"
      || typeof request.lease_version_bound !== "boolean"
      || typeof request.task_fence_available !== "boolean"
      || (request.task_fence_available
          ? !Number.isSafeInteger(request.task_fence) || request.task_fence <= 0
          : request.task_fence !== null)) return null;

  if (request.state === "active"
      && (execution.state !== "running" || execution.terminal !== false
          || worker.runtime_verified !== true || worker.running !== true
          || request.lease_version_bound !== true
          || request.task_fence_available !== true
          || execution.active_task_id !== request.task_id)) return null;

  if (request.state === "terminal"
      && (request.phase !== "runtime_call_complete"
          || execution.state === "terminal" && execution.terminal !== true)) return null;

  return { execution, request };
}

/**
 * Return only fixed, user-facing copy. Provider payloads and activity text are never rendered here.
 */
export function providerRequestStatusText(worker) {
  const projected = validRequest(worker);
  if (!projected) {
    return worker && typeof worker === "object"
      && worker.runtime_verified === true && worker.running === true
      ? "Providerdetails nicht verfügbar."
      : "";
  }

  const { execution, request } = projected;
  const phase = phaseLabels[request.phase];
  if (request.state === "terminal") {
    return request.details_available
      ? `Letzter Provideraufruf · ${phase}`
      : `Letzter Provideraufruf · ${phase} · Providerdetails nicht verfügbar`;
  }

  const lease = worker.active_task_lease;
  const leaseMatches = lease && typeof lease === "object" && !Array.isArray(lease)
    && lease.schema === "bach.task-lease.v1" && lease.state === "active"
    && lease.source === "native_task_db" && lease.task_id === request.task_id
    && Number.isSafeInteger(lease.fence) && lease.fence === request.task_fence
    && typeof execution.lease_worker_id === "string"
    && lease.holder === execution.lease_worker_id;
  if (!leaseMatches) return "Providerdetails nicht verfügbar.";

  return request.details_available
    ? `Provideranfrage aktiv · ${phase}`
    : `Provideranfrage aktiv · ${phase} · Providerdetails nicht verfügbar`;
}
