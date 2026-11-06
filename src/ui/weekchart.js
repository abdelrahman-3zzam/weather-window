// The week ribbon: all 168 forecast hours on one axis, with night shading,
// a "now" marker and a selectable day. Missing values break the line rather
// than being drawn as zero. Keyboard: ←/→ move by hour, PageUp/PageDown or
// Home/End move by day, Enter shows the focused hour in the lens.

import { s, h, replace } from './dom.js';
import { niceDomain, linear, brokenLine, brokenArea } from './scale.js';
import { isNum, round } from '../core/num.js';
import { tempTo, windTo, SYSTEMS } from '../core/units.js';
import { weekdayShort, dayMonth } from '../core/time.js';
import { describeCode } from '../core/weathercodes.js';

export function chartMetrics(units) {
  return {
    temp: { label: 'Temperature', unit: SYSTEMS[units].temp, get: (x) => tempTo(x.temp, units), kind: 'line', fixed: null, digits: 0, cls: 'm-temp' },
    pop: { label: 'Precipitation chance', unit: '%', get: (x) => x.pop, kind: 'bars', fixed: [0, 100], digits: 0, cls: 'm-pop' },
    rh: { label: 'Humidity', unit: '%', get: (x) => x.rh, kind: 'line', fixed: [0, 100], digits: 0, cls: 'm-rh' },
    wind: { label: 'Wind', unit: SYSTEMS[units].wind, get: (x) => windTo(x.wind, units), kind: 'line', fixed: 'zero', digits: 0, cls: 'm-wind' },
    uv: { label: 'UV index', unit: '', get: (x) => x.uv, kind: 'area', fixed: 'uv', digits: 1, cls: 'm-uv' },
  };
}

export function createWeekChart(host, { onSelectDay, onSelectHour }) {
  const wrap = h('div', { class: 'weekchart' });
  const svgHost = h('div', { class: 'weekchart-svg', tabindex: '0', role: 'group' });
  const tip = h('div', { class: 'chart-tip', 'aria-hidden': 'true' });
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  wrap.append(svgHost, tip, live);
  host.append(wrap);

  let props = null;
  let focusIndex = null;
  let geom = null;

  function render() {
    if (!props) return;
    const { forecast, metric, units, dayIndex, now } = props;
    const M = chartMetrics(units)[metric];
    const hours = forecast.hours;
    const width = Math.max(320, Math.round(svgHost.clientWidth || 800));
    const compact = width < 560;
    const height = compact ? 220 : 260;
    const pad = { l: compact ? 34 : 42, r: 10, t: 34, b: 24 };
    const vals = hours.map(M.get);
    const present = vals.filter(isNum);

    let dom;
    if (M.fixed === 'zero') dom = niceDomain(0, Math.max(10, ...present), 4);
    else if (M.fixed === 'uv') dom = niceDomain(0, Math.max(8, ...present), 4);
    else if (M.fixed) dom = niceDomain(M.fixed[0], M.fixed[1], 4);
    else dom = present.length ? niceDomain(Math.min(...present) - 1, Math.max(...present) + 1, 4) : niceDomain(0, 1);

    const x = linear(forecast.span.start, forecast.span.end, pad.l, width - pad.r);
    const y = linear(dom.lo, dom.hi, height - pad.b, pad.t);
    geom = { x, y, pad, width, height };

    const g = [];
    // Night shading, from the hourly is_day flag.
    hours.forEach((hr) => {
      if (hr.isDay === 0) g.push(s('rect', { class: 'night', x: x(hr.t), y: pad.t, width: x(hr.t + 3600) - x(hr.t) + 0.5, height: height - pad.t - pad.b }));
    });
    // Grid and axis labels.
    for (const t of dom.ticks) {
      g.push(s('line', { class: 'grid', x1: pad.l, x2: width - pad.r, y1: y(t), y2: y(t) }));
      g.push(s('text', { class: 'axis', x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end', text: `${t}` }));
    }
    g.push(s('text', { class: 'axis unit', x: pad.l - 6, y: pad.t - 10, 'text-anchor': 'end', text: M.unit || 'UV' }));

    // Day columns: label, separator, selection.
    forecast.days.forEach((d, i) => {
      if (d.hourStart < 0) return;
      const x0 = x(hours[d.hourStart].t);
      const x1 = x(hours[d.hourStart + d.hourCount - 1].t + 3600);
      const selected = i === dayIndex;
      if (selected) g.push(s('rect', { class: 'day-selected', x: x0, y: pad.t, width: x1 - x0, height: height - pad.t - pad.b, rx: 3 }));
      if (i > 0) g.push(s('line', { class: 'day-sep', x1: x0, x2: x0, y1: pad.t - 22, y2: height - pad.b }));
      g.push(s('text', { class: `day-label${selected ? ' on' : ''}`, x: (x0 + x1) / 2, y: pad.t - 14, 'text-anchor': 'middle', text: compact ? weekdayShort(d.date).slice(0, 2) : `${weekdayShort(d.date)} ${dayMonth(d.date).split(' ')[0]}` }));
      g.push(s('rect', {
        class: 'day-hit', x: x0, y: 0, width: x1 - x0, height,
        onclick: (e) => (onSelectHour ? onSelectHour(indexAt(e.clientX)) : onSelectDay(i)),
      }));
    });

    // Series.
    const pts = hours.map((hr, i) => (isNum(vals[i]) ? [x(hr.t + 1800), y(vals[i])] : null));
    if (M.kind === 'bars') {
      hours.forEach((hr, i) => {
        if (!isNum(vals[i])) return;
        const bw = Math.max(1, x(hr.t + 3600) - x(hr.t) - 0.6);
        g.push(s('rect', { class: `bar ${M.cls}`, x: x(hr.t) + 0.3, y: y(vals[i]), width: bw, height: Math.max(0, y(dom.lo) - y(vals[i])) }));
      });
    } else {
      if (M.kind === 'area' || metric === 'temp') g.push(s('path', { class: `area ${M.cls}`, d: brokenArea(pts, y(dom.lo)) }));
      g.push(s('path', { class: `line ${M.cls}`, d: brokenLine(pts) }));
    }

    // Missing-data hatching.
    hours.forEach((hr, i) => {
      if (!isNum(vals[i])) g.push(s('rect', { class: 'missing', x: x(hr.t), y: pad.t, width: x(hr.t + 3600) - x(hr.t), height: height - pad.t - pad.b }));
    });

    // Now marker.
    if (now >= forecast.span.start && now <= forecast.span.end) {
      g.push(s('line', { class: 'now', x1: x(now), x2: x(now), y1: pad.t - 4, y2: height - pad.b }));
      g.push(s('text', { class: 'now-label', x: x(now) + 4, y: height - pad.b - 6, text: 'now' }));
    }

    // The hour shown in the lens.
    const sel = Number.isInteger(props.hourIndex) ? hours[props.hourIndex] : null;
    if (sel) {
      const cx = x(sel.t + 1800);
      g.push(s('line', { class: 'hour-mark', x1: cx, x2: cx, y1: pad.t - 6, y2: height - pad.b }));
      g.push(s('path', { class: 'hour-mark-tip', d: `M${cx - 4},${pad.t - 8} h8 l-4,6 Z` }));
    }

    const cross = s('line', { class: 'cross', x1: 0, x2: 0, y1: pad.t, y2: height - pad.b, visibility: 'hidden' });
    const dot = s('circle', { class: `cross-dot ${M.cls}`, r: 4, cx: 0, cy: 0, visibility: 'hidden' });
    g.push(cross, dot);
    geom.cross = cross;
    geom.dot = dot;

    const missing = vals.length - present.length;
    const svg = s('svg', {
      viewBox: `0 0 ${width} ${height}`, width, height, class: 'weekchart-plot', role: 'img',
      'aria-label': `${M.label} for each forecast hour, ${forecast.days.length} days. Range ${present.length ? `${round(Math.min(...present), M.digits)} to ${round(Math.max(...present), M.digits)} ${M.unit}` : 'unavailable'}.${missing ? ` ${missing} hours missing.` : ''} Use arrow keys to read hours.`,
    }, ...g);
    replace(svgHost, svg);
    svgHost.setAttribute('aria-label', `${M.label} chart. Arrow keys move by hour; Page Up and Page Down move by day; Enter shows that hour in the lens.`);
    if (focusIndex !== null) showTip(focusIndex);
  }

  function showTip(i) {
    if (!props || !geom) return;
    const { forecast, metric, units } = props;
    const hr = forecast.hours[i];
    if (!hr) return;
    const M = chartMetrics(units)[metric];
    const v = M.get(hr);
    const cx = geom.x(hr.t + 1800);
    geom.cross.setAttribute('x1', cx);
    geom.cross.setAttribute('x2', cx);
    geom.cross.setAttribute('visibility', 'visible');
    if (isNum(v)) {
      geom.dot.setAttribute('cx', cx);
      geom.dot.setAttribute('cy', geom.y(v));
      geom.dot.setAttribute('visibility', 'visible');
    } else geom.dot.setAttribute('visibility', 'hidden');
    const value = isNum(v) ? `${round(v, M.digits)}${M.unit === '%' ? '%' : M.unit ? ` ${M.unit}` : ''}` : 'missing';
    const cond = describeCode(hr.code).label;
    replace(tip,
      h('strong', null, `${weekdayShort(hr.date)} ${hr.hhmm}`),
      h('span', null, `${M.label}: ${value}`),
      h('span', { class: 'muted' }, cond));
    const left = Math.min(Math.max(cx - 70, 4), geom.width - 150);
    tip.style.transform = `translate(${left}px, 0)`;
    tip.classList.add('show');
    live.textContent = `${weekdayShort(hr.date)} ${hr.hhmm}, ${M.label} ${value}, ${cond}.`;
  }

  function hideTip() {
    tip.classList.remove('show');
    geom?.cross.setAttribute('visibility', 'hidden');
    geom?.dot.setAttribute('visibility', 'hidden');
  }

  function indexAt(clientX) {
    const rect = svgHost.getBoundingClientRect();
    const px = clientX - rect.left;
    const hours = props.forecast.hours;
    const span = props.forecast.span;
    const t = span.start + ((px - geom.pad.l) / (geom.width - geom.pad.l - geom.pad.r)) * (span.end - span.start);
    return Math.max(0, Math.min(hours.length - 1, Math.floor((t - span.start) / 3600)));
  }

  svgHost.addEventListener('pointermove', (e) => { if (props && geom) showTip(indexAt(e.clientX)); });
  svgHost.addEventListener('pointerleave', () => { if (focusIndex === null) hideTip(); });
  svgHost.addEventListener('focus', () => {
    if (!props) return;
    const d = props.forecast.days[props.dayIndex];
    focusIndex = focusIndex ?? Math.max(0, d.hourStart + 12 < props.forecast.hours.length ? d.hourStart + 12 : 0);
    showTip(focusIndex);
  });
  svgHost.addEventListener('blur', () => { focusIndex = null; hideTip(); });
  svgHost.addEventListener('keydown', (e) => {
    if (!props) return;
    const n = props.forecast.hours.length;
    const step = { ArrowRight: 1, ArrowLeft: -1, PageDown: 24, PageUp: -24 }[e.key];
    if (step) {
      focusIndex = Math.max(0, Math.min(n - 1, (focusIndex ?? 0) + step));
      showTip(focusIndex);
      e.preventDefault();
    } else if (e.key === 'Home' || e.key === 'End') {
      focusIndex = e.key === 'Home' ? 0 : n - 1;
      showTip(focusIndex);
      e.preventDefault();
    } else if (e.key === 'Enter' && focusIndex !== null) {
      const hr = props.forecast.hours[focusIndex];
      const di = props.forecast.days.findIndex((d) => d.date === hr.date);
      if (onSelectHour) onSelectHour(focusIndex);
      else if (di >= 0) onSelectDay(di);
      e.preventDefault();
    }
  });

  let raf = 0;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }) : null;
  ro?.observe(svgHost);

  return {
    update(next) {
      props = next;
      render();
    },
    destroy() {
      ro?.disconnect();
    },
  };
}
