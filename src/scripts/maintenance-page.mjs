// SPDX-License-Identifier: MIT
// Live status reader for /maintenance (PB-5 #3989). Uses DOM nodes & textContent only.

function setText(doc, id, value) {
  const el = doc.getElementById(id);
  if (el) el.textContent = String(value);
}

function setBadge(doc, id, label, tone = '') {
  const el = doc.getElementById(id);
  if (!el) return;
  el.textContent = label;
  if (tone) el.dataset.tone = tone;
  else delete el.dataset.tone;
}

function formatIso(value) {
  if (!value || typeof value !== 'string') return '–';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('de-DE');
}

async function readJsonResponse(responsePromise) {
  try {
    const res = await responsePromise;
    if (!res.ok) return { ok: false, status: res.status, data: null };
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || 'Netzwerkfehler', data: null };
  }
}

export async function refreshMaintenanceStatus(doc = document, fetcher = globalThis.fetch) {
  setText(doc, 'maint-live-status', 'Prüfe Live-Quellen (Wartung, Daemon, Locks, Datenbank)…');

  const [wartung, daemon, locks, memory] = await Promise.all([
    readJsonResponse(fetcher('/api/wartung/status', { cache: 'no-store' })),
    readJsonResponse(fetcher('/api/daemon/status', { cache: 'no-store' })),
    readJsonResponse(fetcher('/api/governance/locks', { cache: 'no-store' })),
    readJsonResponse(fetcher('/api/memory/cognitive-state', { cache: 'no-store' })),
  ]);

  let okCount = 0;

  // 1. System-Health & Daemon
  if (daemon.ok && daemon.data) {
    okCount += 1;
    const d = daemon.data;
    const running = d.running === true;
    const pid = d.pid ? `PID ${d.pid}` : 'ohne PID';
    const verified = d.identity === 'verified' ? ' · verifiziert' : '';
    setBadge(doc, 'maint-health-badge', running ? `Aktiv (${pid}${verified})` : 'Daemon gestoppt', running ? 'ok' : 'warn');
    const jobs = d.stats?.active_jobs ?? d.stats?.total_jobs;
    const runsToday = d.stats?.runs_today;
    const latestRun = Array.isArray(d.last_runs) && d.last_runs.length ? d.last_runs[0] : null;
    const detail = [
      Number.isInteger(jobs) ? `${jobs} Jobs aktiv` : 'Jobs nicht bestätigt',
      Number.isInteger(runsToday) ? `${runsToday} Läufe heute` : null,
      latestRun ? `Letzter Lauf: ${latestRun.name} (${latestRun.result})` : null,
    ].filter(Boolean).join(' · ');
    setText(doc, 'maint-health-detail', detail);
    setText(doc, 'maint-kpi-daemon', running ? `Aktiv (${pid})` : 'Gestoppt');
  } else {
    setBadge(doc, 'maint-health-badge', 'Nicht erreichbar', 'err');
    setText(doc, 'maint-health-detail', 'Daemon-Endpunkt (/api/daemon/status) nicht bestätigt.');
    setText(doc, 'maint-kpi-daemon', 'Unbekannt');
  }

  // 2. Datenbankpflege & Backups
  if (memory.ok && memory.data?.langzeit_gedaechtnis) {
    okCount += 1;
    const lzg = memory.data.langzeit_gedaechtnis;
    const parts = [
      Number.isInteger(lzg.facts?.count) ? `${lzg.facts.count.toLocaleString('de-DE')} Fakten` : null,
      Number.isInteger(lzg.lessons?.count) ? `${lzg.lessons.count.toLocaleString('de-DE')} Lessons` : null,
      Number.isInteger(lzg.working?.count) ? `${lzg.working.count.toLocaleString('de-DE')} Working` : null,
      Number.isInteger(lzg.sessions?.count) ? `${lzg.sessions.count.toLocaleString('de-DE')} Sessions` : null,
    ].filter(Boolean);
    setText(doc, 'maint-db-detail', parts.length ? parts.join(' · ') : 'Keine Tabellenwerte bestätigt.');
    setBadge(doc, 'maint-db-badge', 'bach.db erreichbar', 'ok');
  } else {
    setBadge(doc, 'maint-db-badge', 'Nicht geprüft', 'warn');
    setText(doc, 'maint-db-detail', 'Datenbank-Bestände (/api/memory/cognitive-state) nicht bestätigt.');
  }

  if (wartung.ok && wartung.data && !wartung.data.error) {
    okCount += 1;
    const backup = wartung.data.backup || {};
    const count = Number.isInteger(backup.backup_count) ? backup.backup_count : 0;
    const last = backup.last_backup ? formatIso(backup.last_backup) : 'noch nicht erfasst';
    setText(doc, 'maint-kpi-backup', count > 0 ? `${count} Backups` : 'Kein Backup gezählt');
    setText(doc, 'maint-backup-detail', count > 0 ? `${count} Sicherungen · letztes Backup: ${last}` : 'Keine Sicherungen im Backup-Verzeichnis gezählt.');
  } else {
    setText(doc, 'maint-kpi-backup', 'Unbekannt');
    setText(doc, 'maint-backup-detail', 'Wartungsstatus (/api/wartung/status) nicht bestätigt.');
  }

  // 3. Lock-Hygiene & Sperren
  if (locks.ok && locks.data) {
    okCount += 1;
    const avail = locks.data.availability === 'available';
    const count = Number.isInteger(locks.data.count) ? locks.data.count : null;
    setBadge(doc, 'maint-locks-badge', avail ? (count === 0 ? '0 Sperren' : `${count} aktiv`) : 'Unbekannt', avail ? 'ok' : 'warn');
    setText(doc, 'maint-kpi-locks', avail && count !== null ? `${count} aktiv` : 'Unbekannt');
    setText(
      doc,
      'maint-locks-detail',
      avail
        ? `Quelle: ${locks.data.source || 'lock_scan'} · Stand: ${formatIso(locks.data.scanned_at)}`
        : `Lock-Quelle nicht verfügbar (${locks.data.error || 'unbekannt'}).`,
    );
  } else {
    setBadge(doc, 'maint-locks-badge', 'Nicht erreichbar', 'err');
    setText(doc, 'maint-kpi-locks', 'Unbekannt');
    setText(doc, 'maint-locks-detail', 'Lock-Monitor (/api/governance/locks) nicht bestätigt.');
  }

  const now = new Date().toLocaleTimeString('de-DE');
  setText(doc, 'maint-kpi-sources', `${okCount} / 4 erreichbar`);
  setText(doc, 'maint-live-status', `Live-Prüfung abgeschlossen (${now}): ${okCount} von 4 Quellen bestätigt.`);
  return { okCount, wartung, daemon, locks, memory };
}

export function initializeMaintenancePage(doc = document, fetcher = globalThis.fetch) {
  const btn = doc.getElementById('maint-refresh-btn');
  if (!btn) return;
  btn.addEventListener('click', () => refreshMaintenanceStatus(doc, fetcher));
  refreshMaintenanceStatus(doc, fetcher);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initializeMaintenancePage(), { once: true });
  } else {
    initializeMaintenancePage();
  }
}
