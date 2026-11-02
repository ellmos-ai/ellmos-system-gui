export const INVENTORY_SOURCES = [
  {kind: 'skills', label: 'Skills', route: '/api/capabilities/skills/library', href: '/skills', schema: 'bach.skill-library.v1', field: 'skills'},
  {kind: 'plugins', label: 'Plugins', route: '/api/capabilities/plugins/inventory', href: '/skills/plugins', schema: 'bach.capability-inventory.v1', field: 'items'},
  {kind: 'mcp', label: 'MCP-Verbindungen', route: '/api/capabilities/mcp/connections', href: '/skills/mcp', schema: 'bach.capability-inventory.v1', field: 'items'},
  {kind: 'software', label: 'Software', route: '/api/capabilities/software', href: '/skills/software', schema: 'bach.capability-inventory.v1', field: 'items'},
  {kind: 'ocean', label: 'Ocean-Module und Quellen', route: '/api/capabilities/ocean', href: '/skills/ocean', schema: 'bach.capability-inventory.v1', field: 'items'},
];
const STABLE_COMPONENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

export function isCapabilitiesDocument(value) {
  return Boolean(value && typeof value === 'object'
    && value.schema === 'ellmos.gui.capabilities.v1'
    && Array.isArray(value.endpoints));
}

export function hasAdvertisedReadRoute(capabilities, route) {
  if (!isCapabilitiesDocument(capabilities)) return false;
  return capabilities.endpoints.some((endpoint) => endpoint
    && endpoint.method === 'GET'
    && endpoint.path === route
    && endpoint.available === true);
}

export function normalizeInventory(source, payload) {
  if (!source || !payload || typeof payload !== 'object'
      || payload.schema !== source.schema) {
    throw new Error('Der Katalogvertrag stimmt nicht mit dieser Quelle überein.');
  }
  if (source.kind !== 'skills' && payload.kind !== source.kind) {
    throw new Error('Der Katalog gehört zu einer anderen Komponentenart.');
  }
  const records = payload[source.field];
  if (!Array.isArray(records) || records.length > 500) {
    throw new Error('Der Katalog enthält keine gültige Eintragsliste.');
  }
  return records.filter((item) => item && typeof item === 'object').map((item) => {
    const id = safeComponentId(item.id);
    return {
      id,
      name: boundedText(item.name, 180) || id || 'Unbenannte Komponente',
      category: boundedText(item.category, 100),
      version: boundedText(item.version, 100),
      sourceVersion: boundedText(item.source_version, 100),
      evidence: boundedText(item.evidence, 100),
      connectionState: boundedText(item.connection_state, 100),
      catalogAvailable: triState(item.available),
      installed: triState(item.installed),
      runtimeActive: triState(item.runtime_active),
      codePresent: triState(item.code_present),
      enabledInClient: triState(item.enabled_in_client),
      publications: normalizePublications(item.publications),
    };
  });
}

export function managementHref(source, item) {
  if (!source?.href || !safeComponentId(item?.id)) return null;
  return `${source.href}?component_id=${encodeURIComponent(item.id)}`;
}

export function triState(value) {
  return value === true || value === false ? value : null;
}

export function stateLabel(value, yes, no, unknown = 'Unbekannt') {
  if (value === true) return yes;
  if (value === false) return no;
  return unknown;
}

export function installerActionState(capabilities) {
  const hasMetadata = isCapabilitiesDocument(capabilities);
  const routes = hasMetadata
    ? capabilities.endpoints.filter((endpoint) => /(?:^|\/)installer(?:\/|$)/i.test(endpoint?.path || ''))
    : [];
  return {
    enabled: false,
    registeredRoutes: routes.filter((endpoint) => endpoint.available === true).length,
    reason: routes.length
      ? 'Installer-Routen sind registriert, aber es fehlt ein freigegebener, versionierter GUI-Vertrag.'
      : 'Für diesen GUI-Consumer ist keine Installer-HTTP-API für Planung, Apply, Prüfung oder Entfernung registriert.',
  };
}

export function liveReleaseState(capabilities) {
  if (!isCapabilitiesDocument(capabilities)) return 'unbekannt';
  const route = capabilities.endpoints.find((endpoint) => endpoint?.method === 'GET'
    && /(?:github|releases?)/i.test(endpoint.path || '')
    && endpoint.available === true);
  return route ? 'route-registered-unverified' : 'unavailable';
}

function boundedText(value, maxLength) {
  if (typeof value !== 'string' || value.includes('\0')) return '';
  const text = value.trim().slice(0, maxLength);
  if (looksLikePath(text)) return '';
  return text;
}

function looksLikePath(value) {
  return /(?:^|[\s("'=])(?:[a-z]:[\\/]|\\\\|\/|~[\\/])/i.test(value);
}

function safeComponentId(value) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  return STABLE_COMPONENT_ID.test(id) && !looksLikePath(id) ? id : '';
}

function normalizePublications(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).filter((entry) => entry && typeof entry === 'object').map((entry) => ({
    platform: boundedText(entry.platform, 60),
    declaredStatus: boundedText(entry.declared_status, 80),
    version: boundedText(entry.version, 100),
    liveVerified: entry.live_verified === true,
  }));
}
