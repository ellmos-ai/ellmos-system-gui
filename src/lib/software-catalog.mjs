export function catalogMatches(kind, data) {
  if (kind === 'software') return data?.kind === 'software' && data?.catalog === 'software-applications';
  if (kind === 'ocean') return data?.kind === 'ocean' && data?.catalog === 'ocean-host-sources';
  // Plugin-Zustände dürfen nur aus einem Plugin-Inventar kommen, nie aus einer fremden Antwort (z. B. MCP).
  if (kind === 'plugins') return data?.schema === 'bach.capability-inventory.v1' && data?.kind === 'plugins';
  return true;
}

export function publicationLabel(publication) {
  const states = {planned:'Geplant',built:'Gebaut',submitted:'Eingereicht',live:'Veröffentlicht laut Register',withdrawn:'Zurückgezogen'};
  return [publication.platform || publication.type || 'Veröffentlichung',
    states[publication.declared_status] || 'Status nicht erfasst'].join(' · ');
}

export function safePublicationUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}
