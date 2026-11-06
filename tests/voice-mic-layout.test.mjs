// SPDX-License-Identifier: MIT
// PB-3 B-03 (#3987): Mikrofonknopf steht in derselben Zeile wie sein Feld (<= 44 px), auch in Spalten-<label>.
// Echter DOM-Test gegen `astro dev` mit dem lokalen Edge/Chromium; ohne Browser wird uebersprungen.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

const candidates = [process.env.EDGE_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
const executablePath = candidates.find(p => existsSync(p));
const PORT = 43981;
const base = `http://127.0.0.1:${PORT}`;
const cases = [['/tasks', '#tasks-search'], ['/notizen', '#notes-search-input']];

test('Mikrofonknopf teilt die Zeile mit dem Feld (1440 und 390 px)', {skip: !executablePath && 'kein Chromium/Edge gefunden', timeout: 240000}, async () => {
  const server = spawn(process.execPath, ['node_modules/astro/bin/astro.mjs', 'dev', '--host', '127.0.0.1', '--port', String(PORT)], {stdio: 'ignore'});
  let browser;
  try {
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(base + '/tasks')).status < 500) break; } catch (_) {}
      await new Promise(r => setTimeout(r, 1000));
    }
    browser = await chromium.launch({executablePath, headless: true});
    for (const width of [1440, 390]) {
      const page = await browser.newPage({viewport: {width, height: 900}});
      for (const [path, selector] of cases) {
        await page.goto(base + path, {waitUntil: 'load'});
        await page.waitForSelector(`${selector}[data-ellmos-voice-enhanced="1"]`, {timeout: 20000});
        const m = await page.evaluate(sel => {
          const field = document.querySelector(sel);
          const btn = field.parentElement.querySelector('.ellmos-voice-mic-btn');
          const f = field.getBoundingClientRect(), b = btn.getBoundingClientRect();
          return {fTop: f.top, fBottom: f.bottom, bCenter: b.top + b.height / 2, bWidth: b.width, fWidth: f.width};
        }, selector);
        const where = `${path} ${selector} @${width}`;
        assert.ok(m.bCenter >= m.fTop - 4 && m.bCenter <= m.fBottom + 4, `${where}: Knopf nicht in der Feldzeile ${JSON.stringify(m)}`);
        assert.ok(m.bWidth <= 44, `${where}: Knopf ${m.bWidth}px breit`);
        assert.ok(m.fWidth >= 100, `${where}: Feld nur ${m.fWidth}px breit`);
      }
      await page.close();
    }
  } finally {
    await browser?.close();
    server.kill();
  }
});
