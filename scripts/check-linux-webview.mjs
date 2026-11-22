// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, readlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createServer as createSocket} from 'node:net';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import {openVerifiedGui, smokeSamples} from './check-native-gui-pages.mjs';

assert.ok(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true'
  && process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.env.DISPLAY,
  'Use a disposable GitHub-hosted Linux runner with Xvfb');
const application = '/usr/bin/ellmos-system-gui-desktop';
const command = promisify(execFile);
const output = resolve('desktop-package/webview-smoke');
const gui = await openVerifiedGui(resolve('dist'), process.env.DESKTOP_SOURCE_COMMIT);
const errors = [];
let capabilityReads = 0;
const fixture = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/api/gui/capabilities') {
    capabilityReads++;
    response.writeHead(401, {'Content-Type':'application/json'}).end('{"detail":"fixture login required"}');
  } else {
    void gui.respond(request, response).catch(error => {
      errors.push(error.message);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  }
});

async function waitFor(check, label) {
  const end = Date.now() + 25000;
  do {
    const value = await check();
    if (value) return value;
    await delay(150);
  } while (Date.now() < end);
  throw new Error('Linux WebView did not reach ' + label);
}

async function startListening(server) {
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  return server.address().port;
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function x11Window(title, expectedPid) {
  const result = await command('xdotool', ['search', '--onlyvisible', '--name', title], {timeout:5000})
    .catch(error => { if (error.code !== 1) throw error; return {stdout:''}; });
  for (const id of result.stdout.trim().split(/\s+/).filter(Boolean)) {
    assert.match(id, /^[0-9]+$/);
    const {stdout} = await command('xdotool', ['getwindowpid', id], {timeout:5000});
    const pid = Number(stdout.trim());
    if (pid !== expectedPid && expectedPid !== undefined) continue;
    if (await readlink('/proc/' + pid + '/exe').catch(() => '') === application) return {id,pid};
  }
  return null;
}

let driver;
let windowManager;
let session;
let driverOrigin;
async function request(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch(driverOrigin + path, {method, signal:AbortSignal.timeout(15000),
      headers:{Connection:'close', ...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {})});
  } catch (error) {
    throw new Error(method + ' ' + path + ': ' + error.message, {cause:error});
  }
  const {value} = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${value?.error}: ${value?.message}`);
  return value;
}

try {
  const origin = 'http://127.0.0.1:' + await startListening(fixture);
  const portSocket = createSocket();
  const driverPort = await startListening(portSocket);
  await closeServer(portSocket);
  driverOrigin = 'http://127.0.0.1:' + driverPort;

  windowManager = spawn('openbox', [], {stdio:['ignore','ignore','inherit']});
  await once(windowManager, 'spawn');
  windowManager.unref();
  await waitFor(() => command('wmctrl', ['-m'], {timeout:1000}).then(() => true, () => false), 'the X11 window manager');

  // Use the same native driver and automation settings as tauri-driver on Linux.
  driver = spawn('WebKitWebDriver', ['--host=127.0.0.1', '--port=' + driverPort], {
    env:{...process.env, TAURI_WEBVIEW_AUTOMATION:'true'},
    stdio:['ignore','ignore','inherit'],
  });
  await once(driver, 'spawn');
  driver.unref();
  await waitFor(() => request('/status').then(result => result.ready, () => false), 'the local WebDriver');
  console.error('WebKitGTK smoke: driver accepting requests');
  const opened = await request('/session', 'POST', {capabilities:{alwaysMatch:{
    pageLoadStrategy:'none', timeouts:{script:5000, pageLoad:8000, implicit:0},
    'webkitgtk:browserOptions':{binary:application, args:[]},
  }}});
  assert.ok(opened.sessionId, 'WebKit did not create a session');
  session = '/session/' + opened.sessionId;
  console.error('WebKitGTK smoke: native session opened');
  const call = (path, method, body) => request(session + path, method, body);
  const evaluate = (script, ...args) => call('/execute/sync', 'POST', {script,args});
  const connection = await waitFor(() => x11Window('^Ocean \\(BACH\\) verbinden$'), 'the native connection window');
  console.error('WebKitGTK smoke: native connection window visible');
  const bundledUrl = /^(?:tauri:\/\/localhost|https?:\/\/tauri\.localhost)(?:\/|$)/;
  const startupUrl = await call('/url');
  console.error('WebKitGTK smoke: initial WebDriver URL ' + JSON.stringify(startupUrl));
  // Creating an automation session can reset the reused native view to about:blank.
  // Restore only the bundled connection document, then use the app's real attach UI.
  if (!startupUrl || startupUrl === 'about:blank' || startupUrl === 'tauri://localhost') {
    await call('/url', 'POST', {url:'tauri://localhost/index.html'});
  }
  await waitFor(async () => bundledUrl.test(await call('/url')), 'the bundled connection page');
  console.error('WebKitGTK smoke: bundled connection document loaded');
  await waitFor(() => evaluate("return !!document.querySelector('#backend-url')"), 'the connection form');
  await evaluate(`
    document.querySelector('#backend-url').value = arguments[0];
    document.querySelector('#connect').click();
  `, origin);
  await waitFor(() => evaluate("return document.querySelector('#connection-status')?.dataset.state === 'error'"), 'HTTP consent enforcement');
  assert.equal(capabilityReads, 0, 'The fixture was contacted before HTTP consent');
  await evaluate(`
    document.querySelector('#allow-loopback-http').click();
    document.querySelector('#connect').click();
  `);
  const backend = await waitFor(() => x11Window('^Ocean \\(BACH\\) – Anmeldung erforderlich$', connection.pid),
    'the native backend window');
  console.error('WebKitGTK smoke: native backend window visible');
  await waitFor(async () => {
    for (const handle of await call('/window/handles')) {
      await call('/window', 'POST', {handle});
      if (await evaluate('return location.origin') === origin) return true;
    }
    return false;
  }, 'the backend WebView target');
  assert.equal(capabilityReads, 1);

  await mkdir(output, {recursive:true});
  const routes = [];
  const containsVisibleText = `
    const element = document.querySelector(arguments[0]);
    return !!element && element.getClientRects().length > 0 && element.innerText.includes(arguments[1]);
  `;
  const waitText = (selector, expected) => waitFor(() => evaluate(containsVisibleText, selector, expected), selector);
  async function record(path, name, heading) {
    assert.equal(await evaluate('return location.origin'), origin);
    assert.equal(await evaluate('return location.pathname'), path);
    await waitText('#main-content h1', heading);
    const screenshot = name + '.png';
    const data = Buffer.from(await call('/screenshot'), 'base64');
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    await writeFile(join(output, screenshot), data);
    routes.push({route:path, html_sha256:gui.pageHash(path), screenshot});
    console.error('WebKitGTK smoke: rendered ' + path);
  }

  await waitText('#tasks-container', smokeSamples.openTask.title);
  await record('/', 'dashboard', 'Willkommen');
  await evaluate("document.querySelector('#main-content a[href=\"/tasks\"]').click()");
  await waitText('#tasks-table-container', smokeSamples.openTask.title);
  await evaluate(`
    const filter = document.querySelector('#tasks-status-filter');
    filter.value = 'done';
    filter.dispatchEvent(new Event('change', {bubbles:true}));
  `);
  await waitText('#tasks-table-container', smokeSamples.doneTask.title);
  assert.equal(await evaluate(containsVisibleText, '#tasks-table-container', smokeSamples.openTask.title), false);
  await record('/tasks', 'aufgaben', 'Aufgaben');

  await call('/back', 'POST', {});
  await waitText('#tasks-container', smokeSamples.openTask.title);
  await evaluate("document.querySelector('#main-content a[href=\"/agenten/running\"]').click()");
  await waitText('#worker-status-summary', '1 Worker registriert');
  await waitText('#ready-agents-grid', smokeSamples.worker.name);
  const search = `
    const input = document.querySelector('#agent-overview-query');
    input.value = arguments[0];
    input.dispatchEvent(new Event('input', {bubbles:true}));
  `;
  await evaluate(search, 'anderer Name');
  await waitFor(async () => !await evaluate(containsVisibleText, '#ready-agents-grid', smokeSamples.worker.name), 'the filtered agent list');
  await evaluate(search, '');
  await waitText('#ready-agents-grid', smokeSamples.worker.name);
  await record('/agenten/running', 'running', 'Living & Running');
  assert.deepEqual(errors, [], 'The verified static GUI fixture reported errors');

  // Ask the native window manager to close the two app windows in their normal order.
  const closeWindow = window => command('wmctrl', ['-ic', '0x' + Number(window.id).toString(16)], {timeout:5000});
  await closeWindow(backend);
  await closeWindow(await waitFor(() => x11Window('^Ocean \\(BACH\\) verbinden$', connection.pid),
    'the restored connection window'));
  await waitFor(async () => await readlink('/proc/' + connection.pid + '/exe').catch(() => '') !== application,
    'the app process exit after closing its windows');
  session = undefined; // The app closed its last browsing context.
  console.error('WebKitGTK smoke: native app exited');
  console.log(JSON.stringify({
    source_commit:gui.sourceCommit, web_build_page_count:gui.pageCount, page_contract_count:gui.pageCount,
    fixture_backend:'loopback-read-only', renderer:'WebKitGTK', native_windows_observed:true,
    exited_after_window_close:true, routes,
  }));
} finally {
  if (session) await request(session, 'DELETE').catch(() => {});
  driver?.kill();
  windowManager?.kill();
  if (fixture.listening) {
    const closed = closeServer(fixture);
    fixture.closeAllConnections();
    await closed;
  }
}
