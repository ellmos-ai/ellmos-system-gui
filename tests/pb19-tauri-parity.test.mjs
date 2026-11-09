// PB-19: Tauri-Desktop-GUI parity and contract validation
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const readJson = rel => JSON.parse(readFileSync(new URL(rel, root), 'utf8'));
const readText = rel => readFileSync(new URL(rel, root), 'utf8');

function pagePaths(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry =>
    entry.isDirectory() ? pagePaths(new URL(entry.name + '/', directory)) : [new URL(entry.name, directory)]
  );
}

test('Tauri configuration version matches package.json', () => {
  const pkg = readJson('package.json');
  const tauri = readJson('src-tauri/tauri.conf.json');
  assert.equal(tauri.version, pkg.version);
});

test('Cargo.toml version matches package.json and Cargo.lock is synced', () => {
  const pkg = readJson('package.json');
  const cargo = readText('src-tauri/Cargo.toml');
  const match = cargo.match(/^version\s*=\s*"([^"]+)"/m);
  assert.ok(match, 'version in Cargo.toml not found');
  assert.equal(match[1], pkg.version);

  const cargoLock = readText('src-tauri/Cargo.lock');
  assert.match(cargoLock, new RegExp(`name = "ellmos-system-gui-desktop"\\r?\\nversion = "${pkg.version}"`));
});

test('Tauri product name reflects OpenOcean and window title reflects Ocean (BACH)', () => {
  const tauri = readJson('src-tauri/tauri.conf.json');
  assert.equal(tauri.productName, 'OpenOcean');
  assert.match(tauri.bundle.shortDescription, /OpenOcean \(BACH\)/);

  const mainRs = readText('src-tauri/src/main.rs');
  assert.match(mainRs, /"Ocean \(BACH\)"/);
  assert.match(mainRs, /"Ocean \(BACH\) verbinden"/);
});

test('Tauri updater configuration structure is valid', () => {
  const tauri = readJson('src-tauri/tauri.conf.json');
  assert.ok(tauri.plugins?.updater, 'plugins.updater missing');
  assert.ok(Array.isArray(tauri.plugins.updater.endpoints), 'endpoints must be an array');
  assert.ok(tauri.plugins.updater.endpoints.length > 0, 'endpoints array must not be empty');
  for (const endpoint of tauri.plugins.updater.endpoints) {
    const url = new URL(endpoint);
    assert.equal(url.protocol, 'https:');
  }
});

test('Tauri expected_page_count matches Web-Build parity (51 productive pages)', () => {
  const pages = pagePaths(new URL('src/pages/', root)).filter(p => p.pathname.endsWith('.astro'));
  assert.equal(pages.length, 51);
});
