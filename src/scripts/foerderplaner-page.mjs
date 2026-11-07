// /foerderplaner: Förderbericht über den Cloud-Weg mit Pseudonymisierung (T-20261107-347299705).
// Logik und Backend-Vertrag: src/lib/report-session.mjs. Gründe werden nur per textContent gezeigt.
import {buildPrompt, createProfile, generateReport, importFolder, reasonView, startSession} from '../lib/report-session.mjs';

const $ = id => document.getElementById(id);
let sessionId = '';

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
}

// Eine Sitzung je Fall; BACH hält sie im Speicher, bis der Dienst neu startet.
async function withSession(action) {
  if (!sessionId) {
    const started = await startSession();
    if (!started || started.success !== true) return started;
    sessionId = started.session_id;
    setStatus('report-session-id', sessionId);
  }
  return action(sessionId);
}

async function step(statusId, action, describe) {
  showReason(null);
  setStatus(statusId, 'Läuft …');
  try {
    const data = await withSession(action);
    const view = reasonView(data);
    if (view) {
      showReason(view);
      setStatus(statusId, view.blocked ? 'Gesperrt, nichts gesendet' : 'Fehlgeschlagen');
      return null;
    }
    setStatus(statusId, describe(data));
    return data;
  } catch (error) {
    showReason({blocked: false, code: '', title: 'Schritt nicht ausgeführt', text: error.message, next: ''});
    setStatus(statusId, 'Fehlgeschlagen');
    return null;
  }
}

const value = id => $(id)?.value ?? '';

$('report-import-form')?.addEventListener('submit', event => {
  event.preventDefault();
  step('report-import-status', id => importFolder(id, value('report-folder')),
    data => `${data.imported_count} Dateien übernommen.`);
});

$('report-profile-form')?.addEventListener('submit', event => {
  event.preventDefault();
  hidePrompt();
  step('report-profile-status', id => createProfile(id, {
    clientName: value('report-client-name'), geburtsdatum: value('report-birthdate'), parents: value('report-parents'),
    address: value('report-address'), terms: value('report-terms'),
  }), data => `Profil angelegt: Tarnname ${data.tarnname}, ${data.mappings_count} Ersetzungen.`);
});

$('report-prompt-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  hidePrompt();
  const data = await step('report-prompt-status', id => buildPrompt(id, {
    period: value('report-period'), knowledgeBase: $('report-kb')?.checked !== false, instructions: value('report-instructions'),
  }), result => `Prompt bereit (${result.prompt_length} Zeichen).`);
  if (data && typeof data.prompt === 'string') {
    $('report-prompt').value = data.prompt;
    $('report-prompt-box').hidden = false;
  }
});

$('report-copy')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(value('report-prompt'));
    setStatus('report-copy-status', 'Kopiert.');
  } catch (_error) {
    $('report-prompt')?.select();
    setStatus('report-copy-status', 'Bitte manuell kopieren (Strg+C).');
  }
});

$('report-generate-form')?.addEventListener('submit', event => {
  event.preventDefault();
  step('report-generate-status', id => generateReport(id, value('report-response')),
    data => `Bericht erstellt: ${data.output_path}`);
});

$('report-new-case')?.addEventListener('click', () => {
  sessionId = '';
  setStatus('report-session-id', 'noch keine');
  hidePrompt();
  showReason(null);
  for (const id of ['report-import-status', 'report-profile-status', 'report-prompt-status', 'report-generate-status'])
    setStatus(id, '');
});
