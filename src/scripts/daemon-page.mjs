// Client-Logik für /daemon — Live-Daemon-Status, Cron-Jobs & Läufe via DOM-Textknoten
const byId = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function setStatus(text, tone = 'info') {
  const node = byId('dm-status');
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

function syncTabView() {
  const showChains = new URLSearchParams(window.location.search).get('tab') === 'chains';
  const services = byId('daemon-services-panel');
  const chains = byId('daemon-chain-content');
  const tabServices = byId('dm-tab-services');
  const tabChains = byId('dm-tab-chains');
  if (services) services.hidden = showChains;
  if (chains) chains.hidden = !showChains;
  if (tabServices) {
    tabServices.classList.toggle('btn-primary', !showChains);
    tabServices.classList.toggle('btn-secondary', showChains);
  }
  if (tabChains) {
    tabChains.classList.toggle('btn-primary', showChains);
    tabChains.classList.toggle('btn-secondary', !showChains);
  }
  return showChains;
}

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || body.error || `HTTP ${res.status}`);
  return body;
}

async function loadDaemon() {
  setStatus('Lade Daemon-Status, Jobs und Läufe …');
  try {
    const [statusData, jobsData, runsData, wartungData] = await Promise.all([
      fetch('/api/daemon/status', { method: 'GET' }).then(readJson),
      fetch('/api/daemon/jobs', { method: 'GET' }).then(readJson),
      fetch('/api/daemon/runs', { method: 'GET' }).then(readJson),
      fetch('/api/wartung/status', { method: 'GET' }).then(readJson),
    ]);

    const running = statusData.running === true;
    byId('dm-kpi-running').textContent = running ? `Aktiv (PID ${statusData.pid ?? '?'})` : 'Gestoppt';
    byId('dm-kpi-identity').textContent = [statusData.identity || 'unbekannt', statusData.identity_reason || ''].filter(Boolean).join(' · ');

    const jobs = Array.isArray(jobsData.jobs) ? jobsData.jobs : [];
    const activeCount = jobs.filter((j) => Number(j.is_active) === 1 || j.is_active === true).length;
    byId('dm-kpi-jobs').textContent = String(jobs.length);
    byId('dm-kpi-active').textContent = `${activeCount} aktiviert`;

    const stats = statusData.stats || {};
    byId('dm-kpi-runs').textContent = String(stats.runs_today ?? 0);
    byId('dm-kpi-failed').textContent = `${stats.failed_today ?? 0} fehlgeschlagen`;

    const backup = wartungData.backup || {};
    const mem = wartungData.memory || {};
    byId('dm-kpi-backup').textContent = backup.backup_count ? `${backup.backup_count} Backups` : 'Noch kein Backup';
    byId('dm-kpi-memory').textContent = `Working: ${mem.working_count ?? '–'} · Lessons: ${mem.lessons_count ?? '–'}`;

    const jobsList = byId('dm-jobs-list');
    byId('dm-jobs-badge').textContent = String(jobs.length);
    if (jobsList) {
      jobsList.replaceChildren();
      if (!jobs.length) {
        jobsList.append(el('p', 'dm-meta', 'Keine Daemon-Jobs in der Datenbank definiert.'));
      } else {
        for (const job of jobs) {
          const card = el('article', 'dm-item');
          const head = el('div', 'dm-item-head');
          head.append(el('strong', '', job.name || `Job #${job.id ?? '?'}`));
          head.append(el('span', 'badge', job.is_active ? (job.schedule || job.job_type || 'aktiv') : 'pausiert'));
          card.append(head);
          if (job.description) card.append(el('p', 'dm-meta', job.description));
          card.append(el('p', 'dm-meta', `Befehl: ${job.command || '–'} · Läufe: ${job.run_count ?? 0} · Letzter Lauf: ${job.last_run || 'nie'}`));
          jobsList.append(card);
        }
      }
    }

    const runs = Array.isArray(runsData.runs) ? runsData.runs : (Array.isArray(statusData.last_runs) ? statusData.last_runs : []);
    const runsList = byId('dm-runs-list');
    byId('dm-runs-badge').textContent = String(runs.length);
    if (runsList) {
      runsList.replaceChildren();
      if (!runs.length) {
        runsList.append(el('p', 'dm-meta', 'Bisher keine dokumentierten Job-Läufe.'));
      } else {
        for (const run of runs) {
          const card = el('article', 'dm-item');
          const head = el('div', 'dm-item-head');
          head.append(el('strong', '', run.name || `Job #${run.job_id ?? '?'} · Lauf #${run.id ?? '?'}`));
          head.append(el('span', 'badge', run.result || 'unbekannt'));
          card.append(head);
          const dur = run.duration_seconds != null ? `${Number(run.duration_seconds).toFixed(2)} s` : '–';
          card.append(el('p', 'dm-meta', `Start: ${run.started_at || '–'} · Dauer: ${dur}`));
          if (run.output) card.append(el('pre', 'dm-out', String(run.output).slice(0, 260)));
          runsList.append(card);
        }
      }
    }

    setStatus(
      running
        ? `Daemon läuft (PID ${statusData.pid ?? '?'}), ${jobs.length} Jobs geladen.`
        : `Daemon-Status gemessen: aktuell gestoppt (${statusData.identity_reason || 'kein aktiver Prozess'}), ${jobs.length} Jobs konfiguriert.`,
    );
  } catch (err) {
    setStatus(`Daemon-Status konnte nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

byId('dm-refresh')?.addEventListener('click', () => loadDaemon());

const showingChains = syncTabView();
if (!showingChains) loadDaemon();
