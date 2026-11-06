// Experience B — Find Your Window: turn preferences into decisions.

import { h, s, replace, announce, toast } from './dom.js';
import { icon } from './icons.js';
import { isNum, round } from '../core/num.js';
import {
  CONSTRAINTS, PROFILES, validatePrefs, findWindows, suggestRelaxations, failureBreakdown, isOvernight, intervalLength,
} from '../core/matcher.js';
import { tempTo, tempFrom, windTo, windFrom, SYSTEMS, fmtTemp, fmtWind, fmtPct, fmtUv } from '../core/units.js';
import { weekdayShort, weekdayLong, dayMonth, hourLabel, localParts } from '../core/time.js';

const SHOW = 5;

export function createPlanner(root, ctx) {
  let prefs = null;
  let units = 'metric';
  let result = null;
  let compare = [];
  let showAll = false;
  let cursor = null; // index into forecast hours for the inspector
  let lastState = null;

  const profileBar = h('div', { class: 'chips', role: 'group', 'aria-label': 'Quick-start profiles' });
  const form = h('form', { class: 'prefs-form', novalidate: true, onsubmit: (e) => e.preventDefault() });
  const summary = h('p', { class: 'prefs-summary', 'aria-live': 'polite' });
  const errors = h('div', { class: 'form-errors', role: 'alert' });
  const notice = h('div', { class: 'planner-notice' });
  const heat = h('div', { class: 'heatmap', tabindex: '0', role: 'group' });
  const inspector = h('div', { class: 'inspector', 'aria-live': 'polite' });
  const headline = h('div', { class: 'result-head', 'aria-live': 'polite' });
  const list = h('div', { class: 'window-list' });
  const comparePanel = h('div', { class: 'compare' });
  const help = h('div', { class: 'no-match' });

  root.append(
    h('header', { class: 'view-head' },
      h('p', { class: 'eyebrow' }, '02 · Find your window'),
      h('h2', { class: 'view-title' }, 'When does the week ', h('em', null, 'fit your plans?')),
      h('p', { class: 'view-lede' }, 'Say what you are comfortable with. Weather Window checks every future forecast hour against all of it at once, using that hour’s own values, and only suggests hours that pass every check.')),
    notice,
    h('div', { class: 'planner-grid' },
      h('section', { class: 'panel prefs', 'aria-labelledby': 'prefs-h' },
        h('h3', { id: 'prefs-h' }, 'Your conditions'),
        h('p', { class: 'muted small' }, 'Start from a profile, then adjust. These are personal preferences, not health or safety limits.'),
        profileBar, form, errors, summary),
      h('section', { class: 'results', 'aria-labelledby': 'results-h' },
        h('h3', { id: 'results-h', class: 'sr-only' }, 'Results'),
        h('div', { class: 'panel' },
          h('div', { class: 'panel-head' },
            h('div', null, h('p', { class: 'eyebrow' }, 'Every hour of the week'), h('h3', null, 'Where your conditions line up')),
            legend()),
          heat, inspector),
        headline, list, comparePanel, help,
        h('p', { class: 'fine' }, 'Forecasts are estimates and can change. A matching hour meets the thresholds you chose; it is not a guarantee of the weather or an assessment of whether an activity is safe.'))),
  );

  function legend() {
    return h('ul', { class: 'legend' },
      ...[['match', 'Matches'], ['win', 'In a ranked window'], ['miss', 'Misses a limit'], ['unknown', 'Missing data'], ['past', 'Past'], ['outside', 'Outside your hours']]
        .map(([k, t]) => h('li', null, h('span', { class: `sw sw-${k}` }), t)));
  }

  // ---------- Controls ----------
  const controls = {};

  function rangeField({ key, label, min, max, step, suffix, describe }) {
    const out = h('output', { class: 'val', for: `f-${key}` });
    const input = h('input', { type: 'range', id: `f-${key}`, name: key, min, max, step, 'aria-describedby': `d-${key}` });
    input.addEventListener('input', () => onInput(key, Number(input.value)));
    controls[key] = { input, out, suffix };
    return h('div', { class: 'field' },
      h('div', { class: 'field-top' }, h('label', { for: `f-${key}` }, label), out),
      input,
      h('p', { class: 'hint', id: `d-${key}` }, describe));
  }

  function tempField() {
    const outMin = h('output', { class: 'val' });
    const inMin = h('input', { type: 'range', id: 'f-tempMin', 'aria-label': 'Minimum temperature' });
    const inMax = h('input', { type: 'range', id: 'f-tempMax', 'aria-label': 'Maximum temperature' });
    inMin.addEventListener('input', () => onInput('tempMin', Number(inMin.value)));
    inMax.addEventListener('input', () => onInput('tempMax', Number(inMax.value)));
    controls.tempMin = { input: inMin, out: outMin };
    controls.tempMax = { input: inMax, out: outMin };
    const fill = h('span', { class: 'dual-fill' });
    controls.tempFill = fill;
    return h('div', { class: 'field' },
      h('div', { class: 'field-top' }, h('span', { class: 'label', id: 'l-temp' }, 'Temperature'), outMin),
      h('div', { class: 'dual', role: 'group', 'aria-labelledby': 'l-temp' }, h('span', { class: 'dual-track' }, fill), inMin, inMax),
      h('p', { class: 'hint' }, 'Air temperature in that hour, between your minimum and maximum.'));
  }

  function hourSelect(key, label, from, to) {
    const sel = h('select', { id: `f-${key}`, name: key },
      ...Array.from({ length: to - from + 1 }, (_, i) => h('option', { value: String(from + i) }, key === 'minHours' ? `${from + i} h` : hourLabel(from + i).replace(/^24/, '24'))));
    if (key === 'endHour') sel.lastChild.textContent = '24:00 (midnight)';
    sel.addEventListener('change', () => onInput(key, Number(sel.value)));
    controls[key] = { input: sel };
    return h('div', { class: 'field field-select' }, h('label', { for: `f-${key}` }, label), sel);
  }

  form.append(
    tempField(),
    rangeField({ key: 'rh', label: 'Humidity, at most', min: 0, max: 100, step: 1, suffix: '%', describe: 'Relative humidity in that hour.' }),
    rangeField({ key: 'wind', label: 'Wind, at most', min: 0, max: 60, step: 1, describe: 'Mean wind speed at 10 m. Gusts can be stronger.' }),
    rangeField({ key: 'pop', label: 'Precipitation chance, at most', min: 0, max: 100, step: 5, suffix: '%', describe: 'Chance of more than 0.1 mm in that hour. Not an amount.' }),
    rangeField({ key: 'uv', label: 'UV index, at most', min: 0, max: 11, step: 0.5, describe: 'WHO: from 3, sun protection is recommended.' }),
    h('fieldset', { class: 'time-fields' },
      h('legend', null, 'When'),
      hourSelect('startHour', 'From', 0, 23),
      hourSelect('endHour', 'Until', 1, 24),
      hourSelect('minHours', 'For at least', 1, 8),
      h('p', { class: 'hint', id: 'time-hint' })),
    h('div', { class: 'form-actions' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => applyProfile(ctx.state().profile in PROFILES ? ctx.state().profile : 'walk') }, 'Reset to profile'),
      h('button', { type: 'button', class: 'btn ghost', onclick: copyPlan }, icon('copy', { size: 16 }), 'Copy plan summary')),
  );

  function renderProfiles(active) {
    replace(profileBar, ...Object.entries(PROFILES).map(([key, p]) => h('button', {
      type: 'button', class: `chip${active === key ? ' on' : ''}`, 'aria-pressed': String(active === key), title: p.note,
      onclick: () => applyProfile(key),
    }, p.name)), h('span', { class: `chip static${active === 'custom' ? ' on' : ''}`, 'aria-hidden': active === 'custom' ? null : 'true' }, active === 'custom' ? 'Custom' : ''));
  }

  function applyProfile(key) {
    ctx.setPrefs({ ...PROFILES[key].prefs }, key);
    announce(`${PROFILES[key].name} profile applied.`);
  }

  // Slider value in display units → metric preference.
  function onInput(key, v) {
    const next = { ...prefs };
    if (key === 'tempMin' || key === 'tempMax') next[key] = units === 'imperial' ? round(tempFrom(v, units), 2) : v;
    else if (key === 'wind') next[key] = units === 'imperial' ? round(windFrom(v, units), 2) : v;
    else next[key] = v;
    ctx.setPrefs(next, 'custom');
  }

  function syncControls() {
    const sys = SYSTEMS[units];
    // The slider covers everyday temperatures; validation still accepts PREF_BOUNDS.
    const TEMP_SLIDER = [-10, 45];
    const tB = [round(tempTo(TEMP_SLIDER[0], units)), round(tempTo(TEMP_SLIDER[1], units))];
    for (const k of ['tempMin', 'tempMax']) {
      const c = controls[k].input;
      c.min = String(tB[0]);
      c.max = String(tB[1]);
      c.step = '1';
      c.value = String(round(tempTo(prefs[k], units)));
      c.setAttribute('aria-valuetext', `${round(tempTo(prefs[k], units))} ${sys.temp}`);
    }
    controls.tempMin.out.textContent = `${round(tempTo(prefs.tempMin, units))}–${round(tempTo(prefs.tempMax, units))}${sys.temp}`;
    const lo = (Number(controls.tempMin.input.value) - tB[0]) / (tB[1] - tB[0]);
    const hi = (Number(controls.tempMax.input.value) - tB[0]) / (tB[1] - tB[0]);
    controls.tempFill.style.left = `${Math.min(lo, hi) * 100}%`;
    controls.tempFill.style.width = `${Math.abs(hi - lo) * 100}%`;
    controls.tempFill.classList.toggle('bad', lo > hi);

    const windMax = units === 'imperial' ? 40 : 60;
    controls.wind.input.max = String(windMax);
    const set = (k, v, text) => {
      controls[k].input.value = String(v);
      controls[k].out.textContent = text;
      controls[k].input.setAttribute('aria-valuetext', text);
    };
    set('rh', prefs.rh, `${prefs.rh}%`);
    set('wind', round(windTo(prefs.wind, units)), `${round(windTo(prefs.wind, units))} ${sys.wind}`);
    set('pop', prefs.pop, `${prefs.pop}%`);
    set('uv', prefs.uv, `${prefs.uv}`);
    for (const k of ['startHour', 'endHour', 'minHours']) controls[k].input.value = String(prefs[k]);
    const hint = form.querySelector('#time-hint');
    hint.textContent = isOvernight(prefs)
      ? `Overnight: ${hourLabel(prefs.startHour)} until ${hourLabel(prefs.endHour)} the next morning (${intervalLength(prefs)} h).`
      : `${intervalLength(prefs)} h each day. The end time is exclusive: until 19:00 means the last slot starts at 18:00.`;
  }

  // ---------- Results ----------
  function windowFacts(w) {
    const hs = w.hours.map((e) => e.hour);
    const pick = (f) => hs.map((x) => x[f]).filter(isNum);
    const t = pick('temp');
    return {
      tLo: Math.min(...t), tHi: Math.max(...t),
      rh: Math.max(...pick('rh')), wind: Math.max(...pick('wind')), pop: Math.max(...pick('pop')), uv: Math.max(...pick('uv')),
    };
  }

  function windowTitle(w, forecast) {
    const end = localParts(w.end, forecast.clock).hhmm;
    return `${weekdayLong(w.date)} ${dayMonth(w.date)}, ${w.startLabel}–${end}`;
  }

  // The window's place in its local day: night shading from is_day, the
  // window in petrol, ticks every six hours.
  function dayBar(w, forecast) {
    const d = forecast.days.find((x) => x.date === w.date);
    if (!d || d.hourStart < 0) return null;
    const hrs = forecast.hours.slice(d.hourStart, d.hourStart + d.hourCount);
    const W = 240;
    const cw = W / hrs.length;
    const kids = [s('rect', { class: 'wd-track', x: 0, y: 6, width: W, height: 6 })];
    hrs.forEach((x, k) => {
      if (x.isDay === 0) kids.push(s('rect', { class: 'wd-night', x: k * cw, y: 6, width: cw + 0.2, height: 6 }));
      if (x.t >= w.start && x.t < w.end) kids.push(s('rect', { class: 'wd-win', x: k * cw, y: 3, width: cw + 0.2, height: 12 }));
      if (x.hour % 6 === 0) {
        kids.push(s('line', { class: 'wd-tick', x1: k * cw, x2: k * cw, y1: 13, y2: 16 }));
      }
    });
    return s('svg', { class: 'wc-day', viewBox: `0 0 ${W} 18`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `Position in the day: ${localParts(w.start, forecast.clock).hhmm} to ${localParts(w.end, forecast.clock).hhmm}, night hours shaded` }, ...kids);
  }

  function reason(w) {
    const c = CONSTRAINTS.find((x) => x.key === w.tight?.key);
    const margin = Math.round(w.score * 100);
    const names = { temp: 'temperature', rh: 'humidity', wind: 'wind speed', pop: 'precipitation chance', uv: 'the UV index' };
    const tight = c ? ` Its tightest point is ${names[c.field]}${c.field === 'temp' ? ', which comes closest to an edge of your range' : ', which comes closest to your limit'}.` : '';
    return `All ${w.length} hour${w.length > 1 ? 's' : ''} pass every check, with an average comfort margin of ${margin}%.${tight}`;
  }

  function marginBar(score) {
    return h('span', { class: 'margin', role: 'img', 'aria-label': `Comfort margin ${Math.round(score * 100)}%` }, h('span', { style: { width: `${Math.round(score * 100)}%` } }));
  }

  function checksTable(e, st) {
    const f = st.units;
    const fmtVal = (field, v) => (field === 'temp' ? fmtTemp(v, f, 1) : field === 'wind' ? fmtWind(v, f) : field === 'uv' ? fmtUv(v) : fmtPct(v));
    const limit = (c) => (c.field === 'temp' ? fmtTemp(prefs[c.key], f) : c.field === 'wind' ? fmtWind(prefs[c.key], f) : c.field === 'uv' ? fmtUv(prefs[c.key]) : fmtPct(prefs[c.key]));
    return h('ul', { class: 'checks' }, ...CONSTRAINTS.map((c) => {
      const ck = e.checks.find((x) => x.key === c.key);
      const state = ck.pass === true ? 'pass' : ck.pass === false ? 'fail' : 'na';
      return h('li', { class: state },
        h('span', { class: 'mark', 'aria-hidden': 'true' }, state === 'pass' ? '✓' : state === 'fail' ? '✕' : '?'),
        h('span', null, c.label.replace('precipitation probability', 'precip. chance')),
        h('span', { class: 'num' }, ck.value === null ? 'missing' : fmtVal(c.field, ck.value), h('small', null, ` ${c.kind === 'min' ? '≥' : '≤'} ${limit(c)}`)),
        h('span', { class: 'sr-only' }, state === 'pass' ? 'passes' : state === 'fail' ? 'fails' : 'cannot be checked'));
    }));
  }

  function renderHeatmap(st) {
    const { forecast } = st;
    const winHours = new Set(result.windows.flatMap((w) => w.hours.map((e) => e.hour.t)));
    const byT = new Map(result.evals.map((e) => [e.hour.t, e]));
    const W = 24 * 22 + 52;
    const rowH = 22;
    const H = forecast.days.length * rowH + 22;
    const kids = [];
    for (let hr = 0; hr < 24; hr += 3) kids.push(s('text', { class: 'hm-axis', x: 52 + hr * 22 + 1, y: 12, text: hourLabel(hr) }));
    forecast.days.forEach((d, row) => {
      const y = 18 + row * rowH;
      kids.push(s('text', { class: 'hm-day', x: 0, y: y + 14, text: `${weekdayShort(d.date)} ${dayMonth(d.date).split(' ')[0]}` }));
      for (let k = 0; k < d.hourCount; k += 1) {
        const idx = d.hourStart + k;
        const e = byT.get(forecast.hours[idx].t);
        const hr = forecast.hours[idx].hour;
        const cls = e.status === 'match' && winHours.has(e.hour.t) ? 'win' : e.status;
        // Repeated local hours (DST) are drawn half-width side by side.
        const dup = k > 0 && forecast.hours[idx - 1].hour === hr;
        const nextDup = forecast.hours[idx + 1]?.hour === hr && forecast.hours[idx + 1]?.date === d.date;
        const x = 52 + hr * 22 + (dup ? 10 : 0);
        const w = dup || nextDup ? 9 : 20;
        kids.push(s('rect', {
          class: `hm ${cls}${idx === cursor ? ' cursor' : ''}`, x, y, width: w, height: rowH - 3, rx: 3,
          onclick: () => { cursor = idx; renderHeatmap(lastState); renderInspector(lastState); },
        }));
      }
    });
    const c = result.counts;
    const svg = s('svg', {
      viewBox: `0 0 ${W} ${H}`, class: 'heatmap-svg', role: 'img', preserveAspectRatio: 'xMinYMin meet',
      'aria-label': `Grid of ${forecast.hours.length} hours: ${c.match} match, ${c.miss} miss a limit, ${c.unknown} have missing data, ${c.past} are past, ${c.outside} are outside your hours.`,
    }, ...kids);
    replace(heat, svg);
    heat.setAttribute('aria-label', 'Hour grid. Use arrow keys to inspect individual hours.');
  }

  function renderInspector(st) {
    if (cursor === null) {
      replace(inspector, h('p', { class: 'muted small' }, 'Select an hour in the grid (or focus it and use the arrow keys) to see exactly which conditions pass.'));
      return;
    }
    const e = result.evals[cursor];
    const hr = e.hour;
    const label = { match: 'Matches every condition', miss: `Misses ${e.failed} condition${e.failed > 1 ? 's' : ''}`, unknown: 'Cannot be checked: some values are missing', past: 'This hour has already started or passed', outside: 'Outside your chosen hours' }[e.status];
    replace(inspector,
      h('div', { class: 'insp-head' }, h('strong', null, `${weekdayShort(hr.date)} ${dayMonth(hr.date)} · ${hr.hhmm}`), h('span', { class: `pill s-${e.status}` }, label)),
      checksTable(e, st));
  }

  heat.addEventListener('keydown', (ev) => {
    if (!lastState) return;
    const n = lastState.forecast.hours.length;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 24, ArrowUp: -24 }[ev.key];
    if (!step) return;
    ev.preventDefault();
    cursor = Math.max(0, Math.min(n - 1, (cursor ?? firstFutureIndex()) + step));
    renderHeatmap(lastState);
    renderInspector(lastState);
  });
  heat.addEventListener('focus', () => {
    if (cursor === null && lastState) { cursor = firstFutureIndex(); renderHeatmap(lastState); renderInspector(lastState); }
  });

  function firstFutureIndex() {
    const i = result.evals.findIndex((e) => e.status !== 'past');
    return i < 0 ? 0 : i;
  }

  function renderList(st) {
    const { forecast } = st;
    const ws = result.windows;
    const c = result.counts;
    compare = compare.filter((id) => ws.some((w) => w.id === id));
    if (!ws.length) {
      replace(headline, h('p', { class: 'result-count none' }, h('strong', null, 'No window fits every condition'), ` · ${c.match} single matching hour${c.match === 1 ? '' : 's'}, ${prefs.minHours} h needed in a row`));
      replace(list);
      renderNoMatch(st);
      replace(comparePanel);
      return;
    }
    replace(help);
    replace(headline,
      h('p', { class: 'result-count' }, h('strong', null, `${ws.length} window${ws.length > 1 ? 's' : ''}`), ` of ${prefs.minHours} h or more · ${c.match} matching hours`),
      h('p', { class: 'muted small' }, 'Ranked by average comfort margin (how far inside your limits the hours sit), then by length, then earliest first.'));
    const shown = showAll ? ws : ws.slice(0, SHOW);
    replace(list, ...shown.map((w, i) => {
      const f = windowFacts(w);
      const checked = compare.includes(w.id);
      return h('article', { class: `window-card${i === 0 ? ' best' : ''}` },
        h('div', { class: 'wc-rank', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
        h('div', { class: 'wc-body' },
          h('h4', null, windowTitle(w, forecast), h('span', { class: 'wc-len' }, `${w.length} h`)),
          h('p', { class: 'wc-facts' },
            h('span', null, `${fmtTemp(f.tLo, st.units)}–${fmtTemp(f.tHi, st.units)}`),
            h('span', null, `humidity ≤ ${fmtPct(f.rh)}`),
            h('span', null, `wind ≤ ${fmtWind(f.wind, st.units)}`),
            h('span', null, `precip. ≤ ${fmtPct(f.pop)}`),
            h('span', null, `UV ≤ ${fmtUv(f.uv)}`)),
          dayBar(w, forecast),
          h('div', { class: 'wc-margin' }, marginBar(w.score), h('span', { class: 'small' }, `${Math.round(w.score * 100)}% margin`),
            h('button', { type: 'button', class: 'btn mini ghost wc-look', onclick: () => ctx.showMoment(forecast.hours.findIndex((x) => x.t === w.start)) }, 'See it in the lens')),
          h('p', { class: 'wc-why' }, i === 0 ? h('strong', null, 'Why first: ') : null, reason(w)),
          h('details', { class: 'wc-hours' }, h('summary', null, 'Hour-by-hour checks'),
            ...w.hours.map((e) => h('div', { class: 'wc-hour' }, h('p', { class: 'wc-hour-t' }, e.hour.hhmm), checksTable(e, st)))),
          h('label', { class: 'compare-toggle' },
            h('input', { type: 'checkbox', checked: checked ? true : null, onchange: (ev) => toggleCompare(w.id, ev.target.checked) }),
            ' Compare')));
    }), ws.length > SHOW ? h('button', { type: 'button', class: 'btn ghost', onclick: () => { showAll = !showAll; renderList(lastState); } }, showAll ? 'Show fewer' : `Show all ${ws.length} windows`) : null);
    renderCompare(st);
  }

  function toggleCompare(id, on) {
    compare = compare.filter((x) => x !== id);
    if (on) compare.push(id);
    if (compare.length > 2) compare = compare.slice(-2);
    renderList(lastState);
  }

  function renderCompare(st) {
    const ws = compare.map((id) => result.windows.find((w) => w.id === id)).filter(Boolean);
    if (ws.length < 2) {
      replace(comparePanel, ws.length === 1 ? h('p', { class: 'muted small' }, 'Tick one more window to compare them side by side.') : null);
      return;
    }
    const [a, b] = ws.map((w) => ({ w, f: windowFacts(w) }));
    const row = (label, va, vb, better) => h('tr', null, h('th', { scope: 'row' }, label), h('td', { class: better === 'a' ? 'win' : '' }, va), h('td', { class: better === 'b' ? 'win' : '' }, vb));
    const lower = (x, y) => (x < y ? 'a' : y < x ? 'b' : '');
    replace(comparePanel, h('div', { class: 'panel' },
      h('h3', null, 'Side by side'),
      h('div', { class: 'table-scroll' }, h('table', { class: 'compare-table' },
        h('thead', null, h('tr', null, h('td'), h('th', { scope: 'col' }, windowTitle(a.w, st.forecast)), h('th', { scope: 'col' }, windowTitle(b.w, st.forecast)))),
        h('tbody', null,
          row('Length', `${a.w.length} h`, `${b.w.length} h`, a.w.length > b.w.length ? 'a' : b.w.length > a.w.length ? 'b' : ''),
          row('Temperature', `${fmtTemp(a.f.tLo, st.units)}–${fmtTemp(a.f.tHi, st.units)}`, `${fmtTemp(b.f.tLo, st.units)}–${fmtTemp(b.f.tHi, st.units)}`, ''),
          row('Highest humidity', fmtPct(a.f.rh), fmtPct(b.f.rh), lower(a.f.rh, b.f.rh)),
          row('Strongest wind', fmtWind(a.f.wind, st.units), fmtWind(b.f.wind, st.units), lower(a.f.wind, b.f.wind)),
          row('Highest precip. chance', fmtPct(a.f.pop), fmtPct(b.f.pop), lower(a.f.pop, b.f.pop)),
          row('Highest UV', fmtUv(a.f.uv), fmtUv(b.f.uv), lower(a.f.uv, b.f.uv)),
          row('Comfort margin', `${Math.round(a.w.score * 100)}%`, `${Math.round(b.w.score * 100)}%`, a.w.score > b.w.score ? 'a' : b.w.score > a.w.score ? 'b' : ''))),
      h('p', { class: 'muted small' }, 'Highlighted cells are the more comfortable of the two for that row. Neither window is a guarantee.'))));
  }

  function renderNoMatch(st) {
    const br = failureBreakdown(result.evals);
    const rel = suggestRelaxations(st.forecast.hours, prefs, ctx.now()).slice(0, 3);
    const fmtLimit = (key, v) => {
      const c = CONSTRAINTS.find((x) => x.key === key);
      return c.field === 'temp' ? fmtTemp(v, st.units, 1) : c.field === 'wind' ? fmtWind(v, st.units) : c.field === 'uv' ? fmtUv(v) : fmtPct(v);
    };
    const top = CONSTRAINTS.map((c) => ({ c, n: br.counts[c.key] })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    replace(help, h('div', { class: 'panel' },
      h('h3', null, 'Nothing fits, and that is an answer too'),
      h('p', null, 'Weather Window will not force a recommendation. Here is what stands in the way across the future hours inside your time interval:'),
      br.considered === 0
        ? h('p', { class: 'muted' }, 'No future forecast hours fall inside your time interval. Try a wider interval.')
        : h('ul', { class: 'blockers' }, ...top.map(({ c, n }) => h('li', null, h('span', { class: 'bar', style: { width: `${Math.round((n / br.considered) * 100)}%` } }), h('span', null, `${c.label}: rules out ${n} of ${br.considered} hours`)))),
      rel.length ? h('div', { class: 'relax' },
        h('p', null, h('strong', null, 'Relax one condition at a time:')),
        ...rel.map((r) => {
          const when = localParts(r.start, st.forecast.clock);
          return h('button', {
            type: 'button', class: 'relax-btn',
            onclick: () => { ctx.setPrefs({ ...prefs, [r.key]: r.to }, 'custom'); announce(`${r.label} changed to ${fmtLimit(r.key, r.to)}.`); },
          }, h('span', null, `${r.label}: ${fmtLimit(r.key, r.from)} → ${fmtLimit(r.key, r.to)}`), h('small', null, `first opens a window on ${when.weekday} at ${when.hhmm}`));
        })) : h('p', { class: 'muted' }, 'No single change opens a window. Try widening your time interval or shortening the minimum duration.')));
  }

  function renderNotice(st) {
    const fr = ctx.freshness();
    if (st.source === 'demo') {
      replace(notice, h('p', { class: 'notice synthetic' }, icon('info', { size: 16 }), h('span', null, h('strong', null, 'Demo results. '), 'These windows come from the synthetic week and treat Mon 19 Oct 2026, 09:00 as “now”. They are not recommendations for any real place.')));
    } else if (fr.key === 'stale' || fr.key === 'expired') {
      replace(notice, h('p', { class: 'notice warn' }, icon('info', { size: 16 }), h('span', null, h('strong', null, `${fr.label} forecast. `), 'Refresh before relying on these windows. Hours already past are excluded.')));
    } else replace(notice);
  }

  async function copyPlan() {
    const st = lastState;
    if (!st || !result) return;
    const fr = ctx.freshness();
    const u = st.units;
    const lines = [
      `Weather Window plan: ${st.place.name}${st.source === 'demo' ? ' (SYNTHETIC DEMO, not a real forecast)' : ''}`,
      `Data: ${fr.label}${ctx.fetchedLabel() ? `, retrieved ${ctx.fetchedLabel()}` : ''}. Times are local (${st.forecast.timezone}).`,
      `Conditions: ${summaryText(u)}`,
      '',
    ];
    if (result.windows.length) {
      result.windows.slice(0, 3).forEach((w, i) => {
        const f = windowFacts(w);
        lines.push(`${i + 1}. ${windowTitle(w, st.forecast)} (${w.length} h): ${fmtTemp(f.tLo, u)}–${fmtTemp(f.tHi, u)}, humidity ≤ ${fmtPct(f.rh)}, wind ≤ ${fmtWind(f.wind, u)}, precip. chance ≤ ${fmtPct(f.pop)}, UV ≤ ${fmtUv(f.uv)}`);
      });
    } else lines.push('No window met every condition.');
    lines.push('', 'Forecasts can change. Thresholds are personal preferences, not safety limits. Weather data: Open-Meteo (CC BY 4.0).');
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Plan summary copied to the clipboard.', 'ok');
    } catch {
      toast('Copying is blocked in this browser. The summary was not copied.', 'error');
    }
  }

  function summaryText(u) {
    const sys = SYSTEMS[u];
    return `${hourLabel(prefs.startHour)}–${hourLabel(prefs.endHour)}${isOvernight(prefs) ? ' (overnight)' : ''}, at least ${prefs.minHours} h in a row; ${round(tempTo(prefs.tempMin, u))}–${round(tempTo(prefs.tempMax, u))}${sys.temp}; humidity ≤ ${prefs.rh}%; wind ≤ ${round(windTo(prefs.wind, u))} ${sys.wind}; precip. chance ≤ ${prefs.pop}%; UV ≤ ${prefs.uv}.`;
  }

  return {
    update(st) {
      lastState = st;
      units = st.units;
      prefs = st.prefs;
      renderProfiles(st.profile);
      syncControls();
      renderNotice(st);
      const v = validatePrefs(prefs);
      if (!v.ok) {
        replace(errors, ...v.errors.map((e) => h('p', null, e.message)));
        replace(summary);
        replace(headline, h('p', { class: 'result-count none' }, 'Fix the highlighted conditions to see results.'));
        replace(list); replace(help); replace(comparePanel);
        return;
      }
      replace(errors);
      summary.textContent = summaryText(units);
      if (!st.forecast) return;
      result = findWindows(st.forecast.hours, prefs, ctx.now());
      if (cursor !== null && cursor >= st.forecast.hours.length) cursor = null;
      renderHeatmap(st);
      renderInspector(st);
      renderList(st);
    },
    reset() {
      cursor = null;
      compare = [];
      showAll = false;
    },
  };
}
