// What-if Lab: pure scenario operations. A scenario is a week of daily
// maximum and minimum temperatures. Operations return new scenarios; nothing
// here touches forecast data, and nothing here changes humidity, wind,
// precipitation or UV — the lab models temperature only.

import { isNum, round } from './num.js';
import { summarize, countWithin } from './stats.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Every synthetic preset has the same mean daily maximum: 25 °C.
export const PRESETS = {
  steady: { name: 'Steady', note: 'Small ups and downs.', highs: [24, 25, 24, 25, 24, 25, 28], spread: [7, 7, 8, 6, 7, 7, 8] },
  seesaw: { name: 'Seesaw', note: 'Alternating warm and cool days.', highs: [19, 31, 20, 30, 21, 29, 25], spread: [6, 9, 6, 9, 6, 9, 7] },
  spike: { name: 'Heat spike', note: 'Mild all week, then one hot day.', highs: [22, 22, 23, 22, 23, 22, 41], spread: [7, 7, 7, 7, 7, 7, 13] },
  snap: { name: 'Cold snap', note: 'A cold front mid-week.', highs: [28, 28, 27, 16, 17, 26, 33], spread: [8, 8, 9, 5, 6, 8, 10] },
  flat: { name: 'Perfectly flat', note: 'Every day the same.', highs: [25, 25, 25, 25, 25, 25, 25], spread: [7, 7, 7, 7, 7, 7, 7] },
};

export const LIMITS = { min: -30, max: 50 };

export function fromPreset(key) {
  const p = PRESETS[key];
  return {
    source: 'synthetic',
    presetKey: key,
    label: `${p.name} (synthetic)`,
    days: [...DAYS],
    highs: [...p.highs],
    lows: p.highs.map((h, i) => h - p.spread[i]),
    shift: 0,
  };
}

/**
 * A hypothetical copy of a real forecast. The copy is labelled as such and
 * edits never flow back into the forecast itself.
 */
export function fromForecast(days, placeName) {
  if (!Array.isArray(days) || days.length !== 7) return null;
  if (!days.every((d) => isNum(d.high) && isNum(d.low))) return null;
  return {
    source: 'forecast-copy',
    presetKey: null,
    label: `Copy of ${placeName} forecast (hypothetical once edited)`,
    days: days.map((d) => d.weekday || d.date),
    highs: days.map((d) => d.high),
    lows: days.map((d) => d.low),
    shift: 0,
  };
}

function clampTemp(v) {
  return Math.min(LIMITS.max, Math.max(LIMITS.min, v));
}

/** Uniform shift: every high and low moves by the same amount. */
export function shiftAll(s, delta) {
  return { ...s, highs: s.highs.map((h) => h + delta), lows: s.lows.map((l) => l + delta), shift: s.shift + delta, edited: true };
}

/**
 * Move one day's maximum to `value`. The day's minimum moves with it so its
 * daily range is preserved. With keepMean, the opposite change is shared
 * equally by the other days, so the weekly mean of maxima stays exactly put.
 */
export function setDay(s, index, value, keepMean = false) {
  const target = clampTemp(value);
  const delta = target - s.highs[index];
  if (delta === 0) return s;
  const highs = [...s.highs];
  const lows = [...s.lows];
  highs[index] = target;
  lows[index] += delta;
  if (keepMean && highs.length > 1) {
    const share = delta / (highs.length - 1);
    for (let i = 0; i < highs.length; i += 1) {
      if (i === index) continue;
      highs[i] -= share;
      lows[i] -= share;
    }
  }
  return { ...s, highs, lows, edited: true };
}

/** Make the week perfectly flat at its own mean (keeps the mean). */
export function flatten(s) {
  const st = summarize(s.highs);
  return { ...s, highs: s.highs.map(() => st.mean), lows: s.lows.map((l, i) => st.mean - (s.highs[i] - l)), edited: true };
}

/** Stretch distances from the mean by a factor (keeps the mean). */
export function stretch(s, factor) {
  const m = summarize(s.highs).mean;
  const highs = s.highs.map((h) => clampTemp(m + (h - m) * factor));
  return { ...s, highs, lows: s.lows.map((l, i) => l + (highs[i] - s.highs[i])), edited: true };
}

export function labStats(s, band) {
  const st = summarize(s.highs);
  return {
    ...st,
    meanLow: summarize(s.lows).mean,
    inBand: band ? countWithin(s.highs, band[0], band[1]) : null,
  };
}

/** Compare two stats objects field by field: "same" within 0.05 °C. */
export function compareStats(a, b) {
  const keys = ['mean', 'range', 'sd', 'maxStep', 'inBand'];
  return Object.fromEntries(keys.map((k) => {
    if (!isNum(a[k]) || !isNum(b[k])) return [k, null];
    return [k, Math.abs(a[k] - b[k]) < 0.05 ? 'same' : 'different'];
  }));
}

export function rounded(s) {
  return { ...s, highs: s.highs.map((h) => round(h, 1)), lows: s.lows.map((l) => round(l, 1)) };
}
