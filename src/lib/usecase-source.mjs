// Herkunft und Datenstand der Usecase-Liste. Nur Ocean liefert `source` (ellmos-ai/open-ocean tools/gui_bridge.py,
// usecases_reader); BACH nicht. Fehlt es oder ist es ungueltig, gibt es keine Anzeige (null).
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;

function formatDate(value) {
  const iso = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2})))?$/.exec(value);
  if (!iso) return null;
  const calendar = new Date(`${iso[1]}T00:00:00Z`);
  if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== iso[1]) return null;
  if (iso[2] !== undefined && (+iso[2] > 23 || +iso[3] > 59 || +iso[4] > 59 ||
    (iso[6] !== undefined && (+iso[6] > 23 || +iso[7] > 59)))) return null;
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return null;
  // Reines Datum ist UTC-Mitternacht und darf durch die lokale Zeitzone nicht um einen Tag springen.
  return stamp.toLocaleDateString('de-DE', /^\d{4}-\d{2}-\d{2}$/.test(value) ? {timeZone: 'UTC'} : undefined);
}

export function sourceNotice(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const origin = text(source.id);
  const generated = text(source.generated_at);
  const date = generated && formatDate(generated);
  if (!origin || !date) return null;
  const derived = Array.isArray(source.derived) && source.derived.includes('test_result');
  return {
    line: `Herkunft: ${origin} · Datenstand: ${date}`,
    derivedNote: derived ? 'Prüfstatus aus Score abgeleitet' : null,
  };
}
