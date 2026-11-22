// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {basename, join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {openVerifiedGui, smokeSamples} from './check-native-gui-pages.mjs';

assert.ok(process.platform === 'darwin' && process.env.GITHUB_ACTIONS === 'true'
  && process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.env.RUNNER_OS === 'macOS',
  'Use a disposable GitHub-hosted macOS runner');
const commit = process.env.DESKTOP_SOURCE_COMMIT;
const gui = await openVerifiedGui(resolve('dist'), commit);
const artifacts = resolve('desktop-package');
const receipt = JSON.parse(await readFile(join(artifacts, 'desktop-artifact.json'), 'utf8'));
assert.equal(receipt.source.commit, commit);
assert.equal(receipt.build.run_id, Number(process.env.GITHUB_RUN_ID));
const name = basename(receipt.bundles.app.file, '.tar.gz');
assert.equal(name, 'OpenOcean.app');
const executable = 'ellmos-system-gui-desktop';
const entry = join('Contents', 'MacOS', executable);
const normal = await readFile(join(artifacts, executable));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(normal), receipt.files[executable].sha256);
assert.equal(normal.includes('OCEAN_MAC_SMOKE_INPUTS'), false, 'Test runner is present in the release executable');

let capabilityReads = 0;
const errors = [];
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
const temp = await realpath(process.env.RUNNER_TEMP);
const home = await mkdtemp(join(temp, 'ocean-macos-webview-'));
try {
  const listening = once(fixture, 'listening');
  fixture.listen(0, '127.0.0.1');
  await listening;
  const origin = 'http://127.0.0.1:' + fixture.address().port;
  const target = await realpath(process.env.CARGO_TARGET_DIR);
  assert.equal(target, join(temp, 'ocean-wkwebview-target'));
  const built = join(target, 'release/bundle/macos', name);
  const installed = join(home, name);
  await promisify(execFile)('ditto', [built, installed], {timeout:30000});
  const testBinary = await readFile(join(installed, entry));
  assert.ok(testBinary.includes('OCEAN_MAC_SMOKE_INPUTS'), 'Missing test feature in the native smoke bundle');
  assert.notEqual(hash(testBinary), hash(normal));

  const child = spawn(join(installed, entry), {
    env:{
      ...process.env, HOME:home, CFFIXED_USER_HOME:home,
      OCEAN_MAC_SMOKE_INPUTS:JSON.stringify({
        origin, open_task:smokeSamples.openTask.title,
        done_task:smokeSamples.doneTask.title, worker:smokeSamples.worker.name,
      }),
    },
    stdio:['ignore','pipe','inherit'],
  });
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 150000);
  try {
    const [code, signal] = await once(child, 'close');
    assert.equal(code, 0, 'WKWebView app did not exit cleanly (' + signal + '): ' + stdout.slice(-1500));
  } finally {
    clearTimeout(timeout);
  }

  const proof = stdout.trim().split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).find(row => row?.schema === 'ellmos-system-gui.macos-wkwebview-smoke.v1');
  assert.ok(proof);
  assert.equal(proof.renderer, 'WKWebView');
  assert.equal(proof.native_windows_observed, true);
  assert.equal(proof.connection_restored_after_backend_close, true);
  assert.equal(proof.http_consent_enforced, true);
  assert.equal(proof.tasks_filter_verified, true);
  assert.equal(proof.running_search_verified, true);
  assert.deepEqual(proof.routes, ['/', '/tasks', '/agenten/running']);
  assert.equal(capabilityReads, 1, 'Expected one capability read after loopback consent');
  assert.deepEqual(errors, []);
  const record = {
    ...proof, source_commit:commit, run_id:receipt.build.run_id,
    test_build:'macos-native-smoke', test_binary_sha256:hash(testBinary), release_binary_sha256:hash(normal),
    web_build_page_count:gui.pageCount, page_contract_count:gui.pageCount,
    fixture_backend:'loopback-read-only', clean_window_exit:true,
    routes:proof.routes.map(route => ({route, html_sha256:gui.pageHash(route)})),
  };
  await writeFile(join(artifacts, 'macos-wkwebview-check.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record));
} finally {
  if (fixture.listening) {
    const closed = new Promise(resolve => fixture.close(resolve));
    fixture.closeAllConnections();
    await closed;
  }
  await rm(home, {recursive:true, force:true});
}
