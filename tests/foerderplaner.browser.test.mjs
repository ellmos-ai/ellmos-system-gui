// T-20261107-347299705: /foerderplaner in a real browser (Playwright) with injected BACH answers, no backend.
// Cloud stays disabled until readiness allows it; every privacy block is shown as plain text with its next step;
// reason panel and mode panel reach 4.5:1 in all five themes; no horizontal overflow on a phone.
// Uses Playwright Chromium or an already installed Chrome/Edge; otherwise skips.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync, readFileSync} from 'node:fs';
import {extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {sharedDist} from './fixtures/shared-dist.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon'};
const THEMES = ['dark', 'light', 'warm', 'ocean', 'colorful'];
const NER_BLOCK = {success: true, cloud_ready: false, error_code: 'ner_unavailable',
  error: "Cloud-Modus verweigert: Namenserkennung unvollstaendig (spaCy ist nicht installiert). Es wurde nichts gesendet."};
const IDENTITY_BLOCK = {success: false, privacy_block: true, error_code: 'identity_terms_in_prompt',
  error: 'Datenschutz-Sperre: 2 Kennung(en) des Falls stuenden noch im Cloud-Prompt. Es wurde nichts gesendet.'};
const READY = {success: true, cloud_ready: true, error_code: null, error: null};

const luminance = ([r, g, b]) => {
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const colorsOf = (page, selector) => page.locator(selector).first().evaluate(node => {
  const parse = value => { const m = value.match(/[\d.]+/g).map(Number); return {rgb: m.slice(0, 3), a: m.length > 3 ? m[3] : 1}; };
  const layers = [];
  for (let n = node; n; n = n.parentElement) {
    const bg = parse(getComputedStyle(n).backgroundColor);
    if (bg.a > 0) layers.push(bg);
    if (bg.a === 1) break;
  }
  let base = layers.length && layers[layers.length - 1].a === 1 ? layers.pop().rgb : [255, 255, 255];
  for (const layer of layers.reverse()) base = base.map((v, i) => Math.round(layer.rgb[i] * layer.a + v * (1 - layer.a)));
  return {text: parse(getComputedStyle(node).color).rgb, background: base};
});

let dist, server, baseUrl, browser;
test.before(async () => {
  try {
    const {chromium} = await import('playwright-core');
    const executablePath = [process.env.EDGE_PATH, chromium.executablePath(),
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      '/usr/bin/google-chrome', '/usr/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].find(path => path && existsSync(path));
    if (!executablePath) return;
    browser = await chromium.launch({executablePath});
  } catch { return; }
  dist = await sharedDist(root);
  server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/' || path === '') path = '/index';
    const file = [join(dist, path), join(dist, path + '.html')].find(f => existsSync(f) && extname(f));
    if (!file) { res.writeHead(404); return res.end('nicht gefunden'); }
    res.writeHead(200, {'content-type': TYPES[extname(file)] || 'application/octet-stream'});
    res.end(readFileSync(file));
  }).listen(0, '127.0.0.1');
  await new Promise(done => server.once('listening', done));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => {
  await browser?.close();
  server?.close();
});

async function open({theme = 'dark', width = 1440, readiness = NER_BLOCK, handle, ignoreAbort = false} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  await context.addInitScript(value => localStorage.setItem('bach-theme', value), theme);
  if (ignoreAbort) {
    // The server can finish independently from frontend cancellation. Exercise
    // the case guard by delivering a stale response even after abort().
    await context.addInitScript(() => {
      const fetch = window.fetch.bind(window);
      window.fetch = (resource, options) => fetch(resource, {...options, signal: undefined});
    });
  }
  const requests = [];
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    requests.push(route.request().method() + ' ' + url.pathname);
    const json = body => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
    const custom = handle?.(url, route);
    if (custom !== undefined) return json(await custom);
    if (url.pathname === '/api/report/readiness') return json(readiness);
    if (url.pathname === '/api/report/session/start') return json({success: true, session_id: 'WF_synth', status: 'initialized'});
    if (url.pathname.endsWith('/profile')) return json({success: true, tarnname: 'Tarn Person', mappings_count: 12, status: 'anonymizing'});
    if (url.pathname.endsWith('/prompt')) return json(IDENTITY_BLOCK);
    return route.fulfill({status: 404, contentType: 'application/json', body: '{"detail":"Not Found"}'});
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl + '/foerderplaner');
  return {page, context, requests, errors};
}

test('without name recognition the cloud steps stay disabled and the reason is shown', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context, errors} = await open();
  try {
    await page.locator('#report-reason:not([hidden])').waitFor();
    assert.equal(await page.locator('#report-reason-title').innerText(), 'Namenserkennung fehlt');
    assert.match(await page.locator('#report-reason-next').innerText(), /lokal/);
    assert.equal(await page.locator('#report-cloud-steps').evaluate(node => node.disabled), true);
    assert.match(await page.locator('#report-mode-cloud-state').innerText(), /gesperrt/i);
    assert.match(await page.locator('#report-mode-local').innerText(), /Modus lokal/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('New case clears the form values and ignores a delayed start from the old case', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const earlyStart = Promise.withResolvers();
  const receiveEarlyStart = Promise.withResolvers();
  const nextReady = Promise.withResolvers();
  const entered = {
    'report-folder': 'synthetisch/alt',
    'report-client-name': 'Fall Alt Synthetisch',
    'report-birthdate': '03.07.2014',
    'report-parents': 'Eltern Alt',
    'report-address': 'Teststraße 1',
    'report-terms': 'Begriff Alt',
    'report-period': 'Jahr Alt',
    'report-instructions': 'Anweisung Alt',
    'report-response': '{"text":"Antwort Alt"}',
  };
  const sentProfiles = [];
  let starts = 0, checks = 0;
  const {page, context, requests} = await open({readiness: READY, ignoreAbort: true, handle(url, route) {
    if (url.pathname === '/api/report/readiness' && ++checks > 1) return nextReady.promise;
    if (url.pathname === '/api/report/session/start') {
      if (++starts === 1) {
        receiveEarlyStart.resolve();
        return earlyStart.promise;
      }
      return {success: true, session_id: 'WF_new'};
    }
    if (url.pathname.endsWith('/profile')) {
      sentProfiles.push(route.request().postDataJSON());
      return {success: true, tarnname: 'Tarn Person', mappings_count: 1};
    }
  }});
  const profileButton = page.locator('#report-profile-form button[type="submit"]');
  try {
    await profileButton.waitFor();
    for (const [id, value] of Object.entries(entered)) await page.locator('#' + id).fill(value);
    await page.locator('#report-kb').uncheck();
    await profileButton.click();
    await receiveEarlyStart.promise;
    await page.locator('#report-new-case').click();
    for (const id of Object.keys(entered)) assert.equal(await page.locator('#' + id).inputValue(), '', id);
    assert.equal(await page.locator('#report-kb').isChecked(), true);
    assert.equal(await profileButton.isDisabled(), true);
    nextReady.resolve(READY);
    await page.locator('#report-client-name').fill('Fall Neu Synthetisch');
    await page.locator('#report-birthdate').fill('04.08.2015');
    await profileButton.click();
    await page.waitForFunction(() => /Profil angelegt/.test(document.querySelector('#report-profile-status').textContent));
    const oldResponse = page.waitForResponse(async response => response.url().endsWith('/session/start') &&
      (await response.json()).session_id === 'WF_old');
    earlyStart.resolve({success: true, session_id: 'WF_old'});
    await oldResponse;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.locator('#report-session-id').textContent(), 'WF_new');
    assert.deepEqual(requests.filter(path => path.endsWith('/profile')), ['POST /api/report/session/WF_new/profile']);
    assert.deepEqual(sentProfiles, [{client_name: 'Fall Neu Synthetisch', geburtsdatum: '04.08.2015', additional_terms: []}]);
  } finally {
    nextReady.resolve(READY);
    earlyStart.resolve({success: true, session_id: 'WF_old'});
    await context.close();
  }
});

test('a delayed prompt is discarded after the case changes and a new readiness check blocks cloud use', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const oldPrompt = Promise.withResolvers();
  const promptRequested = Promise.withResolvers();
  let checks = 0;
  const {page, context} = await open({readiness: READY, ignoreAbort: true, handle(url) {
    if (url.pathname === '/api/report/readiness' && ++checks > 1) return NER_BLOCK;
    if (url.pathname.endsWith('/prompt')) {
      promptRequested.resolve();
      return oldPrompt.promise;
    }
  }});
  try {
    await page.locator('#report-prompt-form button[type="submit"]').click();
    await promptRequested.promise;
    await page.locator('#report-new-case').click();
    await page.locator('#report-reason:not([hidden])').waitFor();
    const response = page.waitForResponse(item => item.url().endsWith('/prompt'));
    oldPrompt.resolve({success: true, prompt: 'PROMPT_OLD_CASE', prompt_length: 15});
    await (await response).finished();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.locator('#report-prompt').inputValue(), '');
    assert.equal(await page.locator('#report-prompt-box').isHidden(), true);
    assert.equal(await page.locator('#report-cloud-steps').evaluate(fieldset => fieldset.disabled), true);
    assert.match(await page.locator('#report-reason-title').textContent(), /Namenserkennung fehlt/);
  } finally {
    oldPrompt.resolve(IDENTITY_BLOCK);
    await context.close();
  }
});

test('when ready, a blocked prompt shows the reason and never the prompt', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context, requests} = await open({readiness: {success: true, cloud_ready: true, error_code: null, error: null}});
  try {
    await page.waitForFunction(() => document.querySelector('#report-cloud-steps').disabled === false);
    assert.match(await page.locator('#report-mode-cloud-state').innerText(), /bereit/i);
    await page.locator('#report-client-name').fill('Synthetisch Probe');
    await page.locator('#report-birthdate').fill('03.07.2014');
    await page.locator('#report-profile-form button[type="submit"]').click();
    await page.waitForFunction(() => /Profil angelegt/.test(document.querySelector('#report-profile-status').textContent));
    await page.locator('#report-prompt-form button[type="submit"]').click();
    await page.locator('#report-reason:not([hidden])').waitFor();
    assert.equal(await page.locator('#report-reason-title').innerText(), 'Falldaten stünden noch im Prompt');
    assert.match(await page.locator('#report-reason-code').innerText(), /identity_terms_in_prompt/);
    assert.equal(await page.locator('#report-prompt-box').isHidden(), true);
    assert.ok(requests.includes('POST /api/report/session/WF_synth/prompt'), requests.join('\n'));
  } finally { await context.close(); }
});

// bach#683 R7-F1: ohne Geburtsdatum setzte BACH 01.01.2010 ein, das echte Datum blieb im Cloud-Prompt.
test('the birth date is required as TT.MM.JJJJ: empty or other forms send no profile request', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context, requests} = await open({readiness: {success: true, cloud_ready: true, error_code: null, error: null}});
  try {
    await page.waitForFunction(() => document.querySelector('#report-cloud-steps').disabled === false);
    const field = page.locator('#report-birthdate');
    assert.equal(await field.evaluate(node => node.required), true);
    assert.equal(await field.inputValue(), '');
    await page.locator('#report-client-name').fill('Synthetisch Probe');
    for (const value of ['', '2014-07-03', '3.7.14']) {
      await field.fill(value);
      await page.locator('#report-profile-form button[type="submit"]').click();
      assert.equal(await field.evaluate(node => node.validity.valid), false, value);
    }
    assert.equal(requests.some(r => r.endsWith('/profile')), false, requests.join('\n'));
    await field.fill('03.07.2014');
    await page.locator('#report-profile-form button[type="submit"]').click();
    await page.waitForFunction(() => /Profil angelegt/.test(document.querySelector('#report-profile-status').textContent));
  } finally { await context.close(); }
});

test('contrast: reason panel and mode panel reach 4.5:1 in every theme', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  for (const theme of THEMES) {
    const {page, context} = await open({theme});
    try {
      await page.locator('#report-reason:not([hidden])').waitFor();
      for (const selector of ['#report-reason-title', '#report-reason-text', '#report-reason-next', '#report-reason-code',
        '#report-mode-cloud-state', '#report-mode-local']) {
        const {text, background} = await colorsOf(page, selector);
        const value = ratio(text, background);
        assert.ok(value >= 4.5, `${theme} ${selector}: ${value.toFixed(2)}`);
      }
    } finally { await context.close(); }
  }
});

test('phone width: no horizontal overflow', async t => {
  if (!browser) return t.skip('kein Playwright-Browser installiert');
  const {page, context} = await open({width: 390});
  try {
    await page.locator('#report-reason:not([hidden])').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `overflows by ${overflow}px`);
  } finally { await context.close(); }
});
