// Descriptive statistics for small series (a week of daily values).
// Every function returns null when it cannot give a meaningful answer,
// so callers must decide what to show instead of displaying a fake number.

import { isNum } from './num.js';

function clean(values) {
  return Array.isArray(values) && values.length > 0 && values.every(isNum) ? values : null;
}

export function mean(values) {
  const v = clean(values);
  if (!v) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export function min(values) {
  const v = clean(values);
  return v ? Math.min(...v) : null;
}

export function max(values) {
  const v = clean(values);
  return v ? Math.max(...v) : null;
}

export function range(values) {
  const v = clean(values);
  return v ? Math.max(...v) - Math.min(...v) : null;
}

/**
 * Population standard deviation: the typical distance of a day from the
 * week's mean. We describe these exact days rather than estimate a wider
 * population, so we divide by n (not n - 1).
 */
export function stdDev(values) {
  const v = clean(values);
  if (!v) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((acc, x) => acc + (x - m) ** 2, 0) / v.length);
}

/** Largest absolute change between consecutive entries, with its position. */
export function maxStep(values) {
  const v = clean(values);
  if (!v || v.length < 2) return null;
  let best = { size: -1, from: 0, to: 1, delta: 0 };
  for (let i = 1; i < v.length; i += 1) {
    const delta = v[i] - v[i - 1];
    if (Math.abs(delta) > best.size) best = { size: Math.abs(delta), from: i - 1, to: i, delta };
  }
  return best;
}

export function countWithin(values, low, high) {
  const v = clean(values);
  if (!v || !isNum(low) || !isNum(high) || low > high) return null;
  return v.filter((x) => x >= low && x <= high).length;
}

/** Index of the largest / smallest value (first occurrence). */
export function argMax(values) {
  let best = -1;
  values.forEach((x, i) => {
    if (isNum(x) && (best < 0 || x > values[best])) best = i;
  });
  return best < 0 ? null : best;
}

export function argMin(values) {
  let best = -1;
  values.forEach((x, i) => {
    if (isNum(x) && (best < 0 || x < values[best])) best = i;
  });
  return best < 0 ? null : best;
}

/** Summary used by the lab and the overview, all on the same definitions. */
export function summarize(values) {
  const step = maxStep(values);
  return {
    n: Array.isArray(values) ? values.length : 0,
    mean: mean(values),
    min: min(values),
    max: max(values),
    range: range(values),
    sd: stdDev(values),
    maxStep: step ? step.size : null,
    maxStepAt: step,
  };
}
