import assert from "node:assert/strict";
import test from "node:test";

import { providerRequestStatusText } from "../src/lib/provider-request-status.mjs";

const generation = "a".repeat(32);
const holder = `worker-${"b".repeat(32)}@mac-studio`;

function workerWithRequest(overrides = {}) {
  const request = {
    schema: "bach.provider-request.v1",
    request_id: "c".repeat(32),
    generation,
    task_id: 42,
    task_fence: 7,
    task_fence_available: true,
    state: "active",
    phase: "awaiting_response_headers",
    phase_at: "2026-10-27T17:00:00+00:00",
    terminal_reason: null,
    details_available: true,
    lease_version_bound: true,
    ...overrides.request,
  };
  const execution = {
    schema: "bach.worker-execution.v1",
    state: "running",
    terminal: false,
    generation,
    active_task_id: 42,
    lease_worker_id: holder,
    provider_request: request,
    ...overrides.execution,
  };
  return {
    runtime_verified: true,
    running: true,
    generation,
    active_task_lease: {
      schema: "bach.task-lease.v1",
      state: "active",
      source: "native_task_db",
      task_id: 42,
      fence: 7,
      holder,
    },
    ...overrides.worker,
    execution,
  };
}

test("renders active phase only with exact version-bound lease identity", () => {
  assert.equal(
    providerRequestStatusText(workerWithRequest()),
    "Provideranfrage aktiv · Wartet auf Antwort",
  );
});

test("idle worker without a request has no expected provider status", () => {
  assert.equal(providerRequestStatusText({
    runtime_verified: true,
    running: false,
    status: "idle",
  }), "");
});

test("renders a terminal request as the last call, never as active inference", () => {
  const worker = workerWithRequest({
    request: {
      state: "terminal",
      phase: "runtime_call_complete",
      terminal_reason: "backend_returned",
      task_fence_available: false,
      task_fence: null,
      details_available: false,
      lease_version_bound: false,
    },
    execution: {
      state: "terminal",
      terminal: true,
      active_task_id: undefined,
      lease_worker_id: undefined,
    },
    worker: {
      running: false,
      status: "completed",
      active_task_lease: undefined,
    },
  });
  assert.equal(
    providerRequestStatusText(worker),
    "Letzter Provideraufruf · Aufruf beendet · Providerdetails nicht verfügbar",
  );
});

test("an uninstrumented running backend gets an unavailable fallback", () => {
  assert.equal(providerRequestStatusText({
    runtime_verified: true,
    running: true,
    current_activity: "This text must not be used as a provider phase",
  }), "Providerdetails nicht verfügbar.");
});

test("does not render a stale or foreign generation as a current request", () => {
  const worker = workerWithRequest({
    request: { generation: "d".repeat(32) },
  });
  assert.equal(providerRequestStatusText(worker), "Providerdetails nicht verfügbar.");
});

test("rejects mismatched task, fence, or version-bound lease", () => {
  const wrongTask = workerWithRequest({
    request: { task_id: 43 },
  });
  const wrongFence = workerWithRequest({
    request: { task_fence: 8 },
  });
  const staleVersionLease = workerWithRequest({
    request: { lease_version_bound: false },
    worker: { active_task_lease: undefined },
  });
  assert.equal(providerRequestStatusText(wrongTask), "Providerdetails nicht verfügbar.");
  assert.equal(providerRequestStatusText(wrongFence), "Providerdetails nicht verfügbar.");
  assert.equal(providerRequestStatusText(staleVersionLease), "Providerdetails nicht verfügbar.");
});

test("malformed or unhashable provider fields fail closed without exposing input", () => {
  const malformedState = workerWithRequest({ request: { state: [] } });
  const malformedPhase = workerWithRequest({ request: { phase: { raw: "value" } } });
  const malformedReason = workerWithRequest({ request: { terminal_reason: [] } });
  for (const worker of [malformedState, malformedPhase, malformedReason]) {
    assert.equal(providerRequestStatusText(worker), "Providerdetails nicht verfügbar.");
  }
});

test("ignores provider prompt, URL, raw error and task version fields", () => {
  const worker = workerWithRequest({
    request: {
      prompt: "PRIVATE_PROMPT",
      url: "https://private.invalid/provider",
      raw_error: "PRIVATE_ERROR",
      task_version: "NOT_A_PROVIDER_REQUEST_FIELD",
    },
    worker: { current_activity: "PRIVATE_ACTIVITY" },
  });
  const text = providerRequestStatusText(worker);
  assert.equal(text, "Provideranfrage aktiv · Wartet auf Antwort");
  for (const value of ["PRIVATE_PROMPT", "private.invalid", "PRIVATE_ERROR",
    "NOT_A_PROVIDER_REQUEST_FIELD", "PRIVATE_ACTIVITY"]) {
    assert.equal(text.includes(value), false);
  }
});
