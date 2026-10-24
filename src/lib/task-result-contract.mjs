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

export function resultSourceSummary(readback) {
  const unknown = {kind:'unknown', available:false, label:'Herkunft aktuell nicht prüfbar.',
    detail:'Für diese Ansicht liegt kein gültiger Herkunftsbeleg vor.'};
  if (!isRecord(readback) || readback.schema !== 'bach.task-result-readback.v1'
      || readback.verified !== true || !positiveInteger(readback.task_id)
      || !isSha256(readback.task_version)) return unknown;
  const result = readback.result;
  if (!isRecord(result) || result.schema !== 'bach.worker-result.v1'
      || result.task_id !== readback.task_id || !positiveInteger(result.result_id)
      || !isSha256(result.task_version) || !isSha256(result.result_sha256)) return unknown;
  const current = result.task_version === readback.task_version;
  if (result.source_kind === 'external_attested') {
    const provenance = result.external_provenance;
    const scope = result.scope;
    const available = current && isRecord(provenance) && provenance.schema === 'bach.worker-external-attestation.v1'
      && provenance.source_kind === 'external_attested' && provenance.availability === 'available'
      && isRecord(scope) && scope.schema === 'bach.worker-external-scope-evidence.v1'
      && scope.source_kind === 'external_attested' && scope.availability === 'available'
      && isSha256(result.result_revision) && scope.result_revision === result.result_revision
      && provenance.result_revision === result.result_revision;
    return {kind:'external_attested', available,
      label:available ? 'Externe Herkunft bestätigt.' : 'Externe Herkunft · Beleg aktuell nicht verfügbar.',
      detail:available ? 'Ein berechtigter Operator hat die Herkunftsartefakte geprüft. Die Ergebnisabnahme ist separat ausgewiesen.'
        : 'Der externe Beleg ist aktuell nicht verwendbar. Daraus folgt keine Ergebnisabnahme.'};
  }
  if (result.source_kind === 'native') {
    const execution = result.execution;
    const available = current && isRecord(execution) && execution.availability === 'available'
      && typeof execution.execution_id === 'string' && execution.execution_id.length > 0
      && isSha256(execution.execution_revision);
    return {kind:'native', available,
      label:available ? 'BACH-Modelllauf dokumentiert.' : 'BACH-Modelllauf · Beleg aktuell nicht verfügbar.',
      detail:'Ausführungsbeleg und Ergebnisabnahme werden getrennt ausgewiesen.'};
  }
  if (result.source_kind === 'unattested') {
    return {kind:'unattested', available:false, label:'Ausführung noch nicht belegt.',
      detail:'Für dieses Ergebnis liegt noch kein gültiger Ausführungs- oder Herkunftsbeleg vor.'};
  }
  return unknown;
}

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

function currentCompletionEvaluation(readback, result = readback?.result) {
  const evaluation = readback?.completion_evaluation;
  if (!isRecord(readback) || !isRecord(result) || result.completion_policy_version !== 1
      || !isRecord(evaluation) || evaluation.schema !== 'bach.worker-completion-evaluation.v1'
      || evaluation.availability !== 'available' || evaluation.task_id !== readback.task_id
      || evaluation.result_id !== result.result_id || !isSha256(result.result_revision)
      || evaluation.result_revision !== result.result_revision
      || evaluation.result_sha256 !== result.result_sha256 || evaluation.task_version !== readback.task_version
      || evaluation.status !== readback.status || evaluation.status_revision !== readback.status_revision
      || !isRecord(evaluation.decision)
      || typeof evaluation.decision.state !== 'string') return null;
  return evaluation;
}

function currentTaskResult(readback, result = readback?.result) {
  return isRecord(readback) && readback.schema === 'bach.task-result-readback.v1'
    && readback.verified === true && positiveInteger(readback.task_id)
    && isSha256(readback.task_version) && positiveInteger(readback.status_revision)
    && isRecord(result) && result.schema === 'bach.worker-result.v1'
    && result.task_id === readback.task_id && positiveInteger(result.result_id)
    && result.task_version === readback.task_version && isSha256(result.result_sha256);
}

export function taskResultAccepted(readback) {
  const result = readback?.result;
  if (!currentTaskResult(readback, result) || result.accepted !== true || result.reason !== 'accepted'
      || !['done', 'completed'].includes(readback?.status)
      || result.completion_decision?.availability === 'administrative_review_child') return false;
  if (result.completion_policy_version === undefined || result.completion_policy_version === 0) return true;
  if (result.completion_policy_version !== 1) return false;
  const decision = result.completion_decision;
  return isRecord(decision) && decision.availability === 'available'
    && isSha256(result.result_revision) && decision.result_revision === result.result_revision
    && positiveInteger(decision.event_id) && isSha256(decision.decision_sha256);
}

export function taskResultCompletionMessage(readback) {
  const result = readback?.result;
  if (!isRecord(result)) return null;
  if (!currentTaskResult(readback, result)) return 'Das Ergebnis gehört nicht zur aktuellen Auftragsversion.';
  if (result.completion_decision?.availability === 'administrative_review_child'
      && result.accepted === true && result.reason === 'accepted'
      && ['done','completed'].includes(readback.status)) {
    return 'Prüfaufgabe abgeschlossen.';
  }
  if (taskResultAccepted(readback)) return 'Abgenommen · erledigt.';
  if (result.accepted === true && ['done','completed'].includes(readback.status)
      && result.completion_policy_version === 1) return 'Die Abnahme ist im aktuellen Readback nicht bestätigt.';
  if (result.completion_policy_version !== 1) return null;
  const approval = isSha256(result.result_revision)
    && result.user_review_revision === result.result_revision
    && positiveInteger(result.user_review_event_id);
  const prefix = approval ? 'Deine Freigabe ist gespeichert. ' : '';
  const evaluation = currentCompletionEvaluation(readback, result);
  if (!evaluation) {
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
  const state = evaluation.decision.state;
  const message = Object.prototype.hasOwnProperty.call(messages, state) ? messages[state]
    : 'Die übrigen Abschlussbedingungen sind noch nicht bestätigt.';
  return prefix + message;
}

export function taskResultGateSummary(readback) {
  if (!isRecord(readback) || readback.schema !== 'bach.task-result-readback.v1'
      || readback.verified !== true || !positiveInteger(readback.task_id)
      || !isSha256(readback.task_version) || !positiveInteger(readback.status_revision)) return [];
  const result = readback.result;
  if (result === null) return [];
  if (!isRecord(result) || result.schema !== 'bach.worker-result.v1'
      || result.task_id !== readback.task_id || !positiveInteger(result.result_id)
      || !isSha256(result.task_version) || !isSha256(result.result_sha256)) return [];

  const gate = (id, label, state, detail) => ({id, label, state, detail});
  const currentResult = result.task_version === readback.task_version;
  const evaluation = currentResult ? currentCompletionEvaluation(readback, result) : null;
  const decision = evaluation?.decision || null;
  const reviewExpired = Boolean(evaluation && decision.effective_mode === 'balanced'
    && decision.state === 'completed_unreviewed'
    && decision.reason === 'balanced_review_expired_without_adverse_finding'
    && decision.completion_allowed === true);
  const review = result.model_review;
  const reviewCurrent = currentResult && isSha256(result.result_revision) && isRecord(review)
    && review.schema === 'bach.worker-result-review-evidence.v1'
    && review.availability === 'available' && review.task_id === readback.task_id
    && review.result_id === result.result_id && review.result_revision === result.result_revision;
  const gates = [];

  if (!currentResult) {
    gates.push(gate('submission', 'Ergebnisabgabe', 'stale',
      'Das gespeicherte Ergebnis gehört zu einer anderen Auftragsversion.'));
  } else if (isRecord(result.submission)
      && result.submission.schema === 'bach.worker-submission-readback.v1'
      && result.submission.availability === 'available'
      && isSha256(result.submission.receipt_sha256)
      && positiveInteger(result.submission.submitted_status_event_id)
      && result.submitted_status_event_id === result.submission.submitted_status_event_id
      && positiveInteger(result.submission_event_id)
      && typeof result.submission_revision === 'string'
      && /^sha256:[a-f0-9]{64}$/.test(result.submission_revision)) {
    gates.push(gate('submission', 'Ergebnisabgabe', 'confirmed',
      'Der native Abgabebeleg ist für diese Ergebnis-ID und Taskversion bestätigt.'));
  } else {
    gates.push(gate('submission', 'Ergebnisabgabe', 'reported',
      'Ein Ergebnis ist vorhanden; der vollständige aktuelle Abgabebeleg ist nicht bestätigt.'));
  }

  if (!evaluation) {
    gates.push(gate('policy', 'Wirksamer Abschlussmodus', 'unavailable',
      'Eine aktuelle, an Ergebnis und Auftragsversion gebundene Policy-Auswertung liegt nicht vor.'));
    gates.push(gate('task-contract', 'Auftragskriterien', 'unavailable',
      'Eine aktuelle Auswertung der Auftragskriterien liegt nicht vor.'));
    gates.push(gate('self-review', 'Selbstprüfung', 'unavailable',
      'Eine aktuelle native Selbstprüfungs-Auswertung liegt nicht vor.'));
    if (reviewCurrent && review.independent === true && review.policy_eligible === true
        && ['approved', 'findings', 'rejected'].includes(review.status)) {
      gates.push(gate('independent-review', 'Unabhängige Prüfung',
        review.status === 'approved' ? 'reported' : 'blocked',
        review.status === 'approved'
          ? 'Ein unabhängiger, policy-eligible Prüfbeleg für dieses Ergebnis ist vermerkt; die aktuelle Abschluss-Policy fehlt.'
          : review.status === 'findings' ? 'Der vermerkte unabhängige Prüfbeleg enthält einen Befund; die aktuelle Abschluss-Policy fehlt.'
            : 'Der vermerkte unabhängige Prüfbeleg weist das Ergebnis zurück; die aktuelle Abschluss-Policy fehlt.'));
    } else {
      gates.push(gate('independent-review', 'Unabhängige Prüfung', 'unavailable',
        reviewCurrent
          ? 'Ein Prüfbeleg ist vermerkt, aber nicht als unabhängige und policy-eligible Prüfung bestätigt.'
          : 'Eine aktuelle native Prüfungs-Auswertung liegt nicht vor.'));
    }
    const savedUserReview = isSha256(result.result_revision)
      && result.user_review_revision === result.result_revision
      && positiveInteger(result.user_review_event_id);
    gates.push(savedUserReview
      ? gate('user-approval', 'Persönliche Freigabe', 'reported',
        'Ein Freigabeereignis für diese Ergebnisrevision ist vermerkt; ob es die aktuelle Policy-Anforderung erfüllt, ist nicht bestätigt.')
      : gate('user-approval', 'Persönliche Freigabe', 'unavailable',
        'Ob eine persönliche Freigabe erforderlich ist, ist aktuell nicht bestätigt.'));
    gates.push(gate('external-approval', 'Externe GitHub-Prüfung', 'unavailable',
      'Ob eine externe Prüfung erforderlich ist, ist aktuell nicht bestätigt.'));
  } else {
    const modeLabels = {
      simple_task: 'Einfacher Modus',
      balanced: 'Ausgewogener Modus',
      high_security: 'Hochsicherheitsmodus',
    };
    const modeLabel = Object.prototype.hasOwnProperty.call(modeLabels, decision.effective_mode)
      ? modeLabels[decision.effective_mode] : null;
    const sourceLabel = decision.policy_source === 'task_override' ? 'Task-Override'
      : decision.policy_source === 'system_default' ? 'Systemstandard' : null;
    gates.push(modeLabel && sourceLabel
      ? gate('policy', 'Wirksamer Abschlussmodus', 'confirmed',
        modeLabel + ' · Quelle: ' + sourceLabel + '.')
      : gate('policy', 'Wirksamer Abschlussmodus', 'unavailable',
        'Die wirksame Policy oder ihre Herkunft ist in der aktuellen Auswertung nicht bestätigt.'));

    const finding = evaluation.contract_finding;
    const findingSources = {
      predeclared_criteria: 'Vorab festgelegte Auftragskriterien',
      operator_attestation: 'Operator-Bestätigung',
      independent_model_review: 'Unabhängige Prüfung',
      worker_self_check: 'Selbstprüfung des Workers',
      worker_completion_asserted: 'Fertigmeldung des Workers',
      unconfirmed: 'Noch nicht bestätigt',
    };
    if (isRecord(finding) && typeof finding.met === 'boolean'
        && typeof finding.source === 'string'
        && Object.prototype.hasOwnProperty.call(findingSources, finding.source)) {
      const assertionOnly = ['worker_self_check', 'worker_completion_asserted'].includes(finding.source);
      const detail = finding.met
        ? findingSources[finding.source] + (assertionOnly
          ? ' · vom Worker gemeldet, nicht unabhängig nachgewiesen.'
          : ' · laut aktueller Policy-Auswertung erfüllt.')
        : findingSources[finding.source] + ' · Erfüllung aktuell nicht bestätigt.';
      gates.push(gate('task-contract', 'Auftragskriterien', finding.met
        ? assertionOnly ? 'reported' : 'confirmed' : 'pending', detail));
    } else {
      gates.push(gate('task-contract', 'Auftragskriterien', 'unavailable',
        'Die aktuelle Auswertung enthält keinen bestätigten Status der Auftragskriterien.'));
    }

    const selfCheck = evaluation.worker_self_check;
    const completionAssertion = evaluation.worker_completion_assertion;
    if (isRecord(selfCheck) && selfCheck.availability === 'available' && selfCheck.met === true) {
      gates.push(gate('self-review', 'Selbstprüfung', 'reported',
        'Der Worker hat einen strukturierten Selbstcheck abgegeben; das ist kein unabhängiger Nachweis.'));
    } else if (isRecord(completionAssertion) && completionAssertion.availability === 'available'
        && completionAssertion.met === true) {
      gates.push(gate('self-review', 'Selbstprüfung', 'reported',
        'Eine Fertigmeldung des Workers liegt vor; ein strukturierter Selbstcheck ist nicht belegt.'));
    } else {
      gates.push(gate('self-review', 'Selbstprüfung', 'unavailable',
        'Eine gültige Selbstprüfung ist im aktuellen Ergebnis nicht bestätigt.'));
    }

    if (reviewExpired) {
      gates.push(gate('independent-review', 'Unabhängige Prüfung', 'unavailable',
        'Kein unabhängiger Prüfbeleg liegt vor; die aktuelle Policy-Auswertung weist den Fristablauf separat aus.'));
      gates.push(gate('review-expiry', 'Reviewfrist', 'expired',
        'Ablauf laut aktueller Balanced-Policy. Dadurch entfallen keine Nutzer- oder externen Freigaben und das Ergebnis gilt nicht als abgenommen.'));
    } else if (reviewCurrent && (review.independent !== true || review.policy_eligible !== true)) {
      gates.push(gate('independent-review', 'Unabhängige Prüfung', 'unavailable',
        'Ein Prüfbeleg ist vorhanden, aber für diesen Abschluss nicht als unabhängige und policy-eligible Prüfung bestätigt.'));
    } else if (reviewCurrent && review.independent === true && review.policy_eligible === true
        && ['approved', 'findings', 'rejected'].includes(review.status)) {
      const policyStillAwaitingReview = review.status === 'approved'
        && ['awaiting_review', 'completed_unreviewed'].includes(decision.state);
      const reviewState = review.status === 'approved'
        ? policyStillAwaitingReview ? 'reported' : 'confirmed' : 'blocked';
      const reviewDetail = review.status === 'approved'
        ? policyStillAwaitingReview
          ? 'Ein unabhängiger, policy-eligible Prüfbeleg ist vermerkt; die aktuelle Policy-Auswertung bestätigt den Review-Gate noch nicht.'
          : 'Die unabhängige Prüfung ist aktuell und policy-eligible belegt.'
        : review.status === 'findings' ? 'Die unabhängige Prüfung meldet einen Befund.'
          : 'Die unabhängige Prüfung hat das Ergebnis zurückgewiesen.';
      gates.push(gate('independent-review', 'Unabhängige Prüfung', reviewState, reviewDetail));
    } else if (decision.state === 'awaiting_review') {
      gates.push(gate('independent-review', 'Unabhängige Prüfung', 'pending',
        'Die aktuelle Policy-Auswertung meldet die unabhängige Modellprüfung als ausstehend.'));
    } else {
      gates.push(gate('independent-review', 'Unabhängige Prüfung', 'unavailable',
        'Ein aktueller unabhängiger, policy-eligible Prüfbeleg ist nicht bestätigt.'));
    }

    if (typeof evaluation.user_review_required === 'boolean'
        && typeof evaluation.user_approved === 'boolean') {
      if (!evaluation.user_review_required) {
        gates.push(gate('user-approval', 'Persönliche Freigabe', 'not_required',
          'Die aktuelle Policy-Auswertung verlangt keine persönliche Freigabe.'));
      } else if (!evaluation.user_approved) {
        gates.push(gate('user-approval', 'Persönliche Freigabe', 'pending',
          'Die aktuelle Policy-Auswertung verlangt eine persönliche Freigabe, die noch nicht belegt ist.'));
      } else if (decision.state === 'awaiting_user_review') {
        gates.push(gate('user-approval', 'Persönliche Freigabe', 'reported',
          'Ein Freigabebeleg ist vermerkt, aber die aktuelle Policy-Auswertung meldet die persönliche Freigabe weiterhin als ausstehend.'));
      } else {
        gates.push(gate('user-approval', 'Persönliche Freigabe', 'confirmed',
          'Die erforderliche persönliche Freigabe ist für diese Ergebnisrevision belegt.'));
      }
    } else {
      gates.push(gate('user-approval', 'Persönliche Freigabe', 'unavailable',
        'Der Status der persönlichen Freigabe ist in der aktuellen Auswertung nicht bestätigt.'));
    }

    const github = evaluation.github;
    const githubCurrent = isRecord(github) && github.availability === 'available'
      && github.task_id === String(readback.task_id) && github.result_revision === result.result_revision;
    if (typeof evaluation.github_pr_review_required !== 'boolean') {
      gates.push(gate('external-approval', 'Externe GitHub-Prüfung', 'unavailable',
        'Der aktuelle Bedarf an einer externen Prüfung ist nicht bestätigt.'));
    } else if (!evaluation.github_pr_review_required) {
      gates.push(gate('external-approval', 'Externe GitHub-Prüfung', 'not_required',
        'Die aktuelle Policy-Auswertung verlangt keine externe GitHub-Prüfung.'));
    } else if (githubCurrent && github.status === 'verified'
        && decision.state === 'awaiting_external_review') {
      gates.push(gate('external-approval', 'Externe GitHub-Prüfung', 'reported',
        'Ein externer Prüfbeleg ist vermerkt, aber die aktuelle Policy-Auswertung meldet diese Prüfung weiterhin als ausstehend.'));
    } else if (githubCurrent && github.status === 'verified') {
      gates.push(gate('external-approval', 'Externe GitHub-Prüfung', 'confirmed',
        'Die externe Prüfung ist für diese Ergebnisrevision aktuell bestätigt.'));
    } else if (githubCurrent && github.status === 'rejected') {
      gates.push(gate('external-approval', 'Externe GitHub-Prüfung', 'blocked',
        'Die externe Prüfung meldet eine Zurückweisung.'));
    } else if (decision.state === 'awaiting_external_review') {
      gates.push(gate('external-approval', 'Externe GitHub-Prüfung', 'pending',
        'Die aktuelle Policy-Auswertung meldet die erforderliche externe Prüfung als ausstehend.'));
    } else {
      gates.push(gate('external-approval', 'Externe GitHub-Prüfung', 'unavailable',
        'Die erforderliche externe Prüfung ist aktuell nicht bestätigt.'));
    }
  }

  const completionDecision = result.completion_decision;
  const administrativeReviewChild = isRecord(completionDecision)
    && completionDecision.availability === 'administrative_review_child';
  const accepted = currentResult && taskResultAccepted(readback);
  if (administrativeReviewChild) {
    gates.push(gate('acceptance', 'Tatsächliche Abnahme', 'reported',
      'Die Prüfaufgabe ist abgeschlossen; daraus folgt keine Abnahme des geprüften Zielergebnisses.'));
  } else if (accepted) {
    gates.push(gate('acceptance', 'Tatsächliche Abnahme', 'confirmed',
      'Native Ergebnisabnahme und Taskstatus sind gemeinsam bestätigt.'));
  } else if (evaluation && decision.completion_allowed === true) {
    gates.push(gate('acceptance', 'Tatsächliche Abnahme', 'pending',
      'Die Policy-Bedingungen sind erfüllt; die tatsächliche Ergebnisabnahme ist noch nicht bestätigt.'));
  } else if (readback.status === 'review' || result.reason === 'awaiting_review') {
    gates.push(gate('acceptance', 'Tatsächliche Abnahme', 'pending',
      'Das Ergebnis ist abgegeben; eine tatsächliche Abnahme liegt noch nicht vor.'));
  } else {
    gates.push(gate('acceptance', 'Tatsächliche Abnahme', 'unavailable',
      'Eine tatsächliche Abnahme ist im aktuellen Readback nicht bestätigt.'));
  }

  if (evaluation && typeof decision.worker_may_claim_next === 'boolean') {
    gates.push(decision.worker_may_claim_next
      ? gate('next-task', 'Nächste Worker-Aufgabe', 'confirmed',
        'Die aktuelle Policy hält diesen Worker wegen der offenen Ergebnisabnahme nicht zurück.')
      : gate('next-task', 'Nächste Worker-Aufgabe', 'blocked',
        'Die aktuelle Policy bestätigt keine nächste Übernahme.'));
  } else {
    gates.push(gate('next-task', 'Nächste Worker-Aufgabe', 'unavailable',
      'Eine aktuelle Policy-Aussage zur nächsten Übernahme liegt nicht vor.'));
  }
  return gates;
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
