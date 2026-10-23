// SPDX-License-Identifier: MIT
// Explicit integration test; no browser download, API connection or shared profile.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {basename, join, resolve, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';

const browser = process.argv[2];
if (!browser) throw new Error('Usage: node tests/run-dompurify-browser.mjs <chromium-executable> [receipt.json]');
const fixture = fileURLToPath(new URL('./fixtures/dompurify-regressions.html', import.meta.url));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const tempRoot = resolve(tmpdir());
const profile = mkdtempSync(join(tempRoot, 'ellmos-dompurify-'));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
try {
  const result = spawnSync(resolve(browser), [
    '--headless', '--dump-dom', '--disable-background-networking',
    '--disable-component-update', '--disable-extensions', '--no-first-run',
    '--host-resolver-rules=MAP * ~NOTFOUND', '--allow-file-access-from-files',
    '--user-data-dir=' + profile, '--timeout=10000', '--virtual-time-budget=1500',
    pathToFileURL(fixture).href,
  ], {encoding:'utf8', windowsHide:true, timeout:30000, maxBuffer:16 * 1024 * 1024});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  const match = result.stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
  assert.ok(match, 'Browser did not produce a regression receipt');
  const text = match[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const receipt = JSON.parse(text);
  receipt.fixture_sha256 = digest(fixture);
  receipt.browser_sha256 = digest(resolve(browser));
  receipt.runner_sha256 = digest(fileURLToPath(import.meta.url));
  receipt.installed_bundle_sha256 = digest(fileURLToPath(new URL('../node_modules/dompurify/dist/purify.js', import.meta.url)));
  receipt.observed_at = new Date().toISOString();
  receipt.scope = 'synthetic DOMPurify browser cases; not consumer/device acceptance';
  if (process.argv[3]) writeFileSync(resolve(process.argv[3]), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
  assert.equal(receipt.version, lock.packages['node_modules/dompurify'].version);
  assert.equal(receipt.results.length, 9);
  assert.equal(receipt.passed, true);
  assert.ok(receipt.results.every(item => item.passed === true));
} finally {
  // Only the exact mkdtemp-owned directory inside the resolved temp root.
  assert.ok(resolve(profile).startsWith(tempRoot + sep));
  assert.ok(basename(profile).startsWith('ellmos-dompurify-'));
  rmSync(profile, {recursive:true, force:true});
}
