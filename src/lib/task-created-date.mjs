// Display/filter the recorded calendar fields. Historical task timestamps mix
// naive UTC and host-local values; do not infer a timezone or change their day.
const STAMP = /^([0-9]{4}-[0-9]{2}-[0-9]{2})(?:[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,9}))?)?(Z|[+-][0-9]{2}:[0-9]{2})?)?$/;

export function isTaskCalendarDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function taskCreatedDate(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim(), match = STAMP.exec(raw);
  if (!match || !isTaskCalendarDate(match[1])) return null;
  if (match[2] !== undefined && (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59)) return null;
  const zone = match[6];
  if (zone && zone !== 'Z' && (Number(zone.slice(1,3)) > 23 || Number(zone.slice(4)) > 59)) return null;
  const [year, month, day] = match[1].split('-');
  const label = day + '.' + month + '.' + year + (match[2] === undefined ? '' : ', ' + match[2] + ':' + match[3]);
  return {raw, label};
}
