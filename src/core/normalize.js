// Turns a raw Open-Meteo response into Weather Window's forecast model.
// Structural problems throw; individual missing or implausible values become
// null and are counted in `quality`, so one bad hour never sinks a week.

import { numOrNull, isNum } from './num.js';
import { makeClock, localParts, isIsoDate, addDays } from './time.js';

export class ForecastError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'ForecastError';
    this.code = code;
  }
}

export const HOURLY_FIELDS = {
  temp: ['temperature_2m', -90, 65],
  feels: ['apparent_temperature', -100, 80],
  rh: ['relative_humidity_2m', 0, 100],
  uv: ['uv_index', 0, 25],
  pop: ['precipitation_probability', 0, 100],
  precip: ['precipitation', 0, 500],
  wind: ['wind_speed_10m', 0, 400],
  windDir: ['wind_direction_10m', 0, 360, 'optional'],
  code: ['weather_code', 0, 99],
  cloud: ['cloud_cover', 0, 100],
  isDay: ['is_day', 0, 1],
};

export const DAILY_FIELDS = {
  high: ['temperature_2m_max', -90, 65],
  low: ['temperature_2m_min', -90, 65],
  uvMax: ['uv_index_max', 0, 25],
  popMax: ['precipitation_probability_max', 0, 100],
  precipSum: ['precipitation_sum', 0, 2000],
  windMax: ['wind_speed_10m_max', 0, 400],
  code: ['weather_code', 0, 99],
  sunrise: ['sunrise', 0, 1e11],
  sunset: ['sunset', 0, 1e11],
};

export const CURRENT_FIELDS = {
  temp: ['temperature_2m', -90, 65],
  feels: ['apparent_temperature', -100, 80],
  rh: ['relative_humidity_2m', 0, 100],
  wind: ['wind_speed_10m', 0, 400],
  windDir: ['wind_direction_10m', 0, 360],
  code: ['weather_code', 0, 99],
  cloud: ['cloud_cover', 0, 100],
  isDay: ['is_day', 0, 1],
  precip: ['precipitation', 0, 500],
};

const EXPECTED_UNITS = [
  ['hourly_units', 'temperature_2m', '°C'],
  ['hourly_units', 'wind_speed_10m', 'km/h'],
  ['hourly_units', 'relative_humidity_2m', '%'],
  ['daily_units', 'temperature_2m_max', '°C'],
  ['daily_units', 'precipitation_sum', 'mm'],
];

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Optional fields (added after 2.0, e.g. wind direction) may be absent from
// older cached responses; their absence is not reported as a data problem.
function column(block, name, length, low, high, quality, key, optional = false) {
  const raw = block[name];
  if (!Array.isArray(raw) || raw.length !== length) {
    if (!optional) quality.missingFields.push(key);
    return new Array(length).fill(null);
  }
  return raw.map((v) => {
    const n = numOrNull(v, low, high);
    if (n === null) quality.missingValues[key] = (quality.missingValues[key] || 0) + 1;
    return n;
  });
}

export function normalizeForecast(raw, now = Date.now() / 1000) {
  if (!isObject(raw)) throw new ForecastError('The weather service returned an unreadable response.');
  if (raw.error) throw new ForecastError(String(raw.reason || 'The weather service reported an error.'), 'provider');
  if (!isObject(raw.hourly) || !isObject(raw.daily)) throw new ForecastError('The forecast is missing its hourly or daily section.');

  for (const [section, field, unit] of EXPECTED_UNITS) {
    const got = isObject(raw[section]) ? raw[section][field] : undefined;
    if (got !== undefined && got !== unit) {
      throw new ForecastError(`Unexpected unit for ${field}: ${got}.`);
    }
  }

  const times = raw.hourly.time;
  const dayTimes = raw.daily.time;
  if (!Array.isArray(times) || times.length < 24 || !times.every(isNum)) {
    throw new ForecastError('Hourly timestamps are missing. Check that timeformat=unixtime was requested.');
  }
  if (!Array.isArray(dayTimes) || dayTimes.length < 1 || !dayTimes.every(isNum)) {
    throw new ForecastError('Daily dates are missing.');
  }
  for (let i = 1; i < times.length; i += 1) {
    if (times[i] - times[i - 1] !== 3600) throw new ForecastError('Hourly timestamps are not evenly spaced.');
  }

  const clock = makeClock(raw.timezone, raw.utc_offset_seconds);
  const quality = { missingFields: [], missingValues: {} };

  const hourlyCols = {};
  for (const [key, [name, lo, hi, opt]] of Object.entries(HOURLY_FIELDS)) {
    hourlyCols[key] = column(raw.hourly, name, times.length, lo, hi, quality, `hourly.${key}`, opt === 'optional');
  }
  const dailyCols = {};
  for (const [key, [name, lo, hi]] of Object.entries(DAILY_FIELDS)) {
    dailyCols[key] = column(raw.daily, name, dayTimes.length, lo, hi, quality, `daily.${key}`);
  }

  // Daily boundaries: Open-Meteo returns local midnight using one fixed offset.
  // Reading the instant twelve hours later lands safely inside the intended
  // date even if a daylight-saving change shifted the real offset by an hour.
  const dates = dayTimes.map((t) => localParts(t + 43200, clock).date).slice(0, 7);
  dates.forEach((d, i) => {
    if (!isIsoDate(d)) throw new ForecastError('A forecast date is invalid.');
    if (i > 0 && d !== addDays(dates[i - 1], 1)) throw new ForecastError('Forecast dates are not consecutive.');
  });

  const hours = times.map((t, i) => {
    const p = localParts(t, clock);
    const row = { t, date: p.date, hour: p.hour, hhmm: p.hhmm, weekday: p.weekday };
    for (const key of Object.keys(HOURLY_FIELDS)) row[key] = hourlyCols[key][i];
    return row;
  });

  const days = dates.map((date, i) => {
    const day = { date, index: i };
    for (const key of Object.keys(DAILY_FIELDS)) day[key] = dailyCols[key][i];
    if (isNum(day.high) && isNum(day.low) && day.low > day.high) {
      day.low = null;
      day.high = null;
      quality.missingValues['daily.inconsistent'] = (quality.missingValues['daily.inconsistent'] || 0) + 1;
    }
    // Sunrise/sunset must fall within a day of the date; polar days have none.
    for (const k of ['sunrise', 'sunset']) {
      if (isNum(day[k]) && Math.abs(day[k] - (dayTimes[i] + 43200)) > 129600) day[k] = null;
    }
    const idx = [];
    hours.forEach((h, j) => { if (h.date === date) idx.push(j); });
    day.hourStart = idx.length ? idx[0] : -1;
    day.hourCount = idx.length;
    const rh = idx.map((j) => hours[j].rh).filter(isNum);
    // A daily mean humidity is only reported when most of the day is known.
    day.rhMean = idx.length && rh.length >= Math.ceil(idx.length * 0.75)
      ? rh.reduce((a, b) => a + b, 0) / rh.length
      : null;
    return day;
  });

  if (!days.some((d) => d.hourCount > 0)) throw new ForecastError('Hourly data does not match the forecast dates.');

  const current = { t: null };
  if (isObject(raw.current)) {
    current.t = numOrNull(raw.current.time, 0, 1e11);
    for (const [key, [name, lo, hi]] of Object.entries(CURRENT_FIELDS)) {
      current[key] = numOrNull(raw.current[name], lo, hi);
    }
  } else {
    quality.missingFields.push('current');
  }

  const firstHour = hours[days[0].hourStart] || hours[0];
  const lastHour = hours[hours.length - 1];

  return {
    clock,
    timezone: clock.label,
    timezoneAbbr: typeof raw.timezone_abbreviation === 'string' ? raw.timezone_abbreviation.slice(0, 8) : '',
    days,
    hours,
    current,
    span: { start: firstHour.t, end: lastHour.t + 3600 },
    quality,
    normalizedAt: now,
  };
}

export function qualityNote(quality) {
  const missing = Object.values(quality.missingValues).reduce((a, b) => a + b, 0);
  const fields = quality.missingFields.length;
  if (!missing && !fields) return null;
  const parts = [];
  if (fields) parts.push(`${fields} field${fields > 1 ? 's' : ''} unavailable`);
  if (missing) parts.push(`${missing} value${missing > 1 ? 's' : ''} missing or out of range`);
  return `${parts.join(', ')}. Affected cells show “—” and are excluded from calculations.`;
}
