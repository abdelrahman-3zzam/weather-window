// The week's signature: Weather Window's answer to "does the average tell
// the whole story?", drawn as the brand mark itself.
//
// The circle is the average of every hourly temperature in the week. Each
// closed line is one day on a 24-hour clock (00:00 at the top, clockwise):
// outside the circle is warmer than that average, inside is cooler. A
// perfectly average week would be seven lines lying on the circle.
//
// The same geometry draws the interactive SVG, the small day glyphs in the
// week strip, the lab's "same circle, different shapes" view, and the
// downloadable PNG card (via Path2D, so the card matches the screen).

import { s, h, replace } from './dom.js';
import { isNum, round } from '../core/num.js';
import { tempColor, rgbCss } from '../core/encoding.js';
import { tempTo, tempDeltaTo, SYSTEMS } from '../core/units.js';
import { weekdayShort, dayMonth } from '../core/time.js';

const f1 = (v) => v.toFixed(2);

function polar(deg, r) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/**
 * Closed contour through values spaced evenly around the clock. Missing
 * values break the line (an open path), never fall to the mean or zero.
 */
export function contourPath(values, mean, r0, k, { minR = 4, smooth = true } = {}) {
  const n = values.length;
  const pts = values.map((v, i) => (isNum(v) ? polar((i / n) * 360, Math.max(minR, r0 + (v - mean) * k)) : null));
  const complete = pts.every(Boolean);
  if (complete && smooth && n >= 4) {
    // Closed Catmull-Rom spline converted to cubic Béziers.
    let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
    for (let i = 0; i < n; i += 1) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(p2[0])},${f1(p2[1])}`;
    }
    return `${d}Z`;
  }
  let d = '';
  let pen = false;
  pts.forEach((p) => {
    if (!p) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${f1(p[0])},${f1(p[1])}`;
    pen = true;
  });
  if (complete) d += 'Z';
  return d;
}

/** Shared geometry for a forecast week. */
export function weekGeometry(forecast, { r0 = 70, maxDev = 44 } = {}) {
  const all = forecast.hours.map((x) => x.temp).filter(isNum);
  if (all.length < 24) return null;
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const dev = Math.max(1, ...all.map((v) => Math.abs(v - mean)));
  const k = Math.min(6, maxDev / dev);
  const days = forecast.days.map((d, i) => {
    const hrs = d.hourStart >= 0 ? forecast.hours.slice(d.hourStart, d.hourStart + d.hourCount) : [];
    const temps = hrs.map((x) => x.temp);
    const known = temps.filter(isNum);
    const dayMean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
    return { i, date: d.date, temps, dayMean, path: hrs.length >= 4 ? contourPath(temps, mean, r0, k) : '' };
  });
  return { mean, k, r0, dev, days };
}

/** A nice round degree step for the reference rings, in display units. */
function ringStep(devDisplay) {
  return devDisplay > 14 ? 10 : devDisplay > 7 ? 5 : devDisplay > 3 ? 2 : 1;
}

export function createSignature(host, keysHost, { onSelectDay }) {
  const figure = h('figure', { class: 'signature-figure' });
  const svgHost = h('div', { class: 'signature-svg' });
  const keys = h('div', { class: 'signature-keys', role: 'group', 'aria-label': 'Highlight a day' });
  const caption = h('figcaption', { class: 'signature-caption' });
  figure.append(svgHost);
  host.append(figure);
  keysHost.append(keys, caption);
  let st = null;

  function render() {
    const { forecast, units, day } = st;
    const g = weekGeometry(forecast);
    if (!g) {
      replace(svgHost, h('p', { class: 'muted' }, 'Not enough hourly temperatures to draw this week’s signature.'));
      replace(keys);
      caption.textContent = '';
      return;
    }
    const sys = SYSTEMS[units];
    const devD = tempDeltaTo(g.dev, units);
    const step = ringStep(devD);
    const kids = [];
    for (const a of [0, 90, 180, 270]) {
      const [x0, y0] = polar(a, 18);
      const [x1, y1] = polar(a, 122);
      kids.push(s('line', { class: 'sig-spoke', x1: f1(x0), y1: f1(y0), x2: f1(x1), y2: f1(y1) }));
      const [lx, ly] = polar(a, 129);
      kids.push(s('text', { class: 'sig-hour', x: f1(lx), y: f1(ly + 2.5), 'text-anchor': 'middle', text: ['00', '06', '12', '18'][a / 90] }));
    }
    // Reference rings at ±step in display units, so the scale stays honest.
    const kDisplay = g.k / tempDeltaTo(1, units);
    for (const m of [-2, -1, 1, 2]) {
      const r = g.r0 + m * step * kDisplay;
      if (r < 10 || r > 120) continue;
      kids.push(s('circle', { class: 'sig-ring', r: f1(r) }));
      kids.push(s('text', { class: 'sig-ring-label', x: 2, y: f1(-r - 1.5), text: `${m > 0 ? '+' : '−'}${Math.abs(m * step)}°` }));
    }
    kids.push(s('circle', { class: 'sig-mean', r: g.r0 }));
    kids.push(s('text', { class: 'sig-mean-label', x: 0, y: -2, 'text-anchor': 'middle', text: 'average' }));
    kids.push(s('text', { class: 'sig-mean-value', x: 0, y: 9, 'text-anchor': 'middle', text: `${round(tempTo(g.mean, units))}${sys.temp}` }));
    const order = g.days.filter((d) => d.i !== day).concat(g.days.filter((d) => d.i === day));
    for (const d of order) {
      if (!d.path) continue;
      kids.push(s('path', {
        class: `sig-day${d.i === day ? ' on' : ''}`, d: d.path, stroke: rgbCss(tempColor(d.dayMean)),
        'data-day': d.i, onclick: () => onSelectDay(d.i),
      }, s('title', { text: `${weekdayShort(d.date)} ${dayMonth(d.date)}` })));
    }
    replace(svgHost, s('svg', {
      viewBox: '-140 -140 280 280', class: 'signature', role: 'img',
      'aria-label': signatureSummary(g, forecast, units),
    }, ...kids));

    replace(keys, ...g.days.map((d) => h('button', {
      type: 'button', class: `sig-key${d.i === day ? ' on' : ''}`, 'aria-pressed': String(d.i === day),
      onclick: () => onSelectDay(d.i), style: { '--key': rgbCss(tempColor(d.dayMean)) },
    }, h('span', { class: 'sig-swatch', 'aria-hidden': 'true' }), weekdayShort(d.date))));

    caption.textContent = `The circle is the average of all ${forecast.hours.filter((x) => isNum(x.temp)).length} hourly temperatures (${round(tempTo(g.mean, units), 1)}${sys.temp}). Each line is one day, hour by hour: outside the circle is warmer than that average, inside is cooler. Rings mark ±${step}° and ±${step * 2}°.`;
  }

  return {
    update(state) {
      st = state;
      render();
    },
  };
}

function signatureSummary(g, forecast, units) {
  const sys = SYSTEMS[units];
  const parts = g.days.filter((d) => isNum(d.dayMean)).map((d) => {
    const diff = tempDeltaTo(d.dayMean - g.mean, units);
    return `${weekdayShort(d.date)} ${diff >= 0 ? '+' : '−'}${Math.abs(round(diff, 1))}°`;
  });
  return `Week signature. Hourly average ${round(tempTo(g.mean, units), 1)} ${sys.temp}. Day means relative to it: ${parts.join(', ')}.`;
}

/** Small glyph for a day button: the week's average circle and one day's line. */
export function dayGlyph(g, i, size = 34) {
  if (!g || !g.days[i]?.path) return s('svg', { class: 'day-glyph empty', viewBox: '-140 -140 280 280', width: size, height: size, 'aria-hidden': 'true' });
  return s('svg', { class: 'day-glyph', viewBox: '-128 -128 256 256', width: size, height: size, 'aria-hidden': 'true' },
    s('circle', { class: 'glyph-mean', r: g.r0 }),
    s('path', { class: 'glyph-day', d: g.days[i].path, stroke: rgbCss(tempColor(g.days[i].dayMean)) }));
}

/**
 * Lab view: two weeks of daily maxima on a 7-point clock around their means.
 * When the means match, both shapes share one circle.
 */
export function labShapes(a, b, { size = 260, units = 'metric', ghost = null } = {}) {
  const all = [...a.highs, ...b.highs];
  const meanA = a.highs.reduce((x, y) => x + y, 0) / a.highs.length;
  const meanB = b.highs.reduce((x, y) => x + y, 0) / b.highs.length;
  const center = (meanA + meanB) / 2;
  const dev = Math.max(1, ...all.map((v) => Math.abs(v - center)), Math.abs(meanA - center) + 1);
  const k = Math.min(7, 46 / dev);
  const k0 = k;
  const r0 = 62;
  const kids = [];
  for (let i = 0; i < 7; i += 1) {
    const [x, y] = polar((i / 7) * 360, 118);
    const [sx, sy] = polar((i / 7) * 360, 112);
    kids.push(s('line', { class: 'sig-spoke', x1: 0, y1: 0, x2: f1(sx), y2: f1(sy) }));
    kids.push(s('text', { class: 'sig-hour', x: f1(x), y: f1(y + 3), 'text-anchor': 'middle', text: (a.days[i] || '').slice(0, 3) }));
  }
  const same = Math.abs(meanA - meanB) < 0.05;
  const rA = r0 + (meanA - center) * k;
  const rB = r0 + (meanB - center) * k;
  kids.push(s('circle', { class: `sig-mean lane-a${same ? ' shared' : ''}`, r: f1(rA) }));
  if (!same) kids.push(s('circle', { class: 'sig-mean lane-b', r: f1(rB) }));
  for (const [k, g] of Object.entries(ghost || {})) {
    if (g && g.highs.length === a.highs.length) kids.push(s('path', { class: `lab-shape-ghost lane-${k}`, d: contourPath(g.highs, center, r0, k0, { smooth: false }) }));
  }
  kids.push(s('path', { class: 'lab-shape lane-a', d: contourPath(a.highs, center, r0, k, { smooth: false }) }));
  kids.push(s('path', { class: 'lab-shape lane-b', d: contourPath(b.highs, center, r0, k, { smooth: false }) }));
  const t = (v) => `${round(tempTo(v, units), 1)}°`;
  return s('svg', {
    viewBox: '-132 -132 264 264', width: size, height: size, class: 'lab-shapes', role: 'img',
    'aria-label': same
      ? `Both weeks share one average circle at ${t(meanA)}, but their shapes differ.`
      : `Week A averages ${t(meanA)} and Week B ${t(meanB)}; each shape is drawn around its own circle.`,
  }, ...kids);
}

// ---------- The shareable card ----------

/** Render the signature card to a PNG blob. */
export async function signatureCard({ forecast, units, placeLabel, provenance, dateRange }) {
  const g = weekGeometry(forecast);
  if (!g) throw new Error('not enough data');
  try {
    await Promise.all([
      document.fonts?.load('500 64px "Newsreader WW"'),
      document.fonts?.load('italic 300 64px "Newsreader WW"'),
      document.fonts?.load('500 20px "Martian WW"'),
      document.fonts?.load('500 24px "Hanken WW"'),
    ]);
  } catch { /* fall back to system fonts */ }
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  const ink = '#0c1416';
  const paper = '#e9e5da';
  const mutedC = '#8e9a95';
  const solar = '#f0b44c';
  x.fillStyle = ink;
  x.fillRect(0, 0, W, H);

  // Fine contour texture in the background, the brand's paper.
  x.strokeStyle = 'rgba(233,229,218,0.045)';
  x.lineWidth = 1;
  for (let r = 60; r < 900; r += 26) {
    x.beginPath();
    x.ellipse(W * 0.78, H * 0.18, r * 1.2, r, 0.4, 0, Math.PI * 2);
    x.stroke();
  }

  // Header: mark + wordmark.
  x.save();
  x.translate(84, 104);
  x.strokeStyle = paper;
  x.lineWidth = 3;
  x.beginPath(); x.arc(0, 0, 26, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = '#5fb3a8';
  x.lineWidth = 3;
  x.stroke(new Path2D(markContour(26)));
  x.fillStyle = solar;
  x.beginPath(); x.arc(18.4, -18.4, 4, 0, Math.PI * 2); x.fill();
  x.restore();
  x.fillStyle = paper;
  x.font = '500 38px "Newsreader WW", Georgia, serif';
  x.fillText('Weather', 128, 117);
  const ww = x.measureText('Weather ').width;
  x.font = 'italic 300 38px "Newsreader WW", Georgia, serif';
  x.fillText('Window', 128 + ww, 117);

  x.font = '500 18px "Martian WW", ui-monospace, monospace';
  x.fillStyle = mutedC;
  x.fillText('THE WEEK’S SIGNATURE', 84, 210);
  x.fillStyle = paper;
  x.font = '500 76px "Newsreader WW", Georgia, serif';
  x.fillText(placeLabel.slice(0, 26), 80, 290);
  x.font = '400 26px "Hanken WW", system-ui, sans-serif';
  x.fillStyle = mutedC;
  x.fillText(dateRange, 84, 336);

  // The signature.
  const cx = W / 2;
  const cy = 760;
  const scale = 2.55;
  x.save();
  x.translate(cx, cy);
  x.scale(scale, scale);
  x.lineWidth = 1 / scale;
  x.strokeStyle = 'rgba(233,229,218,0.14)';
  for (const a of [0, 90, 180, 270]) {
    const [x0, y0] = polar(a, 16);
    const [x1, y1] = polar(a, 122);
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
  }
  x.setLineDash([2 / scale * 2, 3 / scale * 2]);
  for (const m of [-1, 1]) {
    x.beginPath(); x.arc(0, 0, g.r0 + m * 5 * g.k, 0, Math.PI * 2); x.stroke();
  }
  x.setLineDash([]);
  x.strokeStyle = paper;
  x.lineWidth = 1.6 / scale * 1.4;
  x.beginPath(); x.arc(0, 0, g.r0, 0, Math.PI * 2); x.stroke();
  x.lineJoin = 'round';
  for (const d of g.days) {
    if (!d.path) continue;
    x.strokeStyle = rgbCss(tempColor(d.dayMean), 0.92);
    x.lineWidth = 2.6 / scale * 1.3;
    x.stroke(new Path2D(d.path));
  }
  x.restore();
  x.font = '500 17px "Martian WW", ui-monospace, monospace';
  x.fillStyle = mutedC;
  x.textAlign = 'center';
  for (const [a, label] of [[0, '00'], [90, '06'], [180, '12'], [270, '18']]) {
    const [lx, ly] = polar(a, 131);
    x.fillText(label, cx + lx * scale, cy + ly * scale + 6);
  }
  x.fillStyle = paper;
  x.font = '500 19px "Martian WW", ui-monospace, monospace';
  x.fillText('AVERAGE', cx, cy - 4);
  x.font = '400 54px "Newsreader WW", Georgia, serif';
  x.fillText(`${round(tempTo(g.mean, units))}${SYSTEMS[units].temp}`, cx, cy + 52);
  x.textAlign = 'left';

  // Footer: how to read it, and where the data came from.
  x.fillStyle = paper;
  x.font = 'italic 300 34px "Newsreader WW", Georgia, serif';
  x.fillText('The circle is the average. The lines are the week.', 84, 1188);
  x.font = '400 19px "Hanken WW", system-ui, sans-serif';
  x.fillStyle = mutedC;
  x.fillText('Each line: one day of hourly temperatures. Outside the circle is warmer than the week’s average; inside is cooler.', 84, 1226, W - 168);
  x.font = '500 15px "Martian WW", ui-monospace, monospace';
  x.fillText(provenance.toUpperCase().slice(0, 96), 84, 1280, W - 168);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

/** The contour inside the brand mark, sized for a circle of radius r. */
export function markContour(r) {
  const vals = [0.2, 0.9, 1.4, 0.3, -1.2, -1.5, -0.4, 0.6, 0.1, -0.9, -0.6, 0.4];
  return contourPath(vals, 0, r * 0.6, r * 0.16);
}
