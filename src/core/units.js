// All data is stored in metric (°C, km/h, mm). Conversion happens only at
// the display edge, and user preferences are stored in metric too.

import { isNum, round } from './num.js';

export const SYSTEMS = {
  metric: { temp: '°C', wind: 'km/h', precip: 'mm', name: 'Metric' },
  imperial: { temp: '°F', wind: 'mph', precip: 'in', name: 'Imperial' },
};

export function tempTo(c, sys) {
  if (!isNum(c)) return null;
  return sys === 'imperial' ? (c * 9) / 5 + 32 : c;
}

export function tempFrom(value, sys) {
  if (!isNum(value)) return null;
  return sys === 'imperial' ? ((value - 32) * 5) / 9 : value;
}

/** A temperature difference converts by scale only, never by offset. */
export function tempDeltaTo(c, sys) {
  if (!isNum(c)) return null;
  return sys === 'imperial' ? c * 1.8 : c;
}

export function tempDeltaFrom(value, sys) {
  if (!isNum(value)) return null;
  return sys === 'imperial' ? value / 1.8 : value;
}

export function windTo(kmh, sys) {
  if (!isNum(kmh)) return null;
  return sys === 'imperial' ? kmh / 1.609344 : kmh;
}

export function windFrom(value, sys) {
  if (!isNum(value)) return null;
  return sys === 'imperial' ? value * 1.609344 : value;
}

export function precipTo(mm, sys) {
  if (!isNum(mm)) return null;
  return sys === 'imperial' ? mm / 25.4 : mm;
}

const DASH = '—';

export function fmtTemp(c, sys, digits = 0) {
  const v = tempTo(c, sys);
  return v === null ? DASH : `${round(v, digits)}°`;
}

export function fmtTempUnit(c, sys, digits = 0) {
  const v = tempTo(c, sys);
  return v === null ? DASH : `${round(v, digits)}${SYSTEMS[sys].temp}`;
}

export function fmtDelta(c, sys, digits = 1, signed = false) {
  const v = tempDeltaTo(c, sys);
  if (v === null) return DASH;
  const r = round(v, digits);
  const sign = signed && r > 0 ? '+' : '';
  return `${sign}${r}${SYSTEMS[sys].temp}`;
}

export function fmtWind(kmh, sys) {
  const v = windTo(kmh, sys);
  return v === null ? DASH : `${round(v, 0)} ${SYSTEMS[sys].wind}`;
}

export function fmtPrecip(mm, sys) {
  const v = precipTo(mm, sys);
  if (v === null) return DASH;
  return `${round(v, sys === 'imperial' ? 2 : 1)} ${SYSTEMS[sys].precip}`;
}

export function fmtPct(v) {
  return isNum(v) ? `${round(v, 0)}%` : DASH;
}

export function fmtUv(v) {
  return isNum(v) ? `${round(v, 1)}` : DASH;
}
