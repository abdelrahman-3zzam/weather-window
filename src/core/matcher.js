// Find Your Window: the matching engine.
//
// Rules (documented in DECISIONS.md):
// * Every check for an hour uses that same hour's values.
// * A missing value is never treated as zero. If another check already fails,
//   the hour fails; otherwise its status is "unknown" and it is not matched.
// * The local-time interval is [start, end): start 08, end 19 covers the
//   slots 08:00 … 18:00. If start > end the interval wraps past midnight.
// * Hour slots that have already started are never recommended.
// * Windows are runs of consecutive matching hours at least `minHours` long,
//   ranked by average comfort margin, then by length, then by start time.

import { isNum, inRange, clamp } from './num.js';

export const CONSTRAINTS = [
  { key: 'tempMin', field: 'temp', kind: 'min', label: 'Minimum temperature' },
  { key: 'tempMax', field: 'temp', kind: 'max', label: 'Maximum temperature' },
  { key: 'rh', field: 'rh', kind: 'max', label: 'Maximum humidity' },
  { key: 'wind', field: 'wind', kind: 'max', label: 'Maximum wind speed' },
  { key: 'pop', field: 'pop', kind: 'max', label: 'Maximum precipitation probability' },
  { key: 'uv', field: 'uv', kind: 'max', label: 'Maximum UV index' },
];

// Metric bounds for validation. Temperature in °C, wind in km/h.
export const PREF_BOUNDS = {
  tempMin: [-40, 50],
  tempMax: [-40, 50],
  rh: [0, 100],
  wind: [0, 150],
  pop: [0, 100],
  uv: [0, 15],
  startHour: [0, 23],
  endHour: [1, 24],
  minHours: [1, 8],
};

export const PROFILES = {
  walk: { name: 'Evening walk', note: 'Mild, dry, not too windy.', prefs: { tempMin: 16, tempMax: 28, rh: 75, wind: 25, pop: 30, uv: 5, startHour: 6, endHour: 22, minHours: 1 } },
  cycle: { name: 'Bike ride', note: 'Calmer winds and a longer dry stretch.', prefs: { tempMin: 12, tempMax: 27, rh: 80, wind: 18, pop: 20, uv: 6, startHour: 6, endHour: 20, minHours: 2 } },
  study: { name: 'Study outdoors', note: 'Comfortable, low UV, little chance of rain.', prefs: { tempMin: 18, tempMax: 27, rh: 70, wind: 15, pop: 15, uv: 3, startHour: 8, endHour: 19, minHours: 2 } },
  run: { name: 'Run', note: 'Cooler hours preferred.', prefs: { tempMin: 6, tempMax: 22, rh: 75, wind: 25, pop: 30, uv: 4, startHour: 5, endHour: 22, minHours: 1 } },
};

export const DEFAULT_PREFS = { ...PROFILES.walk.prefs };

/** Validate preferences. Returns { ok, errors: [{ key, message }], prefs }. */
export function validatePrefs(input) {
  const errors = [];
  const prefs = {};
  for (const [key, [lo, hi]] of Object.entries(PREF_BOUNDS)) {
    const v = input ? input[key] : undefined;
    if (!inRange(v, lo, hi)) {
      errors.push({ key, message: `Choose a value between ${lo} and ${hi}.` });
    } else {
      prefs[key] = v;
    }
  }
  for (const key of ['startHour', 'endHour', 'minHours']) {
    if (key in prefs && !Number.isInteger(prefs[key])) errors.push({ key, message: 'Use whole hours.' });
  }
  if ('tempMin' in prefs && 'tempMax' in prefs && prefs.tempMin > prefs.tempMax) {
    errors.push({ key: 'tempMin', message: 'Minimum temperature is above the maximum.' });
  }
  if ('startHour' in prefs && 'endHour' in prefs && prefs.startHour === prefs.endHour % 24) {
    if (!(prefs.startHour === 0 && prefs.endHour === 24)) {
      errors.push({ key: 'endHour', message: 'Start and end are the same time. Use 00–24 for the whole day.' });
    }
  }
  if ('minHours' in prefs && 'startHour' in prefs && 'endHour' in prefs && errors.length === 0) {
    if (prefs.minHours > intervalLength(prefs)) {
      errors.push({ key: 'minHours', message: 'The minimum duration is longer than your time interval.' });
    }
  }
  return { ok: errors.length === 0, errors, prefs };
}

export function intervalLength({ startHour, endHour }) {
  if (startHour === 0 && endHour === 24) return 24;
  return startHour < endHour ? endHour - startHour : 24 - startHour + (endHour % 24);
}

export function isOvernight({ startHour, endHour }) {
  return startHour > endHour % 24 && !(startHour === 0 && endHour === 24);
}

export function inInterval(hour, { startHour, endHour }) {
  if (startHour === 0 && endHour === 24) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour % 24;
}

/**
 * How comfortably a value sits inside one limit, from 0 (on the limit) to 1.
 * Max limits are scaled by the limit itself; temperature by half the band.
 */
function headroom(c, value, prefs) {
  if (c.field === 'temp') {
    const half = (prefs.tempMax - prefs.tempMin) / 2;
    if (half <= 0) return 1;
    const mid = (prefs.tempMax + prefs.tempMin) / 2;
    return clamp(1 - Math.abs(value - mid) / half, 0, 1);
  }
  const limit = prefs[c.key];
  if (limit <= 0) return 1;
  return clamp((limit - value) / limit, 0, 1);
}

function passes(c, value, prefs) {
  return c.kind === 'min' ? value >= prefs[c.key] : value <= prefs[c.key];
}

/**
 * Evaluate one hour. status: past | outside | match | miss | unknown.
 * `ignore` lets the relaxation helper drop one constraint.
 */
export function evaluateHour(hour, prefs, now, ignore = null) {
  const checks = [];
  let failed = 0;
  let missing = 0;
  for (const c of CONSTRAINTS) {
    if (c.key === ignore) continue;
    const value = hour[c.field];
    if (!isNum(value)) {
      missing += 1;
      checks.push({ key: c.key, field: c.field, value: null, limit: prefs[c.key], pass: null });
      continue;
    }
    const ok = passes(c, value, prefs);
    if (!ok) failed += 1;
    checks.push({ key: c.key, field: c.field, value, limit: prefs[c.key], pass: ok, headroom: ok ? headroom(c, value, prefs) : 0 });
  }
  let status;
  if (hour.t < now) status = 'past';
  else if (!inInterval(hour.hour, prefs)) status = 'outside';
  else if (failed > 0) status = 'miss';
  else if (missing > 0) status = 'unknown';
  else status = 'match';

  let score = null;
  if (status === 'match') {
    // Temperature counts once, using its two-sided headroom.
    const parts = checks.filter((c) => c.key !== 'tempMin');
    score = parts.reduce((a, c) => a + c.headroom, 0) / parts.length;
  }
  return { status, checks, failed, missing, score };
}

export function evaluateAll(hours, prefs, now, ignore = null) {
  return hours.map((h) => ({ hour: h, ...evaluateHour(h, prefs, now, ignore) }));
}

/** Group consecutive matching hours into candidate windows. */
export function buildWindows(evals, minHours) {
  const runs = [];
  let run = [];
  const flush = () => {
    if (run.length) runs.push(run);
    run = [];
  };
  for (const e of evals) {
    const last = run[run.length - 1];
    if (e.status === 'match' && (!last || e.hour.t - last.hour.t === 3600)) run.push(e);
    else if (e.status === 'match') { flush(); run.push(e); }
    else flush();
  }
  flush();

  return runs
    .filter((r) => r.length >= minHours)
    .map((r) => {
      const scores = r.map((e) => e.score);
      // Weakest constraint across the window: the one with the least headroom.
      let tight = null;
      for (const e of r) {
        for (const c of e.checks) {
          if (c.key === 'tempMin' || c.headroom === undefined) continue;
          if (!tight || c.headroom < tight.headroom) tight = { key: c.key, headroom: c.headroom, value: c.value, t: e.hour.t };
        }
      }
      return {
        id: `w${r[0].hour.t}`,
        start: r[0].hour.t,
        end: r[r.length - 1].hour.t + 3600,
        date: r[0].hour.date,
        startLabel: r[0].hour.hhmm,
        endHour: r[r.length - 1].hour,
        length: r.length,
        hours: r,
        score: scores.reduce((a, b) => a + b, 0) / scores.length,
        minScore: Math.min(...scores),
        tight,
      };
    })
    .sort((a, b) => b.score - a.score || b.length - a.length || a.start - b.start);
}

export function findWindows(hours, prefs, now) {
  const evals = evaluateAll(hours, prefs, now);
  const windows = buildWindows(evals, prefs.minHours);
  const counts = { match: 0, miss: 0, unknown: 0, past: 0, outside: 0 };
  for (const e of evals) counts[e.status] += 1;
  return { evals, windows, counts };
}

/**
 * For each constraint, the smallest change that would produce at least one
 * qualifying window, holding every other preference fixed. Returns an array
 * sorted by how small the change is relative to the slider range.
 */
export function suggestRelaxations(hours, prefs, now) {
  const out = [];
  for (const c of CONSTRAINTS) {
    const evals = evaluateAll(hours, prefs, now, c.key);
    // Candidate runs where every other constraint passes and this field is known.
    let best = null;
    let run = [];
    const consider = () => {
      for (let i = 0; i + prefs.minHours <= run.length; i += 1) {
        const slice = run.slice(i, i + prefs.minHours);
        const values = slice.map((e) => e.hour[c.field]);
        const needed = c.kind === 'min' ? Math.min(...values) : Math.max(...values);
        const better = !best || (c.kind === 'min' ? needed > best.value : needed < best.value);
        if (better) best = { value: needed, start: slice[0].hour.t };
      }
    };
    for (const e of evals) {
      const last = run[run.length - 1];
      const usable = e.status === 'match' && isNum(e.hour[c.field]);
      if (usable && (!last || e.hour.t - last.hour.t === 3600)) run.push(e);
      else { consider(); run = usable ? [e] : []; }
    }
    consider();
    if (!best) continue;
    const [lo, hi] = PREF_BOUNDS[c.key];
    const value = c.kind === 'min' ? Math.floor(best.value * 2) / 2 : Math.ceil(best.value * 2) / 2;
    if (value < lo || value > hi) continue;
    const change = Math.abs(value - prefs[c.key]);
    if (change === 0) continue;
    out.push({ key: c.key, label: c.label, from: prefs[c.key], to: value, change, relative: change / (hi - lo), start: best.start });
  }
  return out.sort((a, b) => a.relative - b.relative);
}

/** Why hours inside the interval failed: count of failures per constraint. */
export function failureBreakdown(evals) {
  const counts = Object.fromEntries(CONSTRAINTS.map((c) => [c.key, 0]));
  let considered = 0;
  for (const e of evals) {
    if (e.status !== 'miss' && e.status !== 'unknown' && e.status !== 'match') continue;
    considered += 1;
    for (const c of e.checks) if (c.pass === false) counts[c.key] += 1;
  }
  return { considered, counts };
}
