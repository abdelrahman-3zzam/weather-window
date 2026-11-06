// Experience C — What-if Lab: the average trap, made tangible.
// Two weeks of daily maximum temperatures on one chart. Drag any day, shift
// a whole week, stretch or smooth it, and watch which statistics move.
// The mean is drawn as a fulcrum: it is literally the balance point.

import { h, s, replace, reducedMotion, announce } from './dom.js';
import { icon } from './icons.js';
import { isNum, round } from '../core/num.js';
import { PRESETS, fromPreset, fromForecast, shiftAll, setDay, stretch, labStats, compareStats, LIMITS } from '../core/lab.js';
import { tempTo, tempFrom, tempDeltaTo, SYSTEMS } from '../core/units.js';
import { niceDomain, linear } from './scale.js';
import { weekdayShort } from '../core/time.js';
import { labShapes } from './signature.js';

const LANES = ['a', 'b'];
const LANE_NAME = { a: 'Week A', b: 'Week B' };

export function initialLab() {
  return { a: fromPreset('steady'), b: fromPreset('seesaw'), keepMean: true, band: [24, 26], step: 0 };
}

export function createLab(root, ctx) {
  let st = null;
  let drag = null;
  let focusKey = null;
  let lastAction = null;
  // Before/after: the previous version of an edited week stays on the chart
  // as a dashed "before" line, and the change itself is animated, so every
  // transformation is visible rather than a jump.
  let lastLab = null;
  let ghost = { a: null, b: null };
  let ghostLive = false; // true while a drag or key-step series is running
  let liveUntil = 0;
  const tween = { a: null, b: null };
  let tweenRaf = 0;
  const TWEEN_MS = 520;
  const view = (k) => {
    const tw = tween[k];
    if (!tw) return st.lab[k];
    const e = 1 - (1 - Math.min(1, (performance.now() - tw.t0) / TWEEN_MS)) ** 3;
    const mixA = (a, b) => a.map((v, i) => v + (b[i] - v) * e);
    return { ...st.lab[k], highs: mixA(tw.from.highs, st.lab[k].highs), lows: mixA(tw.from.lows, st.lab[k].lows) };
  };
  function runTween() {
    cancelAnimationFrame(tweenRaf);
    const step = () => {
      const now = performance.now();
      for (const k of LANES) if (tween[k] && now - tween[k].t0 >= TWEEN_MS) tween[k] = null;
      renderChart();
      renderShapes();
      if (tween.a || tween.b) tweenRaf = requestAnimationFrame(step);
    };
    tweenRaf = requestAnimationFrame(step);
  }
  function renderShapes() {
    replace(shapesHost, labShapes(view('a'), view('b'), { units: st.units, ghost }));
  }
  function trackChanges(prev, next) {
    if (!prev) return;
    const live = ghostLive || performance.now() < liveUntil;
    let animate = false;
    for (const k of LANES) {
      const was = prev[k];
      const now = next[k];
      if (was === now) { if (!live) ghost[k] = ghost[k] && (prev.a !== next.a || prev.b !== next.b) ? null : ghost[k]; continue; }
      if (was.highs.length !== now.highs.length) { ghost[k] = null; continue; }
      if (live) {
        if (!ghost[k] || !ghost[k].live) ghost[k] = { ...was, live: true };
      } else {
        ghost[k] = { ...was, live: false };
        if (!reducedMotion()) { tween[k] = { from: was, t0: performance.now() }; animate = true; }
      }
    }
    if (animate) runTween();
  }

  const label = h('div', { class: 'lab-label' });
  const lanes = h('div', { class: 'lab-lanes' });
  const chartHost = h('div', { class: 'lab-chart', 'aria-describedby': 'lab-chart-help' });
  const beams = h('div', { class: 'beams' });
  const statsHost = h('div', { class: 'lab-stats' });
  const shapesHost = h('div', { class: 'shapes-wrap' });
  const changed = h('div', { class: 'lab-changed', 'aria-live': 'polite' });
  const guide = h('ol', { class: 'lab-guide' });
  const keep = h('input', { type: 'checkbox', id: 'keep-mean' });
  const bandLo = h('input', { type: 'number', id: 'band-lo', step: '1', inputmode: 'decimal' });
  const bandHi = h('input', { type: 'number', id: 'band-hi', step: '1', inputmode: 'decimal' });

  root.append(
    h('header', { class: 'view-head' },
      h('p', { class: 'eyebrow' }, '03 · What-if Lab'),
      h('h2', { class: 'view-title' }, 'Same average. ', h('em', null, 'Different week.')),
      h('p', { class: 'view-lede' }, 'Both weeks below start with a mean daily maximum of exactly 25 °C. Drag the days, shift a week, and see what the average keeps and what it hides.')),
    label,
    h('div', { class: 'lab-layout' },
      h('div', { class: 'lab-main' },
        h('section', { class: 'panel lab-stage', 'aria-labelledby': 'lab-stage-h' },
          h('div', { class: 'panel-head' },
            h('div', null, h('p', { class: 'eyebrow' }, 'Daily maximum temperature'), h('h3', { id: 'lab-stage-h' }, 'Two weeks, one scale')),
            h('div', { class: 'lab-switches' },
              h('label', { class: 'switch', for: 'keep-mean' }, keep, h('span', { class: 'switch-ui', 'aria-hidden': 'true' }), 'Keep each mean fixed while dragging'),
              h('div', { class: 'band-inputs' },
                h('span', { id: 'band-l' }, 'Comfort band'),
                h('label', { class: 'sr-only', for: 'band-lo' }, 'Comfort band from'), bandLo,
                h('span', { 'aria-hidden': 'true' }, '–'),
                h('label', { class: 'sr-only', for: 'band-hi' }, 'Comfort band to'), bandHi,
                h('span', { class: 'band-unit' })))),
          chartHost,
          h('p', { class: 'muted small', id: 'lab-chart-help' }, 'Drag a dot up or down, or focus it and use the arrow keys (Shift for bigger steps). Bars show each day from its minimum to its maximum.'),
          beams),
        lanes),
      h('aside', { class: 'lab-side' },
        h('section', { class: 'panel', 'aria-labelledby': 'lab-shapes-h' },
          h('p', { class: 'eyebrow' }, 'Daily maxima on a seven-day clock'),
          h('h3', { id: 'lab-shapes-h' }, 'Same circle, different shapes'),
          shapesHost,
          h('p', { class: 'small muted' }, 'Each corner is one day’s maximum; the circle is the week’s mean. When the means match, both weeks share one circle and only the shape tells them apart.')),
        h('section', { class: 'panel', 'aria-labelledby': 'lab-stats-h' }, h('h3', { id: 'lab-stats-h' }, 'What the numbers say'), statsHost, changed),
        h('section', { class: 'panel', 'aria-labelledby': 'lab-guide-h' }, h('h3', { id: 'lab-guide-h' }, 'The 60-second experiment'), guide))),
    h('p', { class: 'fine' }, 'Temperature-only, mathematical scenarios. They are not forecasts or climate simulations, and humidity, wind, precipitation and UV are not part of them. A copied forecast is labelled as a copy and edits never change the real forecast.'),
  );

  keep.addEventListener('change', () => ctx.setLab({ keepMean: keep.checked }));
  const onBand = () => {
    const lo = tempFrom(Number(bandLo.value), st.units);
    const hi = tempFrom(Number(bandHi.value), st.units);
    if (!isNum(lo) || !isNum(hi) || bandLo.value === '' || bandHi.value === '') return;
    if (lo > hi) { bandHi.setCustomValidity('The upper end must be at least the lower end.'); bandHi.reportValidity(); return; }
    bandHi.setCustomValidity('');
    ctx.setLab({ band: [lo, hi] });
  };
  bandLo.addEventListener('change', onBand);
  bandHi.addEventListener('change', onBand);

  // ---------- Lanes (per-week controls) ----------
  function renderLanes() {
    const lab = st.lab;
    replace(lanes, ...LANES.map((k) => {
      const sc = lab[k];
      const forecastCopy = st.forecast && st.source !== 'demo' ? fromForecast(st.forecast.days, st.place.name) : null;
      return h('section', { class: `panel lane lane-${k}`, 'aria-label': LANE_NAME[k] },
        h('div', { class: 'lane-head' }, h('span', { class: 'lane-dot', 'aria-hidden': 'true' }), h('h3', null, LANE_NAME[k]), h('span', { class: 'lane-src' }, sc.source === 'synthetic' ? 'Synthetic' : 'Hypothetical copy')),
        h('div', { class: 'chips', role: 'group', 'aria-label': `${LANE_NAME[k]} starting point` },
          ...Object.entries(PRESETS).map(([pk, p]) => h('button', {
            type: 'button', class: `chip${sc.presetKey === pk && !sc.edited ? ' on' : ''}`, 'aria-pressed': String(sc.presetKey === pk && !sc.edited), title: p.note,
            onclick: () => { ctx.setLab({ [k]: fromPreset(pk) }); note(`${LANE_NAME[k]} reset to ${p.name}.`); },
          }, p.name)),
          forecastCopy ? h('button', {
            type: 'button', class: `chip${sc.source === 'forecast-copy' && !sc.edited ? ' on' : ''}`, title: 'A hypothetical copy of this week’s forecast highs and lows',
            onclick: () => { ctx.setLab({ [k]: fromForecast(st.forecast.days.map((d) => ({ ...d, weekday: weekdayShort(d.date) })), st.place.name) }); note(`${LANE_NAME[k]} now starts from a copy of the ${st.place.name} forecast.`); },
          }, icon('pin', { size: 14 }), 'This week (copy)') : null),
        h('div', { class: 'lane-actions' },
          h('span', { class: 'small muted' }, 'Shift every day'),
          ...[-2, -1, 1, 2].map((d) => h('button', { type: 'button', class: 'btn mini', onclick: () => doShift(k, d), 'aria-label': `Shift ${LANE_NAME[k]} by ${d > 0 ? '+' : ''}${shiftLabel(d)}` }, `${d > 0 ? '+' : '−'}${shiftLabel(Math.abs(d), false)}`)),
          h('span', { class: 'sep', 'aria-hidden': 'true' }),
          h('button', { type: 'button', class: 'btn mini', onclick: () => doStretch(k, 1.25) }, 'Exaggerate'),
          h('button', { type: 'button', class: 'btn mini', onclick: () => doStretch(k, 0.8) }, 'Smooth')),
        h('p', { class: 'lane-label small muted' }, sc.label + (sc.edited ? ' · edited' : '')));
    }));
  }

  function shiftLabel(d, unit = true) {
    // Shift buttons move by whole degrees of the active unit.
    return `${d}${unit ? SYSTEMS[st.units].temp : '°'}`;
  }

  function doShift(k, d) {
    const before = labStats(st.lab[k], st.lab.band);
    const deltaC = st.units === 'imperial' ? d / 1.8 : d;
    const next = shiftAll(st.lab[k], deltaC);
    lastAction = { type: 'shift', lane: k, delta: deltaC, before, after: labStats(next, st.lab.band) };
    ctx.setLab({ [k]: next });
  }

  function doStretch(k, f) {
    const before = labStats(st.lab[k], st.lab.band);
    const next = stretch(st.lab[k], f);
    lastAction = { type: f > 1 ? 'exaggerate' : 'smooth', lane: k, before, after: labStats(next, st.lab.band) };
    ctx.setLab({ [k]: next });
  }

  function note(text) {
    lastAction = null;
    announce(text);
  }

  // ---------- Chart ----------
  let geom = null;
  function renderChart() {
    const lab = st.lab;
    const u = st.units;
    const width = Math.max(320, Math.round(chartHost.clientWidth || 640));
    const height = width < 520 ? 280 : 320;
    const pad = { l: 40, r: 70, t: 18, b: 30 };
    const ga = [ghost.a, ghost.b].filter(Boolean).flatMap((g) => [...g.highs, ...g.lows]);
    const all = [...lab.a.highs, ...lab.b.highs, ...lab.a.lows, ...lab.b.lows, ...lab.band, ...ga].map((v) => tempTo(v, u));
    const dom = niceDomain(Math.min(...all) - 1, Math.max(...all) + 1, 5);
    const n = lab.a.highs.length;
    const band = (width - pad.l - pad.r) / n;
    const x = (i, lane) => pad.l + band * (i + 0.5) + (lane === 'a' ? -band * 0.14 : band * 0.14);
    const y = linear(dom.lo, dom.hi, height - pad.b, pad.t);
    geom = { y, dom, pad, height };
    const kids = [];

    // Comfort band.
    const b0 = tempTo(lab.band[0], u);
    const b1 = tempTo(lab.band[1], u);
    kids.push(s('rect', { class: 'lab-band', x: pad.l, width: width - pad.l - pad.r, y: y(b1), height: Math.max(1, y(b0) - y(b1)) }));
    kids.push(s('text', { class: 'lab-band-label', x: pad.l + 6, y: y(b1) - 5, text: 'comfort band' }));

    for (const t of dom.ticks) {
      kids.push(s('line', { class: 'grid', x1: pad.l, x2: width - pad.r, y1: y(t), y2: y(t) }));
      kids.push(s('text', { class: 'axis', x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end', text: `${t}°` }));
    }
    for (let i = 0; i < n; i += 1) {
      kids.push(s('text', { class: 'axis day', x: pad.l + band * (i + 0.5), y: height - 8, 'text-anchor': 'middle', text: lab.a.days[i] && lab.a.days[i].length <= 4 ? lab.a.days[i] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i] }));
    }

    // Mean labels sit at their mean, nudged apart when the two nearly coincide.
    const means = Object.fromEntries(LANES.map((k) => [k, y(tempTo(labStats(lab[k]).mean, u))]));
    const labelY = { a: means.a, b: means.b };
    if (Math.abs(means.a - means.b) < 14) {
      const mid = (means.a + means.b) / 2;
      const upper = means.a <= means.b ? 'a' : 'b';
      labelY[upper] = mid - 7;
      labelY[upper === 'a' ? 'b' : 'a'] = mid + 7;
    }
    for (const k of LANES) {
      const g = ghost[k];
      if (!g) continue;
      const gh = g.highs.map((v) => tempTo(v, u));
      kids.push(s('path', { class: `lab-ghost lane-${k}`, d: gh.map((v, i) => `${i ? 'L' : 'M'}${x(i, k).toFixed(1)},${y(v).toFixed(1)}`).join('') }));
      // Label the ghost where it differs most from the current week.
      const cur = lab[k].highs.map((v) => tempTo(v, u));
      const iMax = gh.reduce((best, v, i) => (Math.abs(v - cur[i]) > Math.abs(gh[best] - cur[best]) ? i : best), 0);
      const below = gh[iMax] < cur[iMax];
      kids.push(s('text', { class: `lab-ghost-label lane-${k}`, x: x(iMax, k), y: y(gh[iMax]) + (below ? 18 : -11), 'text-anchor': 'middle', text: 'before' }));
    }
    for (const k of LANES) {
      const sc = view(k);
      const hi = sc.highs.map((v) => tempTo(v, u));
      const lo = sc.lows.map((v) => tempTo(v, u));
      const m = labStats(sc).mean;
      for (let i = 0; i < n; i += 1) {
        kids.push(s('line', { class: `lab-range lane-${k}`, x1: x(i, k), x2: x(i, k), y1: y(lo[i]), y2: y(hi[i]) }));
      }
      kids.push(s('path', { class: `lab-line lane-${k}`, d: hi.map((v, i) => `${i ? 'L' : 'M'}${x(i, k).toFixed(1)},${y(v).toFixed(1)}`).join('') }));
      const ym = y(tempTo(m, u));
      kids.push(s('line', { class: `lab-mean lane-${k}`, x1: pad.l, x2: width - pad.r, y1: ym, y2: ym }));
      kids.push(s('text', { class: `lab-mean-label lane-${k}`, x: width - pad.r + 6, y: labelY[k] + 4, text: `${LANE_NAME[k].slice(-1)} mean ${round(tempTo(m, u), 1)}°` }));
      for (let i = 0; i < n; i += 1) {
        const key = `${k}${i}`;
        const inBand = sc.highs[i] >= lab.band[0] && sc.highs[i] <= lab.band[1];
        kids.push(s('circle', {
          class: `lab-handle lane-${k}${inBand ? ' in-band' : ''}`, cx: x(i, k), cy: y(hi[i]), r: 8,
          tabindex: '0', role: 'slider', 'data-key': key,
          'aria-label': `${LANE_NAME[k]}, ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]} maximum`,
          'aria-valuemin': round(tempTo(LIMITS.min, u)), 'aria-valuemax': round(tempTo(LIMITS.max, u)),
          'aria-valuenow': round(hi[i], 1), 'aria-valuetext': `${round(hi[i], 1)} ${SYSTEMS[u].temp}${inBand ? ', inside the band' : ''}`,
        }));
      }
    }
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'lab-svg' }, ...kids);
    replace(chartHost, svg);
    if (focusKey) chartHost.querySelector(`[data-key="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  function valueAt(clientY) {
    const rect = chartHost.getBoundingClientRect();
    const svg = chartHost.querySelector('svg');
    const scale = svg ? svg.viewBox.baseVal.height / rect.height : 1;
    const py = (clientY - rect.top) * scale;
    const { dom, pad, height } = geom;
    const display = dom.lo + ((height - pad.b - py) / (height - pad.b - pad.t)) * (dom.hi - dom.lo);
    const c = tempFrom(display, st.units);
    return Math.round(c * 2) / 2;
  }

  function moveDay(key, valueC) {
    const lane = key[0];
    const i = Number(key.slice(1));
    const next = setDay(st.lab[lane], i, valueC, st.lab.keepMean);
    if (next === st.lab[lane]) return;
    lastAction = { type: 'drag', lane, keepMean: st.lab.keepMean, before: lastAction?.type === 'drag' && lastAction.lane === lane ? lastAction.before : labStats(st.lab[lane], st.lab.band), after: labStats(next, st.lab.band) };
    ctx.setLab({ [lane]: next });
  }

  chartHost.addEventListener('pointerdown', (e) => {
    const t = e.target.closest?.('.lab-handle');
    if (!t) return;
    drag = t.dataset.key;
    focusKey = drag;
    ghostLive = true;
    for (const k of LANES) if (ghost[k]) ghost[k] = { ...ghost[k], live: false };
    lastAction = null;
    chartHost.setPointerCapture(e.pointerId);
    chartHost.classList.add('dragging');
    e.preventDefault();
  });
  chartHost.addEventListener('pointermove', (e) => {
    if (!drag) return;
    moveDay(drag, valueAt(e.clientY));
  });
  const end = (e) => {
    if (!drag) return;
    drag = null;
    ghostLive = false;
    chartHost.classList.remove('dragging');
    try { chartHost.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  chartHost.addEventListener('pointerup', end);
  chartHost.addEventListener('pointercancel', end);
  chartHost.addEventListener('focusin', (e) => { if (e.target.dataset?.key) focusKey = e.target.dataset.key; });
  chartHost.addEventListener('keydown', (e) => {
    const key = e.target.dataset?.key;
    if (!key) return;
    const unitStep = e.shiftKey ? 2 : 0.5;
    const stepC = st.units === 'imperial' ? (unitStep * 2) / 1.8 : unitStep;
    const lane = key[0];
    const i = Number(key.slice(1));
    const cur = st.lab[lane].highs[i];
    let v = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v = cur + stepC;
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v = cur - stepC;
    if (v === null) return;
    e.preventDefault();
    if (!lastAction || lastAction.type !== 'drag') lastAction = null;
    liveUntil = performance.now() + 60;
    moveDay(key, v);
  });

  // ---------- Beams: the mean as a balance point ----------
  function renderBeams() {
    const u = st.units;
    const lab = st.lab;
    const width = Math.max(300, Math.round(beams.clientWidth || 600));
    const all = [...lab.a.highs, ...lab.b.highs].map((v) => tempTo(v, u));
    const dom = niceDomain(Math.min(...all) - 1, Math.max(...all) + 1, 6);
    const x = linear(dom.lo, dom.hi, 30, width - 20);
    const rows = LANES.map((k, r) => {
      const sc = lab[k];
      const stx = labStats(sc);
      const y0 = 58 + r * 86;
      const kids = [];
      const m = tempTo(stx.mean, u);
      const sd = tempDeltaTo(stx.sd, u);
      kids.push(s('rect', { class: `sd-band lane-${k}`, x: x(m - sd), y: y0 - 16, width: Math.max(0, x(m + sd) - x(m - sd)), height: 22, rx: 4 }));
      kids.push(s('line', { class: 'beam', x1: x(Math.min(...sc.highs.map((v) => tempTo(v, u)))), x2: x(Math.max(...sc.highs.map((v) => tempTo(v, u)))), y1: y0 + 6, y2: y0 + 6 }));
      // Stack dots that share a value so every day stays visible.
      const seen = new Map();
      sc.highs.forEach((v) => {
        const dv = round(tempTo(v, u), 1);
        const k2 = String(dv);
        const stack = seen.get(k2) || 0;
        seen.set(k2, stack + 1);
        kids.push(s('circle', { class: `beam-dot lane-${k}`, cx: x(dv), cy: y0 - stack * 9, r: 4.5 }));
      });
      kids.push(s('path', { class: `fulcrum lane-${k}`, d: `M${x(m)},${y0 + 8} l-9,16 h18 Z` }));
      kids.push(s('text', { class: 'beam-label', x: 30, y: y0 - 44, text: `${LANE_NAME[k]}: balances at ${round(m, 1)}°, typical spread ±${round(sd, 1)}°` }));
      return kids;
    });
    for (const t of dom.ticks) rows.push([s('text', { class: 'axis', x: x(t), y: 206, 'text-anchor': 'middle', text: `${t}°` })]);
    replace(beams,
      h('p', { class: 'beam-title' }, h('strong', null, 'The mean is the balance point. '), 'Each dot is one day’s maximum. The triangle sits where the week balances; the shaded block shows one standard deviation either side.'),
      s('svg', { viewBox: `0 0 ${width} 214`, class: 'beam-svg', role: 'img', 'aria-label': beamSummary() }, ...rows.flat()));
  }

  function beamSummary() {
    const u = st.units;
    return LANES.map((k) => {
      const x = labStats(st.lab[k]);
      return `${LANE_NAME[k]} balances at ${round(tempTo(x.mean, u), 1)} degrees with a typical spread of ${round(tempDeltaTo(x.sd, u), 1)}.`;
    }).join(' ');
  }

  // ---------- Statistics ----------
  function renderStats() {
    const u = st.units;
    const sys = SYSTEMS[u];
    const band = st.lab.band;
    const A = labStats(st.lab.a, band);
    const B = labStats(st.lab.b, band);
    const cmp = compareStats(A, B);
    const t = (v) => `${round(tempTo(v, u), 1)}°`;
    const d = (v) => `${round(tempDeltaTo(v, u), 1)}°`;
    const rows = [
      ['mean', 'Mean daily maximum', t(A.mean), t(B.mean), 'Add the seven maxima, divide by seven.'],
      ['range', 'Range', d(A.range), d(B.range), 'Warmest day minus coolest day.'],
      ['sd', 'Typical spread (SD)', d(A.sd), d(B.sd), 'How far a day usually sits from the mean.'],
      ['maxStep', 'Biggest day-to-day jump', d(A.maxStep), d(B.maxStep), 'Largest change between neighbouring days.'],
      ['inBand', `Days in ${round(tempTo(band[0], u))}–${round(tempTo(band[1], u))}${sys.temp}`, `${A.inBand} / 7`, `${B.inBand} / 7`, 'Days whose maximum falls inside the comfort band.'],
    ];
    replace(statsHost, h('div', { class: 'table-scroll' }, h('table', { class: 'stats-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Statistic'), h('th', { scope: 'col', class: 'lane-a' }, 'A'), h('th', { scope: 'col', class: 'lane-b' }, 'B'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Same or different')))),
      h('tbody', null, ...rows.map(([k, name, a, b, help]) => h('tr', { class: cmp[k] === 'same' ? 'same' : 'diff' },
        h('th', { scope: 'row' }, name, h('small', null, help)),
        h('td', { class: 'num' }, a), h('td', { class: 'num' }, b),
        h('td', null, h('span', { class: `verdict ${cmp[k]}` }, cmp[k] === 'same' ? 'same' : 'differs'))))))),
    h('p', { class: 'headline-verdict' }, cmp.mean === 'same' && cmp.range === 'different'
      ? 'Identical averages, different weeks. The mean alone could not tell them apart.'
      : cmp.mean === 'same' ? 'Same averages. Now look at the spread.' : 'The averages now differ. Notice which other numbers moved with them.'));
  }

  function renderChanged() {
    if (!lastAction) { replace(changed); return; }
    const u = st.units;
    const { before: b, after: a, lane } = lastAction;
    const d = (v) => `${round(tempDeltaTo(v, u), 1)}°`;
    const sign = (v) => (v > 0.04 ? '+' : v < -0.04 ? '−' : '±');
    const moved = (k) => Math.abs(a[k] - b[k]) >= 0.05;
    const items = [
      ['Mean', moved('mean') ? `${sign(a.mean - b.mean)}${d(Math.abs(a.mean - b.mean))}` : 'unchanged'],
      ['Range', moved('range') ? `${sign(a.range - b.range)}${d(Math.abs(a.range - b.range))}` : 'unchanged'],
      ['Typical spread', moved('sd') ? `${sign(a.sd - b.sd)}${d(Math.abs(a.sd - b.sd))}` : 'unchanged'],
      ['Days in band', a.inBand === b.inBand ? 'unchanged' : `${b.inBand} → ${a.inBand}`],
    ];
    const title = {
      shift: `You shifted ${LANE_NAME[lane]} by ${sign(lastAction.delta)}${d(Math.abs(lastAction.delta))}.`,
      exaggerate: `You exaggerated ${LANE_NAME[lane]}’s differences from its mean.`,
      smooth: `You smoothed ${LANE_NAME[lane]} toward its mean.`,
      drag: `You moved a day in ${LANE_NAME[lane]}${lastAction.keepMean ? ' and the other days absorbed the change' : ''}.`,
    }[lastAction.type];
    replace(changed, h('div', { class: 'changed-card' },
      h('p', null, h('strong', null, title)),
      h('ul', null, ...items.map(([k, v]) => h('li', { class: v === 'unchanged' ? 'kept' : 'moved' }, h('span', null, k), h('b', null, v)))),
      h('p', { class: 'small muted' }, lastAction.type === 'shift'
        ? 'A uniform shift moves the mean by exactly the shift and leaves range and spread untouched. Only temperature changed.'
        : 'Only temperature changed. Humidity, wind, precipitation and UV are not part of this scenario.')));
  }

  // ---------- Guided experiment ----------
  const STEPS = [
    { title: 'Compare two weeks', text: 'Steady and Seesaw both average 25 °C. Look at the chart: same mean line, very different days.', run: () => { lastAction = null; ctx.setLab({ a: fromPreset('steady'), b: fromPreset('seesaw'), band: [24, 26] }); } },
    { title: 'Count the comfortable days', text: 'With a 24–26 °C band, Steady has 6 days inside it. Seesaw has 1.', run: () => ctx.setLab({ band: [24, 26] }) },
    { title: 'Shift a week', text: 'Warm Seesaw by 2°. The mean rises by exactly 2°, the range and spread stay identical.', run: () => doShift('b', st.units === 'imperial' ? 4 : 2) },
    { title: 'Break the average', text: 'Turn Steady into a heat-spike week. Its mean is still 25 °C. One hot day hides inside a “normal” average.', run: () => { ctx.setLab({ a: fromPreset('spike'), b: fromPreset('steady') }); note('Week A is now Heat spike, Week B is Steady. Both average 25 degrees.'); } },
  ];

  function renderGuide() {
    replace(guide, ...STEPS.map((stp, i) => h('li', { class: i === st.lab.step ? 'on' : i < st.lab.step ? 'done' : '' },
      h('div', null, h('strong', null, stp.title), h('p', null, stp.text)),
      h('button', { type: 'button', class: 'btn mini', onclick: () => { stp.run(); ctx.setLab({ step: Math.min(STEPS.length - 1, i + 1) }); } }, icon('play', { size: 12 }), i === st.lab.step ? 'Show me' : 'Replay'))));
  }

  function renderLabel() {
    const sources = LANES.map((k) => st.lab[k].source);
    replace(label, h('p', { class: 'notice synthetic' }, icon('flask', { size: 16 }),
      h('span', null, h('strong', null, sources.includes('forecast-copy') ? 'Hypothetical scenarios. ' : 'Synthetic experiment. '),
        sources.includes('forecast-copy')
          ? 'One week starts from a copy of real forecast highs and lows; once edited it no longer describes the forecast.'
          : 'Invented weeks designed to illustrate the idea. Not data from any place or date.')));
  }

  return {
    update(state) {
      st = state;
      trackChanges(lastLab, state.lab);
      lastLab = state.lab;
      keep.checked = st.lab.keepMean;
      const sys = SYSTEMS[st.units];
      if (document.activeElement !== bandLo) bandLo.value = String(round(tempTo(st.lab.band[0], st.units)));
      if (document.activeElement !== bandHi) bandHi.value = String(round(tempTo(st.lab.band[1], st.units)));
      root.querySelector('.band-unit').textContent = sys.temp;
      renderLabel();
      renderLanes();
      renderChart();
      renderBeams();
      renderStats();
      renderShapes();
      renderChanged();
      renderGuide();
    },
    resize() {
      if (st) { renderChart(); renderBeams(); }
    },
  };
}
