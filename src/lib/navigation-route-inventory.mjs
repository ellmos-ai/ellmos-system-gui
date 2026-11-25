export const fallbackTask = Object.freeze({
  id: 2468,
  href: '/tasks?task=2468#task-board',
  label: 'Aufgabe #2468 öffnen',
});

export const commonRoutePaths = Object.freeze([
  '/routinen',
  '/chat',
  '/persoenlich',
  '/financial',
  '/gesundheit',
  '/ati',
  '/steuer',
  '/kontakte',
  '/daemon',
]);

export const legacyFallbackRoutes = Object.freeze([
  {
    path: '/inbox',
    label: 'Inbox & Dateien',
    reason: 'Die Datei-Inbox ist in Artefakte, Anonymisierung und Einstellungen aufgeteilt.',
    nextHref: '/artefakte',
    nextLabel: 'Artefakte öffnen',
  },
  {
    path: '/help',
    label: 'Hilfe & Dokumentation',
    reason: 'Gemeinsame Architektur- und Doku-Seite (Legacy-Fallback nur noch archiviert).',
    nextHref: '/settings',
    nextLabel: 'Einstellungen öffnen',
  },
  {
    path: '/tools',
    label: 'Tools & CLI-Werkzeuge',
    reason: 'Gemeinsame Werkzeug-Suche (Legacy-Fallback nur noch archiviert).',
    nextHref: '/skills',
    nextLabel: 'Skill- & Tool-Center öffnen',
  },
  {
    path: '/maintenance',
    label: 'Wartung & Integrität',
    reason: 'Gemeinsame Wartungsansicht (Legacy-Fallback nur noch archiviert).',
    nextHref: '/governance',
    nextLabel: 'Governance öffnen',
  },
]);

export function pathFromHref(href) {
  return new URL(href, 'https://ellmos-gui.invalid').pathname;
}
