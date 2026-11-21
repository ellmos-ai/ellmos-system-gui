// /foerderplaner: Förderbericht über den Cloud-Weg mit Pseudonymisierung (T-20261107-347299705).
// Logik und Backend-Vertrag: src/lib/report-session.mjs. Gründe werden nur per textContent gezeigt.
import {
  buildPrompt, createProfile, generateReport, importFolder, loadReadiness, reasonView, startSession,
} from '../lib/report-session.mjs';

const $ = id => document.getElementById(id);
const newCase = () => ({sessionId: '', ready: false, busy: false, controller: new AbortController()});
let activeCase = newCase();

function updateControls() {
  $('report-cloud-steps').disabled = !activeCase.ready || activeCase.busy;
}

function showReason(view) {
  const box = $('report-reason');
  if (!box) return;
  if (!view) { box.hidden = true; return; }
  $('report-reason-title').textContent = view.title;
  $('report-reason-text').textContent = view.text;
  $('report-reason-next').textContent = view.next;
  $('report-reason-next').hidden = !view.next;
  $('report-reason-code').textContent = view.code ? `Code: ${view.code}` : '';
  box.dataset.blocked = String(view.blocked);
  box.hidden = false;
  box.scrollIntoView({block: 'nearest'});
}

function setStatus(id, text) {
  const node = $(id);
  if (node) node.textContent = text;
}

function hidePrompt() {
  $('report-prompt').value = '';
  $('report-prompt-box').hidden = true;
  setStatus('report-copy-status', '');
}

// Eine Sitzung je Fall; BACH hält sie im Speicher, bis der Dienst neu startet.
async function withSession(reportCase, action) {
  const signal = reportCase.controller.signal;
  if (!reportCase.sessionId) {
    const started = await startSession({signal});
    if (reportCase !== activeCase) return;
    if (!started || started.success !== true) return started;
    if (typeof started.session_id !== 'string' || !started.session_id.trim()) {
      throw new Error('BACH hat keine Sitzung bestätigt.');
    }
    reportCase.sessionId = started.session_id;
    setStatus('report-session-id', reportCase.sessionId);
  }
  return action(reportCase.sessionId, {signal});
}

async function step(statusId, action, describe) {
  const reportCase = activeCase;
  if (!reportCase.ready || reportCase.busy) return;
  reportCase.busy = true;
  updateControls();
  showReason(null);
  setStatus(statusId, 'Läuft …');
  try {
    const data = await withSession(reportCase, action);
    if (reportCase !== activeCase) return;
    const view = reasonView(data);
    if (view) {
      showReason(view);
      setStatus(statusId, view.blocked ? 'Gesperrt, nichts gesendet' : 'Fehlgeschlagen');
      return null;
    }
    setStatus(statusId, describe(data));
    return data;
  } catch (error) {
    if (reportCase !== activeCase) return;
    showReason({blocked: false, code: '', title: 'Schritt nicht ausgeführt', text: error.message, next: ''});
    setStatus(statusId, 'Fehlgeschlagen');
    return null;
  } finally {
    if (reportCase === activeCase) {
      reportCase.busy = false;
      updateControls();
    }
  }
}

const value = id => $(id)?.value ?? '';

$('report-import-form')?.addEventListener('submit', event => {
  event.preventDefault();
  hidePrompt();
  const folder = value('report-folder');
  step('report-import-status', (id, options) => importFolder(id, folder, options),
    data => `${data.imported_count} Dateien übernommen.`);
});

$('report-profile-form')?.addEventListener('submit', event => {
  event.preventDefault();
  hidePrompt();
  const form = {
    clientName: value('report-client-name'), geburtsdatum: value('report-birthdate'), parents: value('report-parents'),
    address: value('report-address'), terms: value('report-terms'),
  };
  step('report-profile-status', (id, options) => createProfile(id, form, options),
    data => `Profil angelegt: Tarnname ${data.tarnname}, ${data.mappings_count} Ersetzungen.`);
});

$('report-prompt-form')?.addEventListener('submit', event => {
  event.preventDefault();
  hidePrompt();
  const form = {
    period: value('report-period'), knowledgeBase: $('report-kb')?.checked !== false, instructions: value('report-instructions'),
  };
  step('report-prompt-status', (id, options) => buildPrompt(id, form, options), result => {
    if (typeof result.prompt !== 'string' || !result.prompt.trim()) throw new Error('BACH hat keinen Prompt bestätigt.');
    $('report-prompt').value = result.prompt;
    $('report-prompt-box').hidden = false;
    return `Prompt bereit (${result.prompt_length} Zeichen).`;
  });
});

$('report-copy')?.addEventListener('click', async () => {
  const reportCase = activeCase;
  const prompt = value('report-prompt');
  if (!prompt || reportCase.busy || !reportCase.ready || $('report-prompt-box').hidden) return;
  try {
    await navigator.clipboard.writeText(prompt);
    if (reportCase === activeCase && value('report-prompt') === prompt) setStatus('report-copy-status', 'Kopiert.');
  } catch (_error) {
    if (reportCase !== activeCase || value('report-prompt') !== prompt) return;
    $('report-prompt')?.select();
    setStatus('report-copy-status', 'Bitte manuell kopieren (Strg+C).');
  }
});

$('report-generate-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const response = value('report-response');
  step('report-generate-status', (id, options) => generateReport(id, response, options),
    data => `Bericht erstellt: ${data.output_path}`);
});

$('report-new-case')?.addEventListener('click', () => {
  activeCase.controller.abort();
  activeCase = newCase();
  $('report-cloud-steps').querySelectorAll('form').forEach(form => form.reset());
  setStatus('report-session-id', 'noch keine');
  hidePrompt();
  showReason(null);
  for (const id of ['report-import-status', 'report-profile-status', 'report-prompt-status', 'report-generate-status'])
    setStatus(id, '');
  checkReadiness();
});

async function checkReadiness() {
  const reportCase = activeCase;
  updateControls();
  setStatus('report-mode-cloud-state', 'Bereitschaft wird geprüft …');
  const state = await loadReadiness({signal: reportCase.controller.signal});
  if (reportCase !== activeCase) return;
  reportCase.ready = state.cloudReady;
  updateControls();
  setStatus('report-mode-cloud-state', state.cloudReady
    ? 'Bereit: Namenserkennung vorhanden, Datenschutz-Sperre aktiv.'
    : 'Gesperrt: Der Cloud-Weg ist auf diesem Rechner nicht bereit (Grund unten).');
  if (state.reason) showReason(state.reason);
}

checkReadiness();
