// View data for the Ocean catalog views (#2018): bundle and stack cards, skill library, source status.
// Input is ALWAYS a catalog validated by parseCatalog() (catalog-projection.mjs). Nothing here reads files or
// guesses: what the projection does not say stays "unbekannt". Counts come only from catalog.counts.
import {itemsOfType, gitLabel, sourceProblems} from './catalog-projection.mjs';
import {SKILL_ID} from './capability-board-client.mjs';

export const REQUIREMENTS = [
  {key: 'required', label: 'Erforderlich'},
  {key: 'recommended', label: 'Empfohlen'},
  {key: 'optional', label: 'Optional'},
  {key: null, label: 'Anforderung nicht deklariert'},
];
export const TYPE_LABELS = {module: 'Modul', bundle: 'Bundle', stack: 'Stack', skill: 'Skill', satellite: 'Satellit',
  'skill-library': 'Skill-Bibliothek', capability: 'Fähigkeit'};

const itemKey = item => item.type + ':' + item.id;

// A relation target is either the plain id ("bundle-one") or "<type>:<id>" ("module:alpha-core").
// Items are keyed by type + id; aliases are never used to resolve (they are not unique).
export function resolveTarget(catalog, relation) {
  const wanted = [relation.target];
  const prefix = relation.targetType + ':';
  if (relation.target.startsWith(prefix)) wanted.push(relation.target.slice(prefix.length));
  return catalog.items.find(item => item.type === relation.targetType && wanted.includes(item.id)) || null;
}

export function measuredSummary(item) {
  const m = item.measured;
  const nothing = m.installed === null && m.runtimeActive === null && m.observedAt === null && m.evidence === null;
  if (nothing) return {measured: false, text: 'Nicht gemessen (Zustand: ' + m.connectionState + ')'};
  const parts = [];
  if (m.installed !== null) parts.push(m.installed ? 'installiert' : 'nicht installiert');
  if (m.runtimeActive !== null) parts.push(m.runtimeActive ? 'läuft' : 'läuft nicht');
  parts.push('Zustand: ' + m.connectionState);
  if (m.host) parts.push('Host ' + m.host);
  if (m.observedAt) parts.push('beobachtet ' + m.observedAt);
  if (m.evidence) parts.push('Beleg: ' + m.evidence);
  return {measured: true, text: parts.join(' · ')};
}

function itemProblems(catalog, item) {
  const sourceIssues = catalog.sources.filter(s => item.sourceIds.includes(s.id) && s.availability !== 'available')
    .map(s => 'Quelle ' + s.id + ': ' + (s.availability === 'missing' ? 'fehlt' : 'Fehler') + (s.error ? ' (' + s.error + ')' : ''));
  const errors = catalog.errors.filter(e => e.item === item.id).map(e => 'Fehler in ' + e.source + ': ' + e.reason);
  return sourceIssues.concat(errors);
}

// Composition = what a bundle/stack DECLARES to contain (basis "declared"), grouped by requirement.
export function compositionCard(catalog, item) {
  const groups = REQUIREMENTS.map(({key, label}) => ({
    requirement: key, label,
    entries: item.relations.filter(r => r.requirement === key).map(r => {
      const target = resolveTarget(catalog, r);
      return {
        kind: r.kind, target: r.target, targetType: r.targetType,
        typeLabel: TYPE_LABELS[r.targetType] || r.targetType,
        resolved: !!target, name: target ? target.name : r.target, version: target ? target.version : null,
      };
    }),
  })).filter(group => group.entries.length);
  const problems = itemProblems(catalog, item);
  return {
    key: itemKey(item), type: item.type, id: item.id, name: item.name, version: item.version, description: item.description,
    category: item.category, status: item.status, visibility: item.visibility,
    declared: {groups, total: item.relations.length, empty: item.relations.length === 0},
    measured: measuredSummary(item), git: gitLabel(item.git), problems,
  };
}

export const bundleCards = catalog => itemsOfType(catalog, 'bundle').map(item => compositionCard(catalog, item));
export const stackCards = catalog => itemsOfType(catalog, 'stack').map(item => compositionCard(catalog, item));

// The full text is read lazily from /api/capabilities/skills/{id}/source. That endpoint addresses the library id,
// which for catalog skills is the skill name; a name that is not a valid library id has NO readable full text.
export const skillTextId = item => (SKILL_ID.test(item.name) ? item.name : null);

export function skillRows(catalog) {
  return itemsOfType(catalog, 'skill').map(item => ({
    key: itemKey(item), id: item.id, name: item.name, version: item.version, category: item.category,
    description: item.description, status: item.status, pathLabel: item.pathLabel, languages: item.languages,
    textId: skillTextId(item), problems: itemProblems(catalog, item),
  }));
}

export function filterRows(rows, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(row => [row.name, row.id, row.description, row.category].some(v => v && v.toLowerCase().includes(needle)));
}

// Counts: only the projection's own counts (validated against items by parseCatalog), never recomputed from text.
export function countsLine(catalog) {
  return ['bundle', 'stack', 'skill'].map(type => ({type, label: TYPE_LABELS[type], count: catalog.counts[type] ?? 0}));
}

export function sourceRows(catalog) {
  const problem = new Set(sourceProblems(catalog).map(s => s.id));
  return catalog.sources.map(s => ({
    id: s.id, kind: s.kind, pathLabel: s.pathLabel, availability: s.availability, ok: !problem.has(s.id),
    status: s.availability === 'available' ? 'verfügbar' : s.availability === 'missing' ? 'fehlt' : 'Fehler',
    error: s.error, generatedAt: s.generatedAt, generatedAtBasis: s.generatedAtBasis, host: s.host,
  }));
}

export const catalogNotes = catalog => {
  const notes = [];
  if (catalog.host.source === 'declared') notes.push('Der Host wurde nicht gemessen, sondern deklariert (' + (catalog.host.id || 'ohne Kennung') + ').');
  if (catalog.truncated) notes.push('Die Antwort ist gekürzt: nicht alle Einträge sind enthalten.');
  if (catalog.redactions > 0) notes.push(catalog.redactions + ' Angaben wurden serverseitig als Pfad entfernt.');
  return notes;
};
