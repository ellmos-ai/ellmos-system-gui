import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {
  PRIVACY_REASONS, buildPrompt, createProfile, generateReport, importFolder, loadReadiness, profileBody, promptBody,
  reasonView, startSession,
} from '../src/lib/report-session.mjs';
import {DOMAIN_WORKBENCH_ROUTES, domainWorkbenchRoute} from '../src/lib/domain-routes.mjs';

const root = process.cwd();
const read = path => readFileSync(join(root, path), 'utf8');

function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null});
    return handler(String(url), options);
  };
  return {calls, restore: () => { globalThis.fetch = original; }};
}
const json = (status, data) => ({ok: status < 400, status, json: async () => data});

// Antworten wie BACH /api/report/session/... (T-20261107-347299705): Meldung und Code ohne Werte des Falls.
const BLOCKS = {
  ner_unavailable: 'Cloud-Modus verweigert: Namenserkennung unvollstaendig (spaCy ist nicht installiert). spaCy mit de_core_news_lg und en_core_web_lg installieren oder Modus \'lokal\' nutzen. Es wurde nichts gesendet.',
  document_scan_missing: 'Datenschutz-Sperre: Die Akte wurde nicht auf Namen Dritter, Telefonnummern, Mail-Adressen und Adressen gescannt. Profil nach dem Import der Akte anlegen. Es wurde nichts gesendet.',
  profile_missing: 'Datenschutz-Sperre: Fuer diesen Fall gibt es kein Pseudonymisierungsprofil. Zuerst das Profil anlegen. Es wurde nichts gesendet.',
  identity_terms_in_prompt: 'Datenschutz-Sperre: 2 Kennung(en) des Falls stuenden noch im Cloud-Prompt (z. B. andere Schreibweise oder unerkannte Mail-Adresse). Es wurde nichts gesendet. Begriffsliste ergaenzen oder Modus \'lokal\' nutzen.',
};
const block = code => ({success: false, privacy_block: true, error_code: code, error: BLOCKS[code]});

test('every backend block code has a plain-language reason, a next step and says nothing was sent', () => {
  for (const code of Object.keys(BLOCKS)) {
    const view = reasonView(block(code));
    assert.equal(view.blocked, true, code);
    assert.equal(view.code, code);
    assert.equal(view.title, PRIVACY_REASONS[code].title);
    assert.ok(view.text.length > 20 && view.next.length > 10, code);
    assert.match(view.text + ' ' + view.next, /nichts gesendet|nicht gesendet/i, code);
  }
  assert.match(reasonView(block('ner_unavailable')).next, /spaCy/);
  assert.match(reasonView(block('ner_unavailable')).next, /lokal/);
  assert.match(reasonView(block('identity_terms_in_prompt')).next, /Begriffsliste/);
});

test('an unknown block code still shows as a privacy block with the server message and the code', () => {
  const view = reasonView({success: false, privacy_block: true, error_code: 'future_code', error: 'Datenschutz-Sperre: neu.'});
  assert.equal(view.blocked, true);
  assert.equal(view.code, 'future_code');
  assert.match(view.text, /Datenschutz-Sperre: neu\./);
});

test('ordinary failures are not shown as privacy blocks and success has no reason', () => {
  assert.equal(reasonView({success: true, prompt: 'x'}), null);
  const view = reasonView({success: false, error: 'Session nicht gefunden'});
  assert.equal(view.blocked, false);
  assert.match(view.text, /Session nicht gefunden/);
  assert.equal(reasonView({success: false}).blocked, false);
  assert.match(reasonView({success: false}).text, /keinen Grund/);
});

test('profileBody reads one entry per line, never splits names at commas, and needs a name', () => {
  assert.deepEqual(profileBody({
    clientName: ' Leonhardt, Jonas ', geburtsdatum: ' 14.05.2017 ', parents: 'Sabine Leonhardt\n\n Markus Leonhardt ',
    address: ' Gartenstraße 18, 79102 Freiburg ', terms: 'Gartenstraße\r\nFrau Dr. Probe',
  }), {
    client_name: 'Leonhardt, Jonas', geburtsdatum: '14.05.2017', parent_names: ['Sabine Leonhardt', 'Markus Leonhardt'],
    client_address: 'Gartenstraße 18, 79102 Freiburg', additional_terms: ['Gartenstraße', 'Frau Dr. Probe'],
  });
  assert.throws(() => profileBody({clientName: '  '}), /Name/);
  const minimal = profileBody({clientName: 'Max Probe'});
  assert.equal('geburtsdatum' in minimal, false);
  assert.deepEqual(minimal.additional_terms, []);
});

test('promptBody keeps period, knowledge-base switch and instructions', () => {
  assert.deepEqual(promptBody({period: ' 01.01.2025 - 31.12.2025 ', knowledgeBase: false, instructions: ' kurz '}),
    {berichtszeitraum: '01.01.2025 - 31.12.2025', include_wissensdatenbank: false, custom_instructions: 'kurz'});
  assert.equal(promptBody({}).include_wissensdatenbank, true);
});

test('the client posts each step to the session routes and returns the block instead of throwing', async () => {
  const stub = stubFetch(url => json(200, url.endsWith('/prompt') ? block('profile_missing') : {success: true, session_id: 'WF_1'}));
  try {
    assert.equal((await startSession()).session_id, 'WF_1');
    await importFolder('WF 1', 'user/akte');
    await createProfile('WF 1', {clientName: 'Max Probe'});
    const blocked = await buildPrompt('WF 1', {});
    assert.equal(reasonView(blocked).code, 'profile_missing');
    await generateReport('WF 1', '{"stammdaten":{}}');
  } finally { stub.restore(); }
  assert.deepEqual(stub.calls.map(c => [c.method, c.url]), [
    ['POST', '/api/report/session/start'],
    ['POST', '/api/report/session/WF%201/import'],
    ['POST', '/api/report/session/WF%201/profile'],
    ['POST', '/api/report/session/WF%201/prompt'],
    ['POST', '/api/report/session/WF%201/generate'],
  ]);
  assert.deepEqual(stub.calls[1].body, {folder: 'user/akte'});
  assert.deepEqual(stub.calls[4].body, {llm_response: '{"stammdaten":{}}', auto_deanonymize: true});
});

test('network and HTTP errors are reported honestly', async () => {
  const down = stubFetch(() => { throw new TypeError('network'); });
  try { await assert.rejects(startSession(), /nicht erreichbar/); } finally { down.restore(); }
  const bad = stubFetch(() => json(401, {detail: 'Unauthorized'}));
  try { await assert.rejects(startSession(), /401.*Unauthorized/); } finally { bad.restore(); }
});

test('the Förderplaner page shows the reason as text, keeps the prompt hidden on a block and is linked from /inbox', () => {
  const page = read('src/pages/foerderplaner.astro');
  const script = read('src/scripts/foerderplaner-page.mjs');
  assert.match(page, /import '\.\.\/scripts\/foerderplaner-page\.mjs'/);
  for (const id of ['report-reason', 'report-reason-title', 'report-reason-text', 'report-reason-next', 'report-prompt'])
    assert.match(page, new RegExp(`id="${id}"`), id);
  assert.match(page, /role="alert"/);
  assert.match(script, /reasonView\(/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(script, /textContent = view\.title/);
  assert.match(script, /hidePrompt\(\)/);
  assert.match(read('src/pages/inbox.astro'), /href="\/foerderplaner"/);
});

test('readiness: cloud only when BACH says ready, otherwise the reason; an unreadable answer counts as not ready', async () => {
  const blocked = stubFetch(() => json(200, {success: true, cloud_ready: false, error_code: 'ner_unavailable', error: BLOCKS.ner_unavailable}));
  try {
    const state = await loadReadiness();
    assert.equal(state.cloudReady, false);
    assert.equal(state.reason.code, 'ner_unavailable');
    assert.equal(state.reason.title, PRIVACY_REASONS.ner_unavailable.title);
    assert.deepEqual(blocked.calls.map(c => [c.method, c.url]), [['GET', '/api/report/readiness']]);
  } finally { blocked.restore(); }
  const ready = stubFetch(() => json(200, {success: true, cloud_ready: true, error_code: null, error: null}));
  try { assert.deepEqual(await loadReadiness(), {cloudReady: true, reason: null}); } finally { ready.restore(); }
  for (const answer of [() => json(404, {detail: 'Not Found'}), () => { throw new TypeError('network'); }, () => json(200, {success: false})]) {
    const stub = stubFetch(answer);
    try {
      const state = await loadReadiness();
      assert.equal(state.cloudReady, false);
      assert.equal(state.reason.blocked, true);
      assert.equal(state.reason.code, 'readiness_unknown');
    } finally { stub.restore(); }
  }
});

test('the page shows both modes and keeps the cloud steps disabled until readiness allows them', () => {
  const page = read('src/pages/foerderplaner.astro');
  const script = read('src/scripts/foerderplaner-page.mjs');
  for (const id of ['report-mode-cloud', 'report-mode-cloud-state', 'report-mode-local'])
    assert.match(page, new RegExp(`id="${id}"`), id);
  assert.match(page, /Modus lokal/);
  assert.match(page, /Modus Cloud/);
  assert.match(script, /loadReadiness\(\)/);
  assert.match(script, /setCloudEnabled\(state\.cloudReady\)/);
  assert.match(page, /<fieldset id="report-cloud-steps" disabled/);
  assert.doesNotMatch(page + script, /#[0-9a-f]{3,6}\b|rgba?\(/i, 'nur Farb-Tokens (Kontrast in allen Themes)');
});

test('the Förderplaner domain card and its sidebar pin open the page', () => {
  assert.ok(DOMAIN_WORKBENCH_ROUTES.includes('/foerderplaner'));
  assert.equal(domainWorkbenchRoute('/foerderplaner'), '/foerderplaner');
  assert.doesNotMatch(read('src/lib/domain-routes.mjs'), /foerderplaner currently falls back/);
});
