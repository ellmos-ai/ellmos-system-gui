// Förderbericht über den BACH-Berichtsweg /api/report/session/... (T-20261107-347299705).
// Cloud-Weg: Profil mit Namenserkennung und Akten-Scan, Prompt hinter der Datenschutz-Sperre. Eine Sperre kommt als
// {success:false, privacy_block:true, error_code, error}; Meldung und Code enthalten keine Werte des Falls.
export const PRIVACY_REASONS = Object.freeze({
  ner_unavailable: {
    title: 'Namenserkennung fehlt',
    text: 'Auf diesem Rechner fehlen spaCy oder die Sprachmodelle de_core_news_lg und en_core_web_lg. Ohne sie blieben Namen anderer Personen, Straßen und Orte im Text stehen. Es wurde nichts gesendet.',
    next: 'spaCy samt beiden Modellen in der BACH-Umgebung installieren oder den Bericht im Modus lokal erstellen (Pipeline mit lokalem Modell).',
  },
  document_scan_missing: {
    title: 'Akte nicht durchsucht',
    text: 'Das Profil wurde ohne Durchsuchen der Akte angelegt, oder danach kamen weitere Dateien dazu. Telefonnummern, Mail-Adressen, Adressen und Namen anderer Personen wären nicht ersetzt. Es wurde nichts gesendet.',
    next: 'Erst alle Dateien der Akte importieren (oder in Berichte/data_roh ablegen), dann das Profil neu anlegen.',
  },
  birth_date_invalid: {
    title: 'Geburtsdatum fehlt',
    text: 'Ohne lesbares Geburtsdatum bliebe das echte Datum aus der Akte im Prompt stehen. Es wurde nichts gesendet.',
    next: 'Das Geburtsdatum im Format TT.MM.JJJJ eintragen und das Profil neu anlegen.',
  },
  profile_missing: {
    title: 'Kein Pseudonymisierungsprofil',
    text: 'Für diesen Fall gibt es noch kein Profil. Ohne Profil würden die Daten im Klartext im Prompt stehen. Es wurde nichts gesendet.',
    next: 'Schritt 2 (Profil anlegen) ausführen, danach den Prompt erneut erzeugen.',
  },
  identity_terms_in_prompt: {
    title: 'Falldaten stünden noch im Prompt',
    text: 'Im Prompt stünden noch Namen, Daten oder Adressen des Falls, zum Beispiel in anderer Schreibweise, in Kleinschreibung oder in einer Mail-Adresse. Es wurde nichts gesendet.',
    next: 'Die betroffene Schreibweise in die Begriffsliste aufnehmen und das Profil neu anlegen, oder den Modus lokal nutzen.',
  },
});

// null bei Erfolg; sonst {blocked, code, title, text, next, detail}. detail ist die Servermeldung (ohne Werte).
export function reasonView(data) {
  if (data && data.success === true) return null;
  const detail = typeof data?.error === 'string' ? data.error : '';
  if (data?.privacy_block !== true)
    return {blocked: false, code: '', title: 'Schritt fehlgeschlagen', text: detail || 'Das Backend hat keinen Grund genannt.', next: '', detail: ''};
  const code = typeof data.error_code === 'string' && data.error_code ? data.error_code : 'unbekannt';
  const known = Object.hasOwn(PRIVACY_REASONS, code) ? PRIVACY_REASONS[code] : null;
  if (!known)
    return {blocked: true, code, title: 'Datenschutz-Sperre', text: detail || 'Der Prompt wurde gesperrt. Es wurde nichts gesendet.', next: '', detail: ''};
  return {blocked: true, code, ...known, detail};
}

const lines = value => String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);

// Echtes Kalenderdatum TT.MM.JJJJ (Tag und Monat auch einstellig), sonst null. Muster wie im Formularfeld.
const BIRTH_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
function birthDate(value) {
  const text = String(value || '').trim();
  const [, day, month, year] = (BIRTH_DATE_RE.exec(text) || []).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : null;
}

// Listen: ein Eintrag pro Zeile (Namen wie "Nachname, Vorname" enthalten Kommas).
// Geburtsdatum ist Pflicht, ohne Ersatzwert: Fehlte es, setzte BACH früher 01.01.2010 ein, und das echte Datum
// der Akte blieb im Cloud-Prompt (bach#683, R7-F1).
export function profileBody({clientName, geburtsdatum, parents, address, terms} = {}) {
  const name = String(clientName || '').trim();
  if (!name) throw new Error('Name des Kindes bzw. der Person wird benötigt.');
  const birth = birthDate(geburtsdatum);
  if (!birth) throw new Error('Geburtsdatum im Format TT.MM.JJJJ wird benötigt.');
  const body = {client_name: name, geburtsdatum: birth, additional_terms: lines(terms)};
  if (lines(parents).length) body.parent_names = lines(parents);
  if (String(address || '').trim()) body.client_address = String(address).trim();
  return body;
}

export function promptBody({period, knowledgeBase = true, instructions} = {}) {
  return {
    berichtszeitraum: String(period || '').trim(),
    include_wissensdatenbank: knowledgeBase !== false,
    custom_instructions: String(instructions || '').trim(),
  };
}

function describeFailure(status, body) {
  if (!status) return 'Berichtsweg nicht erreichbar (keine Verbindung zum Backend).';
  const reason = (body && (body.detail || body.reason_code || body.error)) || 'ohne Begründung';
  return `Berichtsweg nicht verfügbar (HTTP ${status}: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}).`;
}

// Wirft nur bei Netz- oder HTTP-Fehlern; fachliche Ergebnisse (auch Sperren) kommen als JSON zurück.
async function call(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (_error) {
    throw new Error(describeFailure(0, null));
  }
  let data = null;
  try { data = await response.json(); } catch (_error) { /* leerer oder kein JSON-Body */ }
  if (!response.ok) throw new Error(describeFailure(response.status, data));
  return data;
}

const JSON_HEADERS = {'Content-Type': 'application/json'};

const READINESS_UNKNOWN = {blocked: true, code: 'readiness_unknown', title: 'Bereitschaft nicht prüfbar',
  text: 'BACH hat nicht bestätigt, dass die Namenserkennung bereit ist. Der Cloud-Weg bleibt deshalb gesperrt. Es wurde nichts gesendet.',
  next: 'BACH-Verbindung und Version prüfen (Route /api/report/readiness) oder den Modus lokal nutzen.', detail: ''};

// Cloud nur, wenn BACH es ausdrücklich erlaubt; jede andere Antwort gilt als nicht bereit (fail-closed).
export async function loadReadiness() {
  let data;
  try { data = await call('/api/report/readiness', {method: 'GET'}); } catch (_error) { return {cloudReady: false, reason: READINESS_UNKNOWN}; }
  if (data?.success === true && data.cloud_ready === true) return {cloudReady: true, reason: null};
  if (data?.success === true && data.cloud_ready === false)
    return {cloudReady: false, reason: reasonView({success: false, privacy_block: true, error_code: data.error_code, error: data.error})};
  return {cloudReady: false, reason: READINESS_UNKNOWN};
}

export async function startSession() {
  return call('/api/report/session/start', {method: 'POST', headers: JSON_HEADERS, body: '{}'});
}

export async function importFolder(sessionId, folder) {
  return call('/api/report/session/' + encodeURIComponent(sessionId) + '/import',
    {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({folder: String(folder || '').trim()})});
}

export async function createProfile(sessionId, form) {
  return call('/api/report/session/' + encodeURIComponent(sessionId) + '/profile',
    {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(profileBody(form))});
}

export async function buildPrompt(sessionId, form) {
  return call('/api/report/session/' + encodeURIComponent(sessionId) + '/prompt',
    {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(promptBody(form))});
}

// Rückersetzung der Tarnwerte geschieht lokal in BACH, nach der Modellantwort.
export async function generateReport(sessionId, llmResponse) {
  return call('/api/report/session/' + encodeURIComponent(sessionId) + '/generate',
    {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({llm_response: String(llmResponse || ''), auto_deanonymize: true})});
}
