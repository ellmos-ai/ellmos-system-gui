// Plugin-Kabel: Zustand je Plugin, ausschliesslich aus dem Plugin-Inventar (read-only).
// Datenquelle: GET /api/capabilities/plugins/inventory (BACH hub/_services/capability_inventory_service.py:85-190).
// Native Belege liefert das Inventar nur fuer zwei Clients:
//   Claude -> ~/.claude/settings.json, Schluessel enabledPlugins["<plugin>@<marketplace>"] (boolean, nur Benutzer-Scope)
//   Codex  -> ~/.codex/config.toml, [plugins."<plugin>@<marketplace>"].enabled (boolean)
// Gemini und Host-Bibliothek haben keine native Aktivierungsquelle; das BACH-Merker-Flag aus
// /api/capabilities/steckdosen (plugin_sockets) wird bewusst NICHT als Aktivierung verwendet.
export const PLUG_STATES = ['plugged', 'unplugged', 'unknown', 'error'];

export const NATIVE_SOURCES = {
  Claude: 'Claude-Code-Einstellungen (settings.json, enabledPlugins, nur Benutzer-Scope)',
  Codex: 'Codex-Konfiguration (config.toml, plugins.<Plugin>.enabled)',
};

const HEADLINES = {
  plugged: 'Eingesteckt (laut Client-Konfiguration)',
  unplugged: 'Ausgesteckt (laut Client-Konfiguration)',
  unknown: 'Zustand unbekannt',
  error: 'Zustand nicht lesbar',
};

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;

export function plugState(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return build('error', null, 'Der Eintrag ist kein Objekt.');
  }
  const consumer = text(item.consumer);
  const flag = item.enabled_in_client;
  if (flag !== true && flag !== false && flag !== null && flag !== undefined) {
    return build('error', consumer, 'Die Quelle liefert für die Aktivierung keinen Wahrheitswert.', item);
  }
  const source = consumer ? NATIVE_SOURCES[consumer] : undefined;
  if (!source) {
    return build('unknown', consumer, consumer
      ? 'Dieser Client liefert keine native Aktivierungsquelle.'
      : 'Der Eintrag nennt keinen Client.', item);
  }
  if (flag === true) return build('plugged', consumer, 'Die Konfiguration schaltet das Plugin ein.', item, source);
  if (flag === false) return build('unplugged', consumer, 'Die Konfiguration schaltet das Plugin aus.', item, source);
  return build('unknown', consumer, 'Kein boolescher Aktivierungswert im Inventar (Quelle nicht lesbar, ungültig oder kein Eintrag).', item, source);
}

function build(state, consumer, reason, item = {}, source = null) {
  const runtime = item.runtime_active === true ? 'Laufzeit: vom Client bestätigt aktiv.'
    : item.runtime_active === false ? 'Laufzeit: vom Client als nicht aktiv gemeldet.'
    : 'Laufzeit nicht gemessen; eine laufende Sitzung kann abweichen.';
  return {
    state,
    headline: HEADLINES[state],
    reason,
    consumer,
    source: source || 'keine native Quelle',
    // Der Geltungsbereich wird nur für einen belegten Wert erklärt; bei unknown ist nicht bekannt, was gelesen wurde.
    scope: source && (state === 'plugged' || state === 'unplugged') ? 'Der Wert stammt aus dem Benutzer-Scope; Projekt- und lokale Einstellungen sind nicht erfasst.' : null,
    host: 'Host nicht angegeben (die Antwort nennt keinen Hostnamen).',
    runtime,
  };
}

// observedAt: Zeitpunkt des Abrufs im Browser (die Antwort selbst trägt keinen Stand).
export function observedLabel(observedAt) {
  const date = observedAt instanceof Date ? observedAt : new Date(observedAt);
  return Number.isFinite(date.getTime())
    ? 'Abgerufen: ' + date.toLocaleString('de-DE') + ' (Stand der Antwort nicht angegeben)'
    : 'Abruf-Zeitpunkt unbekannt';
}

export function plugAccessibleText(name, info, observedAt) {
  return [name || 'Plugin', info.headline + '.', info.reason, 'Quelle: ' + info.source + '.', info.host, observedLabel(observedAt), info.runtime]
    .join(' ');
}

export function plugSummary(items) {
  const counts = {plugged: 0, unplugged: 0, unknown: 0, error: 0};
  for (const item of Array.isArray(items) ? items : []) counts[plugState(item).state] += 1;
  return counts;
}

export function plugSummaryText(items) {
  const c = plugSummary(items);
  return 'Eingesteckt: ' + c.plugged + ' · Ausgesteckt: ' + c.unplugged + ' · Unbekannt: ' + c.unknown + (c.error ? ' · Nicht lesbar: ' + c.error : '');
}
