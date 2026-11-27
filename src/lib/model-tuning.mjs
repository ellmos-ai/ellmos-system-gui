// Pure helpers for local model hardware-default profiles & num_ctx tuning (#2972 / #4445).

export const MIN_NUM_CTX = 512;
export const MAX_NUM_CTX = 262144;

const CONFIDENCE_LABELS = {
  measured_live: 'Lokal vermessen',
  curated: 'Hardware-Default',
  manual_override: 'Manuell angepasst',
  fallback: 'Basis-Fallback',
};

const SOURCE_LABELS = {
  explicit: 'Direktwert',
  slot_override: 'Agent-Override',
  model_config: 'Modell-Config',
  reserve_policy: 'Reserve-Budget',
  catalog_default: 'Hardware-Katalog',
  env_fallback: 'Umgebungsvariable',
  safe_baseline: 'Sicherheitsbasis',
};

export function formatConfidenceLabel(tier) {
  return CONFIDENCE_LABELS[String(tier || '')] || 'Unbekannt';
}

export function formatSourceLabel(source) {
  return SOURCE_LABELS[String(source || '')] || 'Unbekannt';
}

export function formatNumberDe(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '–';
  return new Intl.NumberFormat('de-DE').format(num);
}

export function validateNumCtxInput(raw, modelMeta = null) {
  if (typeof raw === 'boolean') {
    return { ok: false, error: 'Kontextfenster (num_ctx) muss eine ganze Zahl sein.' };
  }
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) {
    return { ok: false, error: 'Kontextfenster (num_ctx) muss eine ganze Zahl sein.' };
  }
  const value = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(value) || value < MIN_NUM_CTX || value > MAX_NUM_CTX) {
    return {
      ok: false,
      error: `Kontextfenster (num_ctx) muss zwischen ${formatNumberDe(MIN_NUM_CTX)} und ${formatNumberDe(MAX_NUM_CTX)} liegen.`,
    };
  }
  let warning = '';
  if (modelMeta && modelMeta.supported_on_host === false) {
    warning = 'Modell überschreitet die empfohlene RAM-Klasse dieses Hosts.';
  } else if (modelMeta && Number.isFinite(Number(modelMeta.num_ctx_max)) && value > Number(modelMeta.num_ctx_max)) {
    warning = `Wert liegt über dem empfohlenen Host-Limit (${formatNumberDe(modelMeta.num_ctx_max)} Token) — OOM-Risiko bei langen Tool-Ketten.`;
  }
  return { ok: true, value, warning };
}

export function sortModelTuningEntries(models) {
  if (!Array.isArray(models)) return [];
  return [...models].sort((a, b) => {
    const instDiff = Number(Boolean(b?.installed)) - Number(Boolean(a?.installed));
    if (instDiff !== 0) return instDiff;
    const suppDiff = Number(Boolean(b?.supported_on_host)) - Number(Boolean(a?.supported_on_host));
    if (suppDiff !== 0) return suppDiff;
    return String(a?.model || '').localeCompare(String(b?.model || ''), 'de');
  });
}

export function describeModelTuningSummary(payload) {
  if (!payload || payload.ok !== true || !Array.isArray(payload.models)) {
    return {
      ready: false,
      hostBadge: 'Nicht verfügbar',
      summaryText: 'Modell-Tuning-Adapter nicht erreichbar.',
    };
  }
  const ram = Number(payload.host_ram_gib);
  const ramLabel = Number.isFinite(ram) && ram > 0
    ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(ram)} GiB RAM`
    : 'RAM unbekannt';
  const installedCount = payload.models.filter(m => m && m.installed === true).length;
  const manualCount = payload.models.filter(m => m && m.has_manual_override === true).length;
  const hostBadge = `${ramLabel} · ${payload.models.length} Profile`;
  const summaryText = installedCount > 0
    ? `${installedCount} lokal installiert · ${payload.models.length} Hardware-Profile · ${manualCount} manuell angepasst`
    : `${payload.models.length} kuratierte Hardware-Profile geladen · ${manualCount} manuell angepasst`;
  return {
    ready: true,
    hostBadge,
    summaryText,
  };
}
