// CSV export with explicit column meanings and units. Text cells that a
// spreadsheet could execute as a formula are neutralised.

import { isNum, round } from './num.js';

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (isNum(value)) return String(value);
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function n(v, d = 1) {
  return isNum(v) ? round(v, d) : null;
}

/** Build a CSV in metric units with a provenance header. */
export function forecastCsv({ forecast, place, provenance, fetchedIso }) {
  const meta = [
    ['# Weather Window export'],
    ['# Location', place],
    ['# Data status', provenance],
    ['# Retrieved (UTC)', fetchedIso || 'n/a (synthetic)'],
    ['# Timezone', forecast.timezone],
    ['# Source', 'Open-Meteo forecast API (CC BY 4.0), https://open-meteo.com/'],
    ['# Notes', 'Empty cells are missing values. Daily maxima/minima occur at a single moment, not all day. Precipitation probability is the chance of >0.1 mm in an hour, not an amount.'],
    [],
  ];
  const daily = [
    ['section', 'local_date', 'temp_max_C', 'temp_min_C', 'precip_probability_max_pct', 'precip_sum_mm', 'wind_speed_10m_max_kmh', 'uv_index_max', 'mean_relative_humidity_pct', 'weather_code'],
    ...forecast.days.map((d) => ['daily', d.date, n(d.high), n(d.low), n(d.popMax, 0), n(d.precipSum), n(d.windMax), n(d.uvMax), n(d.rhMean), d.code]),
    [],
  ];
  const hourly = [
    ['section', 'local_date', 'local_time', 'unix_utc', 'temp_C', 'apparent_temp_C', 'relative_humidity_pct', 'precip_probability_pct', 'precip_mm', 'wind_speed_10m_kmh', 'uv_index', 'cloud_cover_pct', 'weather_code'],
    ...forecast.hours.map((h) => ['hourly', h.date, h.hhmm, h.t, n(h.temp), n(h.feels), n(h.rh, 0), n(h.pop, 0), n(h.precip), n(h.wind), n(h.uv), n(h.cloud, 0), h.code]),
  ];
  return toCsv([...meta, ...daily, ...hourly]);
}
