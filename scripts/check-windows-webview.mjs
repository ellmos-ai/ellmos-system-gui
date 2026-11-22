// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright-core';
import {openVerifiedGui, walkGuiPages} from './check-native-gui-pages.mjs';

if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('Run the installed WebView check on the disposable Windows CI runner.');
}
const port = Number(process.argv[2]);
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid WebView debug port');
const debuggerOrigins = ['http://127.0.0.1:', 'http://[::1]:'].map(host => host + port);
const marker = randomUUID();
const gui = await openVerifiedGui(resolve('dist'), process.env.DESKTOP_SOURCE_COMMIT);
const guiErrors = [];
let capabilityReads = 0;
let serveRealGui = false;
const fixture = createServer((request, response) => {
  if (serveRealGui) {
    void gui.respond(request, response).catch(error => {
      guiErrors.push(error.message);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  } else if (request.method !== 'GET') {
    response.writeHead(405).end();
  } else if (request.url === '/api/gui/capabilities') {
    capabilityReads++;
    response.writeHead(401, {'Content-Type':'application/json'}).end('{"detail":"fixture login required"}');
  } else if (request.url === '/') {
    response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'})
      .end('<!doctype html><title>Ocean CI fixture</title><main id="fixture-marker">' + marker + '</main>');
  } else {
    response.writeHead(404).end();
  }
});

async function waitFor(check, label) {
  const until = Date.now() + 30000;
  do {
    const value = await check();
    if (value) return value;
    await delay(150);
  } while (Date.now() < until);
  throw new Error('Windows WebView did not reach ' + label);
}

let browser;
try {
  const listening = once(fixture, 'listening');
  fixture.listen(0, '127.0.0.1');
  await listening;
  const origin = 'http://127.0.0.1:' + fixture.address().port;
  const debuggerOrigin = await waitFor(async () => {
    for (const address of debuggerOrigins) {
      try {
        const response = await fetch(address + '/json/version', {signal: AbortSignal.timeout(800)});
        if (response.ok && typeof (await response.json()).webSocketDebuggerUrl === 'string') return address;
      } catch {
        // The other loopback family may be the one exposed by WebView2.
      }
    }
    return null;
  }, 'its local debugger');
  browser = await chromium.connectOverCDP(debuggerOrigin, {timeout: 10000});
  const pages = () => browser.contexts().flatMap(context => context.pages());
  const connection = await waitFor(() => pages().find(page =>
    /^(?:tauri:\/\/localhost|https?:\/\/tauri\.localhost)(?:\/|$)/.test(page.url())), 'the bundled connection page');
  await connection.getByText('Desktop-App aktualisieren', { exact: true }).click({timeout: 10000});
  await connection.locator('#check-desktop-update').click({timeout: 10000});
  await connection.locator('#desktop-update-status').filter({hasText: 'kein signierter Update-Kanal'}).waitFor({timeout: 10000});
  assert.equal(await connection.locator('#install-desktop-update').isVisible(), false);
  await connection.locator('#backend-url').fill(origin, {timeout: 10000});
  await connection.locator('#connect').click({timeout: 10000});
  await connection.locator('#connection-status[data-state="error"]').waitFor({timeout: 10000});
  assert.match(await connection.locator('#connection-status').innerText(), /Loopbackadressen/);
  assert.equal(capabilityReads, 0, 'Unconfirmed HTTP reached the fixture');

  await connection.locator('#allow-loopback-http').check({timeout: 10000});
  await connection.locator('#connect').click({timeout: 10000});
  const backend = await waitFor(() => pages().find(page => page.url() === origin + '/'), 'the loopback backend');
  const content = backend.locator('#fixture-marker');
  await content.waitFor({state:'attached',timeout:10000});
  assert.equal(await content.textContent(), marker);
  const remoteUpdateDenied = await backend.evaluate(async () => {
    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke !== 'function') return true;
    return Promise.race([
      invoke('check_desktop_update').then(() => false, () => true),
      new Promise(resolve => setTimeout(() => resolve(false), 3000)),
    ]);
  });
  assert.equal(remoteUpdateDenied, true, 'The remote backend can invoke a desktop update check');
  assert.equal(capabilityReads, 1, 'Expected one backend capability request');
  await connection.locator('#connection-status[data-state="connected"]').waitFor({state:'attached',timeout:10000});
  assert.match(await connection.locator('#connection-status').textContent(), /Anmeldung ist im App-Fenster geöffnet/);
  serveRealGui = true;
  const nativePages = await walkGuiPages(backend, gui, origin, resolve('desktop-package', 'webview-smoke'));
  assert.deepEqual(guiErrors, [], 'The verified static GUI fixture reported errors');
  console.log(JSON.stringify({
    schema:'ellmos-system-gui.windows-webview-check.v1',
    loopback_opt_in_enforced:true,
    fixture_opened:true,
    authentication_required:true,
    unsigned_update_channel_unavailable:true,
    remote_update_denied:true,
    native_pages:nativePages,
  }));
} finally {
  if (browser) await browser.close();
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
}
