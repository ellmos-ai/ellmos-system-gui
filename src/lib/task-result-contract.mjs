const SHA256 = /^[a-f0-9]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HISTORY_SCHEMA = 'bach.task-result-history.v1';
const CORRECTION_SCHEMA = 'bach.task-result-correction-request.v1';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const isSha256 = value => typeof value === 'string' && SHA256.test(value);
const resultMaxCharsKeys = 'max,min,nullable,supported';
const isTimestamp = value => {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, , offsetHourText, offsetMinuteText] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== 'Z' && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false;
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1
      || calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour
      || calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) return false;
  return Number.isFinite(Date.parse(value));
};

export function resultOperatorCapabilities(readback) {
  if (!isRecord(readback) || readback.schema !== 'bach.task-result-readback.v1' || readback.verified !== true) {
    return {valid:false, accept_result:false, request_correction:false};
  }
  if (!Object.prototype.hasOwnProperty.call(readback, 'operator_capabilities')) {
    // Older servers and old operator tokens can still use the existing accept flow.
    return {valid:true, legacy:true, accept_result:true, request_correction:false};
  }
  const capabilities = readback.operator_capabilities;
  if (!isRecord(capabilities)
      || Object.keys(capabilities).sort().join(',') !== 'accept_result,request_correction'
      || typeof capabilities.accept_result !== 'boolean'
      || typeof capabilities.request_correction !== 'boolean') {
    return {valid:false, accept_result:false, request_correction:false};
  }
  return {valid:true, legacy:false, ...capabilities};
}

export function supportsTaskResultMaxChars(capabilities) {
  const limits = isRecord(capabilities) ? capabilities.result_max_chars : null;
  return isRecord(capabilities) && Object.keys(capabilities).sort().join(',') === 'result_max_chars,schema'
    && capabilities.schema === 'bach.task-capabilities.v1'
    && isRecord(limits) && Object.keys(limits).sort().join(',') === resultMaxCharsKeys
    && limits.supported === true && limits.min === 1 && limits.max === 3000 && limits.nullable === true;
}

export function taskResultMaxCharsReadback(task) {
  if (!isRecord(task) || !Object.prototype.hasOwnProperty.call(task, 'result_max_chars')) {
    return {supported:false, value:null};
  }
  const value = task.result_max_chars;
  if (value === null) return {supported:true, value:null};
  if (Number.isSafeInteger(value) && value >= 1 && value <= 3000) return {supported:true, value};
  return {supported:false, value:null};
}

export function parseTaskResultMaxCharsInput(value) {
  if (typeof value !== 'string') return {valid:false, present:false, value:null};
  const text = value.trim();
  if (!text) return {valid:true, present:false, value:null};
  if (!/^\d+$/.test(text)) return {valid:false, present:false, value:null};
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 3000) return {valid:false, present:false, value:null};
  return {valid:true, present:true, value:parsed};
}

export function resultMaxCharsCreateChange(capabilities, input) {
  if (!supportsTaskResultMaxChars(capabilities)) return {supported:false, valid:false, include:false, value:null};
  const parsed = parseTaskResultMaxCharsInput(input);
  return {supported:true, valid:parsed.valid, include:parsed.valid && parsed.present,
    value:parsed.valid && parsed.present ? parsed.value : null};
}

export function resultMaxCharsEditChange(capabilities, task, input) {
  if (!supportsTaskResultMaxChars(capabilities)) return {supported:false, valid:false, changed:false, value:null};
  const current = taskResultMaxCharsReadback(task);
  if (!current.supported) return {supported:false, valid:false, changed:false, value:null};
  const parsed = parseTaskResultMaxCharsInput(input);
  const value = parsed.valid && parsed.present ? parsed.value : null;
  return {supported:true, valid:parsed.valid, changed:parsed.valid && value !== current.value, value};
}

export function isCurrentCorrectionTarget(readback, taskId) {
  if (!positiveInteger(taskId) || !isRecord(readback) || readback.schema !== 'bach.task-result-readback.v1'
      || readback.verified !== true || readback.task_id !== taskId || readback.status !== 'review'
      || !positiveInteger(readback.status_revision) || !isSha256(readback.task_version)) return false;
  const result = readback.result;
  return isRecord(result) && result.schema === 'bach.worker-result.v1'
    && result.task_id === taskId && result.reason === 'awaiting_review' && result.accepted === false
    && positiveInteger(result.result_id) && isSha256(result.result_sha256)
    && typeof result.generation === 'string' && result.generation.length > 0
    && positiveInteger(result.fence) && result.task_version === readback.task_version;
}

export function canConfirmTaskResult(readback) {
  if (!isCurrentCorrectionTarget(readback, readback?.task_id)) return false;
  const result = readback.result;
  const version = result.completion_policy_version;
  if (version === undefined || version === 0) return true;
  return version === 1 && isSha256(result.result_revision)
    && !(result.user_review_revision === result.result_revision
      && positiveInteger(result.user_review_event_id)
      && result.contract_attestation_revision === result.result_revision
      && positiveInteger(result.contract_attestation_event_id));
}

export function buildResultAcceptanceRequest(readback) {
  if (!canConfirmTaskResult(readback)) {
    throw new Error('Ergebnis oder Auftragsversion ist nicht aktuell. Task erneut öffnen.');
  }
  const result = readback.result;
  const payload = {result_id:result.result_id, result_sha256:result.result_sha256,
    task_version:readback.task_version, status_revision:readback.status_revision};
  if (result.completion_policy_version === 1) {
    payload.result_revision = result.result_revision;
    payload.task_contract_met = true;
  }
  return payload;
}

export function resultAcceptanceConfirmed(observed, answer, fresh) {
  if (!isCurrentCorrectionTarget(observed, observed?.task_id)) return false;
  const before = observed.result;
  const matches = value => isRecord(value) && value.schema === 'bach.task-result-readback.v1'
    && value.verified === true && value.task_id === observed.task_id
    && value.task_version === observed.task_version && positiveInteger(value.status_revision)
    && value.status_revision >= observed.status_revision
    && value.result?.result_id === before.result_id
    && value.result?.result_sha256 === before.result_sha256
    && value.result?.task_version === before.task_version;
  if (!matches(answer) || !matches(fresh) || answer.status !== fresh.status
      || answer.status_revision !== fresh.status_revision
      || typeof answer.result.accepted !== 'boolean'
      || answer.result.accepted !== fresh.result.accepted) return false;
  const completed = ['done','completed'].includes(fresh.status) && fresh.result.accepted === true;
  const waiting = fresh.status === 'review' && fresh.result.accepted === false;
  if (!completed && !waiting) return false;
  if (before.completion_policy_version === undefined || before.completion_policy_version === 0) {
    return completed && fresh.status_revision > observed.status_revision;
  }
  if (before.completion_policy_version !== 1 || !isSha256(before.result_revision)) return false;
  for (const value of [answer.result, fresh.result]) {
    if (value.completion_policy_version !== 1 || value.result_revision !== before.result_revision
        || value.user_review_revision !== before.result_revision
        || value.contract_attestation_revision !== before.result_revision
        || !positiveInteger(value.user_review_event_id)
        || !positiveInteger(value.contract_attestation_event_id)) return false;
  }
  return answer.result.user_review_event_id === fresh.result.user_review_event_id
    && answer.result.contract_attestation_event_id === fresh.result.contract_attestation_event_id;
}

export function taskResultCompletionMessage(readback) {
  const result = readback?.result;
  if (!isRecord(result)) return null;
  if (result.accepted === true && ['done','completed'].includes(readback.status)) {
    if (result.completion_decision?.availability === 'administrative_review_child') {
      return 'Prüfaufgabe abgeschlossen.';
    }
    return 'Abgenommen · erledigt.';
  }
  if (result.completion_policy_version !== 1) return null;
  const evaluation = readback.completion_evaluation;
  const approval = isSha256(result.result_revision)
    && result.user_review_revision === result.result_revision
    && positiveInteger(result.user_review_event_id);
  const prefix = approval ? 'Deine Freigabe ist gespeichert. ' : '';
  if (!isRecord(evaluation) || evaluation.schema !== 'bach.worker-completion-evaluation.v1'
      || evaluation.task_id !== readback.task_id || evaluation.result_id !== result.result_id
      || evaluation.result_revision !== result.result_revision || evaluation.availability !== 'available') {
    return prefix + 'Die übrigen Abschlussbedingungen sind noch nicht bestätigt.';
  }
  const messages = {
    awaiting_user_review:'Wartet auf deine fachliche Bestätigung.',
    awaiting_external_review:'Die erforderliche GitHub-Prüfung steht noch aus.',
    awaiting_review:'Die unabhängige Modellprüfung steht noch aus.',
    correction_required:'Eine Korrektur ist erforderlich.',
    result_incomplete:'Die Auftragskriterien oder Ergebnisnachweise sind noch nicht vollständig bestätigt.',
    integrity_blocked:'Die Ergebnisbelege sind nicht aktuell bestätigt. Task erneut öffnen.',
    completed:'Die Abschlussbedingungen sind erfüllt; der Taskabschluss ist noch nicht bestätigt.',
    completed_unreviewed:'Die Abschlussbedingungen sind erfüllt; der Taskabschluss ist noch nicht bestätigt.',
  };
  return prefix + (messages[evaluation.decision?.state] || 'Die übrigen Abschlussbedingungen sind noch nicht bestätigt.');
}

export function normalizeCorrectionNote(value) {
  if (typeof value !== 'string') return null;
  const note = value.trim();
  const length = Array.from(note).length;
  return length >= 1 && length <= 1200 ? note : null;
}

export function generateCorrectionRequestId(cryptoApi = globalThis.crypto) {
  if (!cryptoApi || typeof cryptoApi.randomUUID !== 'function') {
    throw new Error('Sichere Korrekturanforderung ist in diesem Browser nicht verfügbar.');
  }
  const requestId = cryptoApi.randomUUID().toLowerCase();
  if (!UUID_V4.test(requestId)) throw new Error('Korrekturanforderung konnte nicht sicher vorbereitet werden.');
  return requestId;
}

export function buildCorrectionRequest(readback, taskId, note, requestId) {
  const correctionNote = normalizeCorrectionNote(note);
  if (!isCurrentCorrectionTarget(readback, taskId) || correctionNote === null
      || typeof requestId !== 'string' || !UUID_V4.test(requestId)) {
    throw new Error('Ergebnis oder Korrekturhinweis ist nicht mehr gültig. Task erneut öffnen.');
  }
  const result = readback.result;
  return {
    result_id: result.result_id,
    result_sha256: result.result_sha256,
    generation: result.generation,
    fence: result.fence,
    task_version: readback.task_version,
    status_revision: readback.status_revision,
    request_id: requestId,
    correction_note: correctionNote
  };
}

export function createCorrectionAttempt(readback, taskId, revision, note, requestId) {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('Die Taskansicht ist nicht mehr aktuell. Task erneut öffnen.');
  }
  const body = Object.freeze(buildCorrectionRequest(readback, taskId, note, requestId));
  return Object.freeze({
    state:'ready', revision, task_id:taskId, task_version:body.task_version,
    result_id:body.result_id, result_sha256:body.result_sha256,
    status_revision:body.status_revision, request_id:body.request_id, body
  });
}

export function correctionAttemptMatchesView(attempt, readback, taskId, revision) {
  return isRecord(attempt) && attempt.state === 'ready' && attempt.task_id === taskId
    && attempt.revision === revision && Number.isSafeInteger(revision)
    && isCurrentCorrectionTarget(readback, taskId)
    && attempt.task_version === readback.task_version
    && attempt.status_revision === readback.status_revision
    && attempt.result_id === readback.result.result_id
    && attempt.result_sha256 === readback.result.result_sha256
    && attempt.request_id === attempt.body?.request_id;
}

export function validateCorrectionAcknowledgement(answer, expected) {
  return isRecord(answer) && answer.schema === CORRECTION_SCHEMA
    && answer.request_id === expected.request_id && answer.task_id === expected.task_id
    && positiveInteger(answer.correction_id) && positiveInteger(answer.correction_round)
    && answer.source_result_id === expected.result_id
    && answer.source_result_sha256 === expected.result_sha256
    && answer.status === 'pending' && isSha256(answer.next_task_version)
    && answer.next_task_version !== expected.task_version && typeof answer.replayed === 'boolean';
}

export function transitionCorrectionAttempt(attempt, status, answer) {
  if (!isRecord(attempt) || attempt.state !== 'ready') return {state:'reopen_required'};
  if (status === 403 || status === 422) return {state:'rejected'};
  const expected = {task_id:attempt.task_id, request_id:attempt.request_id,
    result_id:attempt.result_id, result_sha256:attempt.result_sha256,
    task_version:attempt.task_version};
  if (Number.isSafeInteger(status) && status >= 200 && status < 300
      && validateCorrectionAcknowledgement(answer, expected)) {
    return {state:'acknowledged', answer};
  }
  return {state:'reopen_required'};
}

function validateHistoryEvent(event) {
  if (!isRecord(event) || !positiveInteger(event.event_id) || !isTimestamp(event.occurred_at)) return null;
  if (event.type === 'result_submitted') {
    const result = event.result;
    if (!isRecord(result) || !positiveInteger(result.result_id) || !isSha256(result.result_sha256)
        || typeof result.text !== 'string' || typeof result.generation !== 'string' || !result.generation
        || !positiveInteger(result.fence) || !isSha256(result.task_version)) return null;
    return {event_id:event.event_id, type:event.type, occurred_at:event.occurred_at,
      result:{result_id:result.result_id, result_sha256:result.result_sha256, text:result.text,
        generation:result.generation, fence:result.fence, task_version:result.task_version}};
  }
  if (event.type === 'result_accepted') {
    const result = event.result;
    if (!isRecord(result) || !positiveInteger(result.result_id) || !isSha256(result.result_sha256)) return null;
    return {event_id:event.event_id, type:event.type, occurred_at:event.occurred_at,
      result:{result_id:result.result_id, result_sha256:result.result_sha256}};
  }
  if (event.type === 'correction_requested') {
    const correction = event.correction;
    const note = isRecord(correction) ? normalizeCorrectionNote(correction.note) : null;
    if (!isRecord(correction) || !positiveInteger(correction.correction_id)
        || !positiveInteger(correction.correction_round) || !positiveInteger(correction.source_result_id)
        || !isSha256(correction.source_result_sha256) || note === null || typeof correction.request_id !== 'string'
        || !UUID_V4.test(correction.request_id)) return null;
    return {event_id:event.event_id, type:event.type, occurred_at:event.occurred_at,
      correction:{correction_id:correction.correction_id, correction_round:correction.correction_round,
        source_result_id:correction.source_result_id, source_result_sha256:correction.source_result_sha256,
        note, request_id:correction.request_id}};
  }
  return null;
}

export function validateResultHistoryPage(value, taskId, {limit = 20, beforeEventId = null} = {}) {
  if (!isRecord(value) || value.schema !== HISTORY_SCHEMA || value.task_id !== taskId
      || !Array.isArray(value.events) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50
      || !(beforeEventId === null || positiveInteger(beforeEventId))
      || typeof value.has_more !== 'boolean'
      || !(value.next_before_event_id === null || positiveInteger(value.next_before_event_id))) return null;
  if (value.events.length > limit) return null;
  const events = value.events.map(validateHistoryEvent);
  if (events.some(event => event === null)) return null;
  for (let index = 0; index < events.length; index += 1) {
    if (beforeEventId !== null && events[index].event_id >= beforeEventId) return null;
    if (index > 0 && events[index - 1].event_id <= events[index].event_id) return null;
  }
  if (value.has_more) {
    if (events.length !== limit || events.length === 0
        || value.next_before_event_id !== events.at(-1).event_id) return null;
  } else if (value.next_before_event_id !== null) return null;
  return {schema:HISTORY_SCHEMA, task_id:taskId, events, next_before_event_id:value.next_before_event_id,
    has_more:value.has_more};
}
