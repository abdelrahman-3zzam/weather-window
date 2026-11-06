// Numeric guards shared by every module. A value is either a finite number
// or it is missing; nothing in Weather Window turns "missing" into zero.

export function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function inRange(value, low, high) {
  return isNum(value) && value >= low && value <= high;
}

/** Return the value if it is a finite number within bounds, otherwise null. */
export function numOrNull(value, low = -Infinity, high = Infinity) {
  return inRange(value, low, high) ? value : null;
}

export function round(value, digits = 0) {
  if (!isNum(value)) return null;
  const f = 10 ** digits;
  // Avoid -0 in the interface.
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}
