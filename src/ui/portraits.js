// Seven days, seven atmospheres: one generated portrait per forecast day.
//
// Each portrait is a small landscape whose parts come from that day's
// forecast, through a fixed and published mapping:
//   horizon   the 24 hourly temperatures, on the week's shared scale (data)
//   ground    filled with the temperature colours of that day (data)
//   sky       darker and greyer with more mean daytime cloud (artistic mapping)
//   sun       size from the day's UV maximum, dimmed by cloud (artistic mapping)
//   strata    one band per 20 % of mean daytime cloud (artistic mapping)
//   streaks   rain: count from the maximum precipitation chance, length from
//             the precipitation sum, slant from the mean wind (artistic mapping)
// The same inputs always draw the same portrait. Missing inputs remove their
// part rather than inventing one.

import { s, replace, whenNear } from './dom.js';
import { isNum, round } from '../core/num.js';
import { tempColor, rgbCss, compass } from '../core/encoding.js';
import { fmtTemp, fmtPct, fmtPrecip } from '../core/units.js';
import { weekdayShort, weekdayLong, dayMonth } from '../core/time.js';
import { describeCode } from '../core/weathercodes.js';
import { weatherIcon } from './icons.js';

const W = 120;
const H = 150;
const HORIZON_TOP = 70;
const HORIZON_BOT = 122;

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** The inputs a portrait is drawn from, all straight from the forecast. */
export function portraitInputs(forecast, dayIndex) {
  const d = forecast.days[dayIndex];
  const hrs = d.hourStart >= 0 ? forecast.hours.slice(d.hourStart, d.hourStart + d.hourCount) : [];
  const dayHrs = hrs.filter((x) => x.isDay === 1);
  const cloud = mean(dayHrs.map((x) => x.cloud).filter(isNum));
  // Mean wind as a vector average of the hourly directions, weighted by speed.
  let ux = 0;
  let uy = 0;
  for (const x of hrs) {
    if (!isNum(x.wind) || !isNum(x.windDir)) continue;
    const a = (x.windDir * Math.PI) / 180;
    ux += Math.sin(a) * x.wind;
    uy += Math.cos(a) * x.wind;
  }
  const windFrom = ux || uy ? ((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360 : null;
  return {
    date: d.date,
    temps: hrs.map((x) => (isNum(x.temp) ? x.temp : null)),
    high: d.high, low: d.low, uvMax: d.uvMax, popMax: d.popMax, precipSum: d.precipSum,
    windMax: d.windMax, code: d.code, cloud, windFrom,
  };
}

function rng(seed) {
  let v = seed >>> 0 || 7;
  return () => { v ^= v << 13; v ^= v >>> 17; v ^= v << 5; return ((v >>> 0) % 100000) / 100000; };
}
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));

/** One portrait as an SVG element. `range` is the week's [lo, hi] in °C. */
export function portrait(inp, range, uid) {
  const [lo, hi] = range;
  const rand = rng([...inp.date].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const cloudK = isNum(inp.cloud) ? inp.cloud / 100 : 0.3;
  const uvK = isNum(inp.uvMax) ? Math.min(1, inp.uvMax / 10) : 0.4;
  const top = mix(mix([18, 58, 74], [62, 70, 74], cloudK), [8, 14, 16], 0.35 * (1 - uvK));
  const bottom = mix(mix([214, 170, 112], [128, 136, 134], cloudK), [40, 52, 56], 0.4 * (1 - uvK));
  const id = `pt-${uid}`;
  const kids = [
    s('defs', null,
      s('linearGradient', { id: `${id}-sky`, x1: 0, y1: 0, x2: 0, y2: 1 },
        s('stop', { offset: 0, 'stop-color': `rgb(${top})` }),
        s('stop', { offset: 1, 'stop-color': `rgb(${bottom})` })),
      s('linearGradient', { id: `${id}-ground`, x1: 0, y1: 0, x2: 1, y2: 0 },
        ...inp.temps.map((t, i) => s('stop', { offset: (i / Math.max(1, inp.temps.length - 1)).toFixed(3), 'stop-color': rgbCss(tempColor(t)) }))),
      s('filter', { id: `${id}-soft`, x: '-20%', y: '-60%', width: '140%', height: '220%' }, s('feGaussianBlur', { stdDeviation: 2.2 })),
      s('clipPath', { id: `${id}-clip` }, s('rect', { width: W, height: H, rx: 3 }))),
  ];
  const g = s('g', { 'clip-path': `url(#${id}-clip)` });
  const add = (el) => g.append(el);
  add(s('rect', { width: W, height: H, fill: `url(#${id}-sky)` }));

  // Sun: size from UV max, faded by cloud; placed over the warmest hour.
  if (isNum(inp.uvMax) && inp.uvMax > 0.2) {
    const iMax = inp.temps.reduce((b, t, i) => (isNum(t) && (b < 0 || t > inp.temps[b]) ? i : b), -1);
    const cx = iMax >= 0 ? 8 + (iMax / 23) * (W - 16) : W * 0.6;
    const r = 6 + uvK * 12;
    add(s('circle', { cx: cx.toFixed(1), cy: 38, r: (r * 1.9).toFixed(1), fill: 'rgb(240,180,76)', filter: `url(#${id}-soft)`, opacity: (0.16 * (1 - cloudK * 0.8)).toFixed(2) }));
    add(s('circle', { cx: cx.toFixed(1), cy: 38, r: r.toFixed(1), fill: 'rgb(246,198,108)', opacity: (0.95 - cloudK * 0.6).toFixed(2) }));
  }

  // Cloud strata: one soft band per 20 % mean daytime cloud.
  if (isNum(inp.cloud)) {
    const n = Math.round(inp.cloud / 20);
    for (let k = 0; k < n; k += 1) {
      const y = 18 + k * 11 + rand() * 4;
      const x = -20 + rand() * 30;
      add(s('rect', { x: x.toFixed(1), y: y.toFixed(1), width: (W * (0.7 + rand() * 0.6)).toFixed(1), height: (4 + rand() * 4).toFixed(1), rx: 3, filter: `url(#${id}-soft)`, fill: 'rgb(224,226,220)', opacity: (0.22 + cloudK * 0.25).toFixed(2) }));
    }
  }

  // Rain streaks: count from max precipitation chance, length from the sum.
  if (isNum(inp.popMax) && inp.popMax >= 10) {
    const n = Math.round((inp.popMax / 100) * 34);
    const len = 6 + Math.min(1, (isNum(inp.precipSum) ? inp.precipSum : 0) / 12) * 18;
    // Streaks lean the way the wind blows; mean wind direction, strength from windMax.
    const lean = isNum(inp.windFrom) ? -Math.sin((inp.windFrom * Math.PI) / 180) * Math.min(0.9, (inp.windMax || 0) / 40) : 0;
    for (let k = 0; k < n; k += 1) {
      const x = rand() * (W + 20) - 10;
      const y = 14 + rand() * 80;
      add(s('line', { x1: x.toFixed(1), y1: y.toFixed(1), x2: (x + lean * len).toFixed(1), y2: (y + len).toFixed(1), stroke: 'rgb(170,214,224)', 'stroke-width': 1, 'stroke-linecap': 'round', opacity: (0.35 + rand() * 0.45).toFixed(2) }));
    }
  }

  // Horizon: the day's hourly temperatures on the week's scale.
  const yOf = (t) => HORIZON_BOT - ((t - lo) / (hi - lo || 1)) * (HORIZON_BOT - HORIZON_TOP);
  const pts = inp.temps.map((t, i) => (isNum(t) ? [(i / Math.max(1, inp.temps.length - 1)) * W, yOf(t)] : null));
  const known = pts.filter(Boolean);
  if (known.length >= 2) {
    let d = `M0 ${H} L0 ${known[0][1].toFixed(1)}`;
    for (const p of pts) if (p) d += ` L${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    d += ` L${W} ${known[known.length - 1][1].toFixed(1)} L${W} ${H} Z`;
    add(s('path', { d, fill: `url(#${id}-ground)` }));
    let ridge = '';
    for (const p of pts) if (p) ridge += `${ridge ? ' L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    add(s('path', { d: ridge, class: 'pt-ridge', fill: 'none' }));
    // A second, darker range below gives the landscape depth (decoration).
    let d2 = `M0 ${H}`;
    for (let x = 0; x <= W; x += 6) d2 += ` L${x} ${(HORIZON_BOT + 8 + Math.sin(x / 13 + rand() * 0.4) * 4).toFixed(1)}`;
    add(s('path', { d: `${d2} L${W} ${H} Z`, fill: 'rgba(8,13,15,.42)' }));
  } else {
    add(s('text', { x: W / 2, y: 110, 'text-anchor': 'middle', class: 'pt-missing', text: 'no hourly temperatures' }));
  }
  kids.push(g);
  return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'portrait-art', 'aria-hidden': 'true' }, ...kids);
}

export function createPortraits(host, { onSelectDay }) {
  let last = null;
  let near = false;
  let queued = null;
  whenNear(host, () => { near = true; if (queued) api.update(queued); });
  const api = {
    update({ forecast, units, day }) {
      if (!near) { queued = { forecast, units, day }; return; }
      const key = `${forecast.days.length}|${units}`;
      if (last && last.forecast === forecast && last.key === key) {
        [...host.children].forEach((b, i) => { b.classList.toggle('on', i === day); b.setAttribute('aria-pressed', String(i === day)); });
        return;
      }
      last = { forecast, key };
      const all = forecast.hours.map((x) => x.temp).filter(isNum);
      const range = all.length ? [Math.min(...all), Math.max(...all)] : [0, 1];
      const cards = forecast.days.map((d, i) => {
        const inp = portraitInputs(forecast, i);
        const cond = describeCode(d.code);
        const parts = [
          `${weekdayLong(d.date)} ${dayMonth(d.date)}`,
          cond.label,
          `high ${fmtTemp(d.high, units)}, low ${fmtTemp(d.low, units)}`,
          isNum(inp.cloud) ? `mean daytime cloud ${round(inp.cloud)}%` : 'cloud cover missing',
          isNum(d.uvMax) ? `UV up to ${round(d.uvMax, 1)}` : 'UV missing',
          `precipitation chance up to ${fmtPct(d.popMax)}, total ${fmtPrecip(d.precipSum, units)}`,
          isNum(inp.windFrom) ? `mean wind from the ${compass(inp.windFrom)}` : null,
        ].filter(Boolean);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `portrait${i === day ? ' on' : ''}`;
        btn.setAttribute('aria-pressed', String(i === day));
        btn.setAttribute('aria-label', parts.join('; '));
        btn.addEventListener('click', () => onSelectDay(i));
        const cap = document.createElement('span');
        cap.className = 'portrait-cap';
        const name = document.createElement('span');
        name.className = 'portrait-name';
        name.textContent = weekdayShort(d.date);
        const temps = document.createElement('span');
        temps.className = 'portrait-temps';
        const b = document.createElement('b');
        b.textContent = fmtTemp(d.high, units);
        const l = document.createElement('span');
        l.textContent = fmtTemp(d.low, units);
        temps.append(b, l);
        cap.append(weatherIcon(cond.group, { size: 18 }), name, temps);
        btn.append(portrait(inp, range, `${i}`), cap);
        return btn;
      });
      replace(host, ...cards);
    },
  };
  return api;
}
