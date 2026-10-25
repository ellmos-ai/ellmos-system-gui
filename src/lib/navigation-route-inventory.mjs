export const fallbackTask = Object.freeze({
  id: 2468,
  href: '/tasks?task=2468#task-board',
  label: 'Aufgabe #2468 öffnen',
});

export const commonRoutePaths = Object.freeze(['/routinen']);

export const legacyFallbackRoutes = Object.freeze([
  {
    path: '/persoenlich',
    label: 'Persönlicher Assistent',
    reason: 'Der BACH-Consumer liefert hier noch eine alte Assistenten-Vorlage.',
    nextHref: '/life',
    nextLabel: 'Life-Zentrale öffnen',
  },
  {
    path: '/chat',
    label: 'Chat',
    reason: 'Der alte Chat-Pfad ist noch nicht an die gemeinsame Chat-Oberfläche gebunden.',
    nextHref: '/agenten/running',
    nextLabel: 'Living & Running öffnen',
  },
  {
    path: '/denkarium',
    label: 'Denkarium',
    reason: 'Das frühere Gedankenlabor liefert noch die alte BACH-Vorlage.',
    nextHref: '/memory',
    nextLabel: 'Memory öffnen',
  },
  {
    path: '/financial',
    label: 'Finanzen',
    reason: 'Der Finanzpfad ist noch nicht in die gemeinsame Life-Oberfläche umgestellt.',
    nextHref: '/life',
    nextLabel: 'Life-Zentrale öffnen',
  },
  {
    path: '/gesundheit',
    label: 'Gesundheit & Vitalität',
    reason: 'Der Fachpfad fällt im BACH-Consumer noch auf eine alte Vorlage zurück.',
    nextHref: '/life',
    nextLabel: 'Life-Zentrale öffnen',
  },
  {
    path: '/ati',
    label: 'ATI-Entwickler',
    reason: 'Der Domänenpfad ist noch nicht als gemeinsame Astro-Seite angebunden.',
    nextHref: '/domains',
    nextLabel: 'Domänen öffnen',
  },
  {
    path: '/steuer',
    label: 'Steuern',
    reason: 'Der Steuerpfad liefert noch die alte BACH-Fachvorlage.',
    nextHref: '/domains',
    nextLabel: 'Domänen öffnen',
  },
  {
    path: '/inbox',
    label: 'Inbox & Dateien',
    reason: 'Die Datei-Inbox ist noch nicht auf die gemeinsame Oberfläche umgestellt.',
    nextHref: '/user-inbox',
    nextLabel: 'Nachrichten öffnen',
  },
  {
    path: '/help',
    label: 'Hilfe & Dokumentation',
    reason: 'Der Hilfe-Pfad hat noch keine eigene gemeinsame Astro-Seite.',
    nextHref: '/settings',
    nextLabel: 'Einstellungen öffnen',
  },
  {
    path: '/tools',
    label: 'Tools & CLI-Werkzeuge',
    reason: 'Der Werkzeugpfad liefert noch die alte BACH-Vorlage.',
    nextHref: '/skills',
    nextLabel: 'Skill- & Tool-Center öffnen',
  },
  {
    path: '/maintenance',
    label: 'Wartung & Integrität',
    reason: 'Der Wartungspfad ist noch nicht an eine gemeinsame Seite angebunden.',
    nextHref: '/governance',
    nextLabel: 'Governance öffnen',
  },
  {
    path: '/kontakte',
    label: 'Kontakte & Netzwerk',
    reason: 'Der Header-Schnellzugriff zeigt noch den alten Kontaktpfad des BACH-Consumers.',
    nextHref: '/life',
    nextLabel: 'Life-Zentrale öffnen',
  },
  {
    path: '/daemon',
    label: 'Daemon & Dienste',
    reason: 'Ohne den neuen Ketten-Tab fällt der Dienstpfad auf die alte BACH-Vorlage zurück.',
    nextHref: '/daemon?tab=chains',
    nextLabel: 'Daemon-Ketten öffnen',
    mode: 'query-gated',
  },
]);

export function pathFromHref(href) {
  return new URL(href, 'https://ellmos-gui.invalid').pathname;
}
