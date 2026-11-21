// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright-core';

if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('Run the installed WebView check on the disposable Windows CI runner.');
}
const port = Number(process.argv[2]);
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid WebView debug port');
const debuggerOrigin = 'http://127.0.0.1:' + port;
const marker = randomUUID();
let capabilityReads = 0;
const fixture = createServer((request, response) => {
  if (request.method !== 'GET') {
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
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const origin = 'http://127.0.0.1:' + fixture.address().port;
  await waitFor(async () => {
    try {
      return (await fetch(debuggerOrigin + '/json/version', {signal: AbortSignal.timeout(800)})).ok;
    } catch {
      return false;
    }
  }, 'its local debugger');
  browser = await chromium.connectOverCDP(debuggerOrigin, {timeout: 10000});
  const pages = () => browser.contexts().flatMap(context => context.pages());
  const connection = await waitFor(() => pages().find(page =>
    /^(?:tauri:\/\/localhost|https?:\/\/tauri\.localhost)(?:\/|$)/.test(page.url())), 'the bundled connection page');
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
  assert.equal(capabilityReads, 1, 'Expected one authenticated-contract probe');
  await connection.locator('#connection-status[data-state="connected"]').waitFor({state:'attached',timeout:10000});
  assert.match(await connection.locator('#connection-status').textContent(), /Anmeldung ist im App-Fenster geöffnet/);
  console.log(JSON.stringify({
    schema:'ellmos-system-gui.windows-webview-check.v1',
    loopback_opt_in_enforced:true,
    fixture_opened:true,
    authentication_required:true,
  }));
} finally {
  if (browser) await browser.close();
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
}
