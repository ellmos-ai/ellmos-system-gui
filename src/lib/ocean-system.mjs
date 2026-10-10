// View models for System/Ocean (#2017 Schaltplan + Gesamtschaltplan, #2019 Satelliten).
// Input: a catalog validated by parseCatalog() plus the AUTHORED architecture (areas, edges, layers). The authored part is
// curated intent ("declared"), never a measurement; modules, counts and git facts come only from the catalog projection.
import {itemsOfType} from './catalog-projection.mjs';
import {gitSnapshot} from './catalog-views.mjs';

export const VIEWS = [
  {id: 'schaltplan', label: 'Schaltplan'},
  {id: 'gesamtschaltplan', label: 'Gesamtschaltplan'},
  {id: 'satelliten', label: 'Satelliten'},
];
export const viewFromSearch = search => {
  const view = new URLSearchParams(search).get('view');
  return VIEWS.some(v => v.id === view) ? view : VIEWS[0].id;
};

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = what => { throw new Error('Architekturdaten ungültig: ' + what); };
const bilingual = (v, where) => { if (!isObject(v) || typeof v.de !== 'string' || typeof v.en !== 'string') fail(where); return v; };

export function parseAuthored(data) {
  if (!isObject(data) || !isObject(data._meta) || data._meta.basis !== 'declared') fail('_meta.basis muss "declared" sein');
  if (!Array.isArray(data.areas) || !data.areas.length || !Array.isArray(data.edges) || !Array.isArray(data.layers)) fail('areas/edges/layers');
  const ids = new Set();
  for (const area of data.areas) {
    if (typeof area.id !== 'string' || !area.id || ids.has(area.id) || typeof area.dir !== 'string') fail('Bereich ' + area.id);
    ids.add(area.id);
    bilingual(area.name, 'name ' + area.id); bilingual(area.q, 'q ' + area.id); bilingual(area.desc, 'desc ' + area.id);
  }
  for (const edge of data.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) fail('Kante verweist auf unbekannten Bereich');
    bilingual(edge.label, 'edge.label'); bilingual(edge.desc, 'edge.desc');
  }
  for (const layer of data.layers) { bilingual(layer.n, 'layer.n'); bilingual(layer.d, 'layer.d'); }
  if (!isObject(data.ui) || !isObject(data.ui.de) || !isObject(data.ui.en) || !isObject(data.icons)) fail('ui/icons');
  return data;
}

// Status buckets follow the legacy map: ok = active/released, plan = planned, everything else with a value = dev.
// No status at all stays "unknown" - it is never rounded up to "ok".
export function statusClass(status) {
  if (!status) return 'unknown';
  const s = status.toLowerCase();
  if (['active', 'released', 'stable', 'ok'].includes(s)) return 'ok';
  if (s === 'planned' || s === 'plan') return 'plan';
  return 'dev';
}
export const STATUS_LABEL = {ok: 'im Einsatz', dev: 'in Entwicklung', plan: 'geplant', unknown: 'Status unbekannt'};
export const isPublic = item => typeof item.visibility === 'string' && item.visibility.toLowerCase().startsWith('public');
export const visibilityLabel = item => item.visibility || 'Sichtbarkeit unbekannt';

export function safeRepoUrl(item) {
  if (!item.repository || isPublic(item) === false) return null;
  try { const url = new URL(item.repository.replace(/\.git$/, '')); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
}

// Org of a module: only what its repository URL declares (https://github.com/<org>/<repo>); otherwise unknown.
export function moduleOrg(item) {
  if (item.org) return item.org;
  const match = /^https:\/\/github\.com\/([^/]+)\//.exec(item.repository || '');
  return match ? match[1] : null;
}

const matches = (item, query) => {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return [item.id, item.name, item.description, item.category, ...item.provides, ...item.requires].some(v => v && v.toLowerCase().includes(needle));
};

// Who provides a capability: declared in provides[] of catalog modules. Unresolved requirements stay visible.
export function capabilityLinks(catalog, item) {
  const modules = itemsOfType(catalog, 'module');
  return {
    provides: item.provides.map(cap => ({capability: cap, consumers: modules.filter(m => m.id !== item.id && m.requires.concat(m.optional).includes(cap)).map(m => m.name)})),
    requires: item.requires.map(cap => ({capability: cap, requirement: 'required', providers: modules.filter(m => m.id !== item.id && m.provides.includes(cap)).map(m => m.name)})).concat(
      item.optional.map(cap => ({capability: cap, requirement: 'optional', providers: modules.filter(m => m.id !== item.id && m.provides.includes(cap)).map(m => m.name)}))),
  };
}

export function moduleCard(catalog, item) {
  return {
    key: 'module:' + item.id, id: item.id, name: item.name, description: item.description, version: item.version, area: item.category,
    status: statusClass(item.status), statusRaw: item.status, visibility: visibilityLabel(item), isPublic: isPublic(item),
    repoUrl: safeRepoUrl(item), git: gitSnapshot(item.git), links: capabilityLinks(catalog, item),
  };
}

// ---------------------------------------------------------------- Schaltplan
export function schaltplanModel(catalog, authored, filters = {}) {
  const modules = itemsOfType(catalog, 'module');
  const areaIds = new Set(authored.areas.map(a => a.id));
  const visible = item => matches(item, filters.query) && (!filters.publicOnly || isPublic(item));
  const zone = (id, dir, name, q, desc, items, cross) => ({id, dir, name, q, desc, cross: !!cross, modules: items.map(item => Object.assign(moduleCard(catalog, item), {hit: visible(item)}))});
  const zones = authored.areas.map(a => zone(a.id, a.dir, a.name, a.q, a.desc, modules.filter(m => m.category === a.id), a.cross));
  const orphans = modules.filter(m => !areaIds.has(m.category));
  const unassigned = orphans.length ? zone('_unassigned', '', {de: 'Ohne deklarierten Bereich', en: 'No declared area'},
    {de: 'Kategorie nicht im kuratierten Schaltplan', en: 'Category not in the curated map'},
    {de: 'Diese Module tragen eine Kategorie, die der kuratierte Schaltplan nicht kennt. Sie sind nicht verdrahtet.', en: 'These modules carry a category the curated map does not know. They are not wired.'}, orphans) : null;
  return {
    zones, unassigned, edges: authored.edges, layers: authored.layers,
    total: catalog.counts.module ?? 0, hits: modules.filter(visible).length,
    emptyZones: zones.filter(z => !z.modules.length).map(z => z.id),
  };
}

// ---------------------------------------------------------------- Gesamtschaltplan
// Modules + satellites in the architecture columns. The projection carries NO repo tier, so none is shown or invented.
function entry(catalog, item) {
  return {
    key: item.type + ':' + item.id, type: item.type, kind: item.type === 'module' ? 'Modul' : 'Satellit', id: item.id, name: item.name,
    org: moduleOrg(item), visibility: visibilityLabel(item), isPublic: isPublic(item), column: item.category,
    provides: item.provides.length, requires: item.requires.length + item.optional.length, git: gitSnapshot(item.git), description: item.description,
  };
}

export function gesamtModel(catalog, authored, filters = {}) {
  const items = itemsOfType(catalog, 'module').concat(itemsOfType(catalog, 'satellite'));
  const all = items.map(item => entry(catalog, item));
  const areaIds = new Set(authored.areas.map(a => a.id));
  const keep = (e, item) => matches(item, filters.query) && (!filters.org || e.org === filters.org) && (!filters.visibility || e.visibility === filters.visibility);
  const hits = all.filter((e, i) => keep(e, items[i]));
  const columns = authored.areas.map(a => ({id: a.id, dir: a.dir, name: a.name, entries: hits.filter(e => e.column === a.id)}));
  const other = hits.filter(e => !areaIds.has(e.column));
  const countBy = key => { const m = new Map(); for (const e of all) { const k = e[key] || 'unbekannt'; m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };
  const modules = itemsOfType(catalog, 'module');
  const wiring = modules.filter(m => m.requires.length || m.optional.length).map(m => ({module: m.name, links: capabilityLinks(catalog, m).requires}));
  return {
    columns, other, orgs: countBy('org'), visibilities: countBy('visibility'),
    total: (catalog.counts.module ?? 0) + (catalog.counts.satellite ?? 0), hits: hits.length, wiring,
    tierNote: 'Die Katalogprojektion enthält keine Repo-Tiers; sie werden hier weder gezeigt noch ergänzt.',
  };
}

// ---------------------------------------------------------------- Satelliten
export function satelliteRows(catalog) {
  return itemsOfType(catalog, 'satellite').map(item => ({
    key: 'satellite:' + item.id, id: item.id, name: item.name, description: item.description, org: item.org, domain: item.category,
    visibility: visibilityLabel(item), provenance: item.provenance, upstream: item.upstream,
    gitState: item.git.state, git: gitSnapshot(item.git), gitHost: item.git.host, gitBranch: item.git.branch, observedAt: item.git.observedAt,
    gitHosts: item.gitHosts.map(g => g.host).filter(Boolean),
  }));
}

export function satelliteModel(catalog, filters = {}) {
  const rows = satelliteRows(catalog);
  const needle = String(filters.query || '').trim().toLowerCase();
  const hits = rows.filter(r => (!filters.org || r.org === filters.org) && (!filters.domain || r.domain === filters.domain) &&
    (!filters.gitState || r.gitState === filters.gitState) &&
    (!needle || [r.id, r.name, r.description, r.domain, r.upstream].some(v => v && v.toLowerCase().includes(needle))));
  const tally = key => { const m = new Map(); for (const r of rows) { const k = r[key] || 'unbekannt'; m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };
  return {
    rows: hits, total: catalog.counts.satellite ?? 0, hits: hits.length,
    orgs: tally('org'), domains: tally('domain'), gitStates: tally('gitState'),
  };
}
