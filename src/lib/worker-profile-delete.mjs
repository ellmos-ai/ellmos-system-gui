// Shared GUI consumer validation. The native controller owns deletion and leases.
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CORE_IDS = new Set(['buddha_chat', 'buddha_always_on', 'buddha_connector']);

export function readWorkerProfiles(data, now = Date.now()) {
  if (!data || data.schema !== 'bach.workers.status.v1' || data.availability !== 'available' || !Array.isArray(data.workers))
    throw new Error('Der aktuelle Profilbestand ist nicht bestätigt.');
  const observed = Date.parse(data.observed_at);
  if (!Number.isFinite(now) || !Number.isFinite(observed) || Math.abs(now - observed) > 120000)
    throw new Error('Der Profilstatus ist veraltet oder hat keinen gültigen Zeitbeleg. Bitte neu prüfen.');
  const seen = new Set();
  for (const worker of data.workers) {
    if (!worker || typeof worker.id !== 'string' || !ID.test(worker.id) || seen.has(worker.id))
      throw new Error('Der Profilbestand enthält ungültige oder doppelte Kennungen.');
    seen.add(worker.id);
  }
  return data.workers;
}

export function deletionState(worker, pending = false) {
  const blocked = reason => ({allowed: false, reason});
  if (!worker || typeof worker.id !== 'string' || !ID.test(worker.id))
    return blocked('Profilstatus zuerst neu prüfen.');
  if ((worker.system != null && typeof worker.system !== 'boolean') ||
      (worker.deletable != null && typeof worker.deletable !== 'boolean'))
    return blocked('Der Profilschutz ist nicht bestätigt. Bitte neu prüfen.');
  if (worker.system === true || worker.deletable === false || CORE_IDS.has(worker.id))
    return blocked('Dieses Systemprofil ist geschützt.');
  if (pending) return blocked('Löschung wird bereits geprüft.');
  if (worker.runtime_verified !== true || typeof worker.worker_active !== 'boolean' || typeof worker.running !== 'boolean')
    return blocked('Der tatsächliche Laufstatus ist nicht bestätigt. Bitte neu prüfen.');
  if (worker.worker_active || worker.running)
    return blocked('Den Agenten zuerst geordnet stoppen und das Laufende bestätigen lassen.');
  if (['starting', 'stopping', 'finishing', 'unconfirmed'].includes(worker.status) ||
      (worker.execution != null && worker.execution.terminal !== true))
    return blocked('Das Ende des vorherigen Laufs ist noch nicht bestätigt.');
  if (!['idle', 'paused', 'completed', 'expired', 'error', 'stopped', 'cancelled', 'running'].includes(worker.status))
    return blocked('Der Profilzustand ist nicht eindeutig. Bitte neu prüfen.');
  if (worker.status === 'running' && worker.execution?.terminal !== true)
    return blocked('Der gespeicherte Laufstatus muss zuerst geklärt werden.');
  return {allowed: true, reason: 'Inaktives Agentenprofil löschen'};
}

export function requireDeleteAck(data, workerId) {
  if (!data || data.ok !== true || data.action !== 'delete' || data.id !== workerId)
    throw new Error('Die Löschung wurde nicht eindeutig bestätigt. Bestand neu prüfen; nicht blind wiederholen.');
}

export function deletionError(status, data) {
  if (status === 401 || status === 403) return 'Die Löschung benötigt eine gültige Geräteanmeldung und Berechtigung.';
  if (status === 404) return 'Das Profil wurde nicht gefunden. Bitte den Bestand neu prüfen.';
  const detail = typeof data?.detail === 'string' ? data.detail.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 260) : '';
  if (status === 409) return detail || 'Löschung abgelehnt: Das Ende des Laufs, freie Leases und der Profilzustand müssen bestätigt sein.';
  if (status === 503) return detail || 'Löschung oder Belegarchiv konnten nicht bestätigt werden. Bitte neu prüfen.';
  return detail || 'Das Agentenprofil konnte nicht bestätigt gelöscht werden.';
}
