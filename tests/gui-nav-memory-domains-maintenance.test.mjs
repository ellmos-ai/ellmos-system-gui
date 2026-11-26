import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderRoleSocketPreview } from '../src/lib/role-socket-preview.mjs';
import { refreshMaintenanceStatus } from '../src/scripts/maintenance-page.mjs';

const nav = JSON.parse(readFileSync(new URL('../src/config/nav_config.json', import.meta.url), 'utf8'));
const domainStudio = readFileSync(new URL('../src/scripts/domain-studio.mjs', import.meta.url), 'utf8');
const memoryPage = readFileSync(new URL('../src/pages/memory.astro', import.meta.url), 'utf8');
const runningPage = readFileSync(new URL('../src/pages/agenten/running.astro', import.meta.url), 'utf8');
const helpPage = readFileSync(new URL('../src/pages/help.astro', import.meta.url), 'utf8');
const toolsPage = readFileSync(new URL('../src/pages/tools.astro', import.meta.url), 'utf8');
const headerPage = readFileSync(new URL('../src/components/Header.astro', import.meta.url), 'utf8');
const maintenancePage = readFileSync(new URL('../src/pages/maintenance.astro', import.meta.url), 'utf8');
const maintenanceScript = readFileSync(new URL('../src/scripts/maintenance-page.mjs', import.meta.url), 'utf8');

test('domain-studio imports createDomainIconElement from domain-pins', () => {
  assert.match(domainStudio, /import\s*\{[^}]*\bcreateDomainIconElement\b[^}]*\}\s*from\s*'\.\.\/lib\/domain-pins\.mjs'/);
  assert.match(domainStudio, /createDomainIconElement\(domain\.id/);
});

test('sidebar Bibliothek has no duplicate /skills link and every nav id has a line icon', () => {
  const library = nav.presets.standard.sections
    .find((s) => s.id === 'arbeit')
    .items.find((i) => i.id === 'library');
  const hrefs = library.children.map((c) => c.href);
  assert.equal(new Set(hrefs).size, hrefs.length, `duplicate hrefs in Bibliothek: ${hrefs.join(', ')}`);
  assert.equal(library.children.find((c) => c.id === 'find-tools')?.href, '/tools');
  assert.doesNotMatch(toolsPage, /href="\/anonymizer"/);

  const iconBlock = headerPage.slice(headerPage.indexOf('const LINE_ICON_SVGS'), headerPage.indexOf('function lineIconSvg'));
  for (const id of ['notes', 'installation-updates', 'overview']) {
    assert.match(iconBlock, new RegExp(`(?:"${id}"|\\b${id}):\\s*'`), `missing line icon for ${id}`);
  }
  assert.match(headerPage, /bach-ui-nav-open-groups/);
});

test('memory and running pages cross-link cleanly and memory has no fabricated telemetry', () => {
  assert.match(runningPage, /href="\/memory"/);
  assert.match(memoryPage, /href="\/agenten\/running"/);
  assert.match(memoryPage, /href="\/governance\/hooks"/);
  assert.doesNotMatch(memoryPage, /href="\/governance#hooks-guards"/);
  assert.doesNotMatch(helpPage, /href="\/governance#hooks-guards"/);
  assert.doesNotMatch(memoryPage, /0\.71% Belegt|Messung: Nominal|0 Loops erkannt/);
  assert.doesNotMatch(memoryPage, /Agenten-Fabrik:/);
  assert.match(memoryPage, /chip-sys-status/);
  assert.match(memoryPage, /hermes-status-badge/);
});

test('role-socket-preview filters roles by query without HTML injection', () => {
  const nodes = [];
  const doc = {
    createElement(tag) {
      const node = {
        tag,
        textContent: '',
        className: '',
        style: {},
        children: [],
        append(...items) { this.children.push(...items); },
        replaceChildren(...items) { this.children = [...items]; },
      };
      nodes.push(node);
      return node;
    },
  };
  const container = doc.createElement('div');
  const catalogue = {
    role_socket_catalog: { provider_sockets: { domain_specialist: { providers: { ollama: 'local-x' } } } },
    templates: [
      { role_id: 'dev', label: 'Entwickler', tier: 'core', socket_id: 'domain_specialist', semantic_route: 'coding-debugging-umbrella' },
      { role_id: 'fin', label: 'Finanzprüfer', source: 'module_manifest_role', module_id: 'fin-mod', socket_id: 'domain_specialist' },
    ],
  };
  assert.equal(renderRoleSocketPreview(doc, container, catalogue, 'ollama', { query: 'finanz' }), 1);
  assert.equal(container.children.length, 1);
  assert.equal(renderRoleSocketPreview(doc, container, catalogue, 'ollama', { query: 'nicht-vorhanden' }), 0);
  assert.equal(container.children.length, 1);
  assert.match(container.children[0].textContent, /Keine passenden Ocean-Rollen/);
});

test('maintenance page wires live backend readers safely without unsafe HTML sinks', async () => {
  assert.match(maintenancePage, /import '\.\.\/scripts\/maintenance-page\.mjs'/);
  assert.doesNotMatch(maintenanceScript, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\balert\(/);

  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, { id, textContent: '', dataset: {} });
    return elements.get(id);
  };
  const doc = { getElementById: (id) => get(id) };
  const fetcher = async (url) => {
    const map = {
      '/api/wartung/status': { backup: { backup_count: 2, last_backup: '2026-11-26T20:14:23' } },
      '/api/daemon/status': { running: true, pid: 79528, identity: 'verified', stats: { active_jobs: 4, runs_today: 2 }, last_runs: [{ name: 'DB Backup', result: 'success' }] },
      '/api/governance/locks': { availability: 'available', count: 0, source: 'lock_scan_cache', scanned_at: '2026-11-26T19:15:35+00:00' },
      '/api/memory/cognitive-state': { langzeit_gedaechtnis: { facts: { count: 42 }, lessons: { count: 131 }, working: { count: 5 }, sessions: { count: 9 } } },
    };
    return { ok: true, status: 200, async json() { return map[url]; } };
  };

  const result = await refreshMaintenanceStatus(doc, fetcher);
  assert.equal(result.okCount, 4);
  assert.match(get('maint-kpi-daemon').textContent, /79528/);
  assert.equal(get('maint-kpi-backup').textContent, '2 Backups');
  assert.equal(get('maint-kpi-locks').textContent, '0 aktiv');
  assert.match(get('maint-db-detail').textContent, /42 Fakten/);
  assert.equal(get('maint-kpi-sources').textContent, '4 / 4 erreichbar');
});
