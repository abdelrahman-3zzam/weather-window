// Visual encoding: how a forecast moment becomes the lens's atmosphere.
//
// This is the single place where data is mapped to visuals, so the mapping
// can be tested and explained to the visitor word for word. The lens is an
// illustration of these values, not a simulation: every parameter below is a
// direct, monotonic function of one forecast quantity, and a missing value
// switches its effect off instead of inventing a default.

import { isNum } from './num.js';
import { describeCode } from './weathercodes.js';

// Temperature ramp shared by the lens, the day dial, the week signature and
// the strip: glacier blues through limestone to solar amber and oxide red.
export const TEMP_STOPS = [
  [-15, [52, 78, 128]],
  [-3, [104, 160, 190]],
  [7, [150, 196, 196]],
  [14, [200, 216, 196]],
  [20, [236, 214, 150]],
  [26, [240, 176, 84]],
  [32, [224, 112, 62]],
  [40, [168, 52, 60]],
];
const NEUTRAL = [128, 136, 134];

export function tempColor(c) {
  if (!isNum(c)) return [...NEUTRAL];
  if (c <= TEMP_STOPS[0][0]) return [...TEMP_STOPS[0][1]];
  for (let i = 1; i < TEMP_STOPS.length; i += 1) {
    const [t1, c1] = TEMP_STOPS[i];
    if (c <= t1) {
      const [t0, c0] = TEMP_STOPS[i - 1];
      const k = (c - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    }
  }
  return [...TEMP_STOPS[TEMP_STOPS.length - 1][1]];
}

export const rgbCss = (c, a = 1) => (a === 1 ? `rgb(${c[0]} ${c[1]} ${c[2]})` : `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`);

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Eight-point compass name for a meteorological direction (where wind comes from). */
export function compass(deg) {
  if (!isNum(deg)) return null;
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * The forecast moment the lens shows: one forecast hour, or the "current"
 * model block when the selected hour is the present one.
 */
export function momentFor(forecast, hourIndex, { useCurrent = false } = {}) {
  const hr = forecast.hours[hourIndex];
  if (!hr) return null;
  const day = forecast.days.find((d) => d.date === hr.date) || null;
  const c = forecast.current;
  const base = {
    t: hr.t, date: hr.date, hhmm: hr.hhmm, hour: hr.hour, hourIndex,
    temp: hr.temp, feels: hr.feels, rh: hr.rh, wind: hr.wind, windDir: hr.windDir ?? null,
    cloud: hr.cloud, pop: hr.pop, precip: hr.precip, uv: hr.uv, code: hr.code, isDay: hr.isDay,
    sunrise: day?.sunrise ?? null, sunset: day?.sunset ?? null, isCurrent: false,
  };
  if (useCurrent && c && isNum(c.t)) {
    // The current block is a 15-minute model estimate; it replaces the
    // quantities it provides. UV and precipitation chance come from the hour.
    for (const k of ['temp', 'feels', 'rh', 'wind', 'windDir', 'cloud', 'code', 'isDay']) {
      if (c[k] !== undefined && c[k] !== null) base[k] = c[k];
    }
    base.t = c.t;
    base.isCurrent = true;
  }
  return base;
}

/** Sun position along an illustrative arc between the real sunrise and sunset. */
export function sunPath(m, lat = 30) {
  if (!m || !isNum(m.sunrise) || !isNum(m.sunset) || !(m.sunset > m.sunrise)) return null;
  const f = (m.t - m.sunrise) / (m.sunset - m.sunrise);
  if (f <= 0 || f >= 1) return { frac: f, up: false, azimuth: null, elevation: 0 };
  const south = (isNum(lat) ? lat : 30) >= 0; // northern hemisphere: the sun crosses the south
  const azimuth = south ? 90 + 180 * f : 90 - 180 * f; // degrees clockwise from north
  const peak = Math.max(18, Math.min(80, 90 - Math.abs(isNum(lat) ? lat : 30) + 8));
  return { frac: f, up: true, azimuth: ((azimuth % 360) + 360) % 360, elevation: Math.sin(Math.PI * f) * peak };
}

/**
 * Map a moment to scene parameters and a plain-language legend.
 * `fmt` supplies unit-aware formatters: temp, wind, pct, uv, time.
 */
export function encodeMoment(m, { fmt, lat = 30 } = {}) {
  if (!m) return null;
  const group = describeCode(m.code).group;
  const sun = sunPath(m, lat);
  const night = m.isDay === 0 || (m.isDay === null && sun && !sun.up) ? 1 : 0;

  const windSpeed = isNum(m.wind) ? Math.sqrt(clamp01(m.wind / 50)) : null;
  let windDir = null;
  if (isNum(m.windDir)) {
    // Meteorological direction is where the wind comes FROM; the threads
    // drift the other way. Scene axes: +x east, -z north.
    const toward = ((m.windDir + 180) * Math.PI) / 180;
    windDir = [Math.sin(toward), -Math.cos(toward)];
  }
  const haze = isNum(m.cloud) ? clamp01(m.cloud / 100) : null;
  const precip = isNum(m.pop) ? clamp01(m.pop / 100) : null;
  const precipKind = group === 'snow' ? 'snow' : 'rain';
  const light = night ? 0 : isNum(m.uv) ? 0.12 + 0.88 * clamp01(m.uv / 10) : null;

  let sunDir = [0.35, 0.55, -0.75];
  if (sun && sun.up && isNum(sun.azimuth)) {
    const az = (sun.azimuth * Math.PI) / 180;
    const el = (Math.max(4, sun.elevation) * Math.PI) / 180;
    sunDir = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
  } else if (night) sunDir = [-0.4, 0.6, -0.7];

  const params = {
    tempColor: tempColor(m.temp),
    temp: isNum(m.temp) ? m.temp : null,
    wind: windSpeed ?? 0,
    windDir: windDir ?? [0, 0],
    haze: haze ?? 0,
    precip: precip ?? 0,
    snow: precipKind === 'snow' ? 1 : 0,
    light: light ?? (night ? 0 : 0.35),
    night,
    sunDir,
    storm: group === 'storm' ? 1 : 0,
  };

  const f = fmt || {};
  const legend = [
    {
      key: 'colour', visual: 'Colour of the strata',
      data: isNum(m.temp) ? `Air temperature ${f.temp ? f.temp(m.temp) : `${m.temp} °C`}` : 'Air temperature unavailable: drawn in neutral grey',
      note: 'Cold blues → limestone → solar amber → oxide red.',
    },
    {
      key: 'flow', visual: 'Air threads',
      data: isNum(m.wind)
        ? `Wind ${f.wind ? f.wind(m.wind) : `${m.wind} km/h`}${windDir ? ` from the ${compass(m.windDir)}` : ''}`
        : 'Wind unavailable: threads held still',
      note: windDir ? 'Thread speed follows wind speed; they drift the way the wind blows.' : 'Speed only: wind direction is not in this forecast copy.',
    },
    {
      key: 'haze', visual: 'Cloud veil',
      data: isNum(m.cloud) ? `Cloud cover ${f.pct ? f.pct(m.cloud) : `${m.cloud}%`}` : 'Cloud cover unavailable: no veil drawn',
      note: 'Denser veil, more of the sky covered. Not cloud height or type.',
    },
    {
      key: 'streaks', visual: precipKind === 'snow' ? 'Falling flakes' : 'Falling streaks',
      data: isNum(m.pop) ? `Precipitation chance ${f.pct ? f.pct(m.pop) : `${m.pop}%`}` : 'Precipitation chance unavailable: none drawn',
      note: 'More streaks, higher chance. A probability, not an amount or intensity.',
    },
    {
      key: 'light', visual: night ? 'Night ambience' : 'Strength of the light shaft',
      data: night ? 'After sunset: no sunlight, a cool ambient light' : isNum(m.uv) ? `UV index ${f.uv ? f.uv(m.uv) : m.uv}` : 'UV unavailable: a neutral daylight is used',
      note: sun && sun.up ? 'Light direction moves between the real sunrise and sunset; its height is approximate.' : 'Light direction is illustrative.',
    },
  ];
  return { params, legend, night, group };
}

/** Linear blend of two parameter sets, for transitions between moments. */
export function blendParams(a, b, k) {
  if (!a) return b;
  const mix = (x, y) => x + (y - x) * k;
  const out = {};
  for (const key of Object.keys(b)) {
    const x = a[key];
    const y = b[key];
    out[key] = Array.isArray(y) ? y.map((v, i) => mix(Array.isArray(x) ? x[i] : v, v)) : typeof y === 'number' ? mix(typeof x === 'number' ? x : y, y) : y;
  }
  return out;
}
