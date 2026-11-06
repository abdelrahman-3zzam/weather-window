// Small scale helpers for the SVG charts.

export function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** Ticks covering [min, max] with round numbers; never a zero-height domain. */
export function niceDomain(min, max, count = 4) {
  let lo = min;
  let hi = max;
  if (!(Number.isFinite(lo) && Number.isFinite(hi))) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const step = niceStep(hi - lo, count);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks };
}

export function linear(d0, d1, r0, r1) {
  const k = (r1 - r0) / (d1 - d0 || 1);
  return (v) => r0 + (v - d0) * k;
}

/** SVG path through points, breaking wherever a value is missing. */
export function brokenLine(points) {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (p === null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Closed area segments under a broken line down to a baseline. */
export function brokenArea(points, base) {
  const segs = [];
  let cur = [];
  for (const p of points) {
    if (p === null) { if (cur.length) segs.push(cur); cur = []; continue; }
    cur.push(p);
  }
  if (cur.length) segs.push(cur);
  return segs.map((seg) => `M${seg[0][0].toFixed(1)},${base}${seg.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')}L${seg[seg.length - 1][0].toFixed(1)},${base}Z`).join('');
}
