// Time handling. Forecasts are requested with timeformat=unixtime so every
// timestamp is an absolute instant; local dates and hours are derived with
// the location's IANA timezone. This keeps daylight-saving transitions
// correct (Open-Meteo's own ISO local times use one fixed offset).

const cache = new Map();

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function partsFormatter(tz) {
  const key = `p|${tz}`;
  if (!cache.has(key)) {
    cache.set(key, new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      weekday: 'short',
    }));
  }
  return cache.get(key);
}

/**
 * A clock describes how to read instants for one location.
 * zone: IANA name when valid; offset: fallback fixed offset in seconds.
 */
export function makeClock(zone, offsetSeconds = 0) {
  const tz = isValidTimeZone(zone) ? zone : null;
  const offset = Number.isFinite(offsetSeconds) ? offsetSeconds : 0;
  return { tz, offset, label: tz || `UTC${offset >= 0 ? '+' : '−'}${Math.abs(offset / 3600)}` };
}

/** Local calendar parts of a unix instant (seconds). */
export function localParts(unix, clock) {
  const fmt = partsFormatter(clock.tz || 'UTC');
  const ms = clock.tz ? unix * 1000 : (unix + clock.offset) * 1000;
  const out = {};
  for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  const hour = Number(out.hour) % 24;
  return {
    date: `${out.year}-${out.month}-${out.day}`,
    hour,
    minute: Number(out.minute),
    weekday: out.weekday,
    hhmm: `${String(hour).padStart(2, '0')}:${out.minute}`,
  };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar helpers for YYYY-MM-DD strings (no timezone involved). */
export function isIsoDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

function utcDate(text) {
  return new Date(`${text}T12:00:00Z`);
}

export function weekdayShort(text) {
  return WEEKDAYS[utcDate(text).getUTCDay()];
}

export function weekdayLong(text) {
  return WEEKDAYS_LONG[utcDate(text).getUTCDay()];
}

export function dayMonth(text) {
  const d = utcDate(text);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function addDays(text, n) {
  const d = utcDate(text);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export function hourLabel(h) {
  return `${String(h % 24).padStart(2, '0')}:00`;
}
