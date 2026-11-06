// The day dial: the instrument bezel around the lens.
//
// One turn of the bezel is one local day (00:00 at the top, clockwise). Each
// hour carries a radial temperature mark on the week's shared scale, a dot
// whose size follows the precipitation chance, and the daylight arc runs
// between the real sunrise and sunset. The solar index marks the hour shown
// in the lens; drag it around the ring, or focus the dial and use the arrow
// keys, to move through the day (and on into the next).

import { s, replace } from './dom.js';
import { isNum, round } from '../core/num.js';
import { tempColor, rgbCss } from '../core/encoding.js';
import { tempTo, SYSTEMS } from '../core/units.js';
import { weekdayShort } from '../core/time.js';

const R_LENS = 66;
const R_IN = 69;
const R_TEMP0 = 78;
const R_TEMP1 = 92;
const R_POP = 98;
const R_LABEL = 106;

const polar = (deg, r) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [Math.cos(a) * r, Math.sin(a) * r];
};
const f1 = (v) => v.toFixed(2);

function arc(r, a0, a1) {
  const [x0, y0] = polar(a0, r);
  const [x1, y1] = polar(a1, r);
  const large = ((a1 - a0 + 360) % 360) > 180 ? 1 : 0;
  return `M${f1(x0)},${f1(y0)} A${r},${r} 0 ${large} 1 ${f1(x1)},${f1(y1)}`;
}

export function createDial(host, { onScrub }) {
  const svg = s('svg', { class: 'dial', viewBox: '-112 -112 224 224', 'aria-hidden': 'true' });
  const ctl = document.createElement('div');
  ctl.className = 'dial-control';
  ctl.tabIndex = 0;
  ctl.setAttribute('role', 'slider');
  ctl.setAttribute('aria-label', 'Hour shown in the lens');
  host.append(svg, ctl);

  let props = null;
  let dragging = false;

  function dayHours() {
    const { forecast, hourIndex } = props;
    const hr = forecast.hours[hourIndex];
    const day = forecast.days.find((d) => d.date === hr.date);
    if (!day || day.hourStart < 0) return null;
    return { day, start: day.hourStart, count: day.hourCount };
  }

  const angleOf = (i, count) => (i / count) * 360;

  function render() {
    if (!props) return;
    const { forecast, hourIndex, units, now } = props;
    const dh = dayHours();
    if (!dh) { replace(svg); return; }
    const { day, start, count } = dh;
    const temps = forecast.hours.map((x) => x.temp).filter(isNum);
    const lo = temps.length ? Math.min(...temps) : 0;
    const hi = temps.length ? Math.max(...temps) : 1;
    const kids = [];

    kids.push(s('circle', { class: 'dial-ring', r: R_IN }));
    kids.push(s('circle', { class: 'dial-ring faint', r: R_TEMP1 + 1.5 }));

    // Daylight arc between the real sunrise and sunset of this local date.
    const tAngle = (t) => angleOf((t - forecast.hours[start].t) / 3600, count);
    if (isNum(day.sunrise) && isNum(day.sunset) && day.sunset > day.sunrise) {
      const a0 = Math.max(0, tAngle(day.sunrise));
      const a1 = Math.min(359.9, tAngle(day.sunset));
      if (a1 > a0) {
        kids.push(s('path', { class: 'dial-daylight', d: arc(R_IN, a0, a1) }));
        for (const [a, label] of [[a0, 'sunrise'], [a1, 'sunset']]) {
          const [x, y] = polar(a, R_IN);
          kids.push(s('circle', { class: 'dial-sun-mark', cx: f1(x), cy: f1(y), r: 1.6 }, s('title', { text: label })));
        }
      }
    }

    for (let i = 0; i < count; i += 1) {
      const hr = forecast.hours[start + i];
      const a = angleOf(i + 0.5, count);
      const major = hr.hour % 6 === 0;
      const [tx0, ty0] = polar(angleOf(i, count), R_IN + 0.8);
      const [tx1, ty1] = polar(angleOf(i, count), R_IN + (major ? 6 : 3));
      kids.push(s('line', { class: `dial-tick${major ? ' major' : ''}`, x1: f1(tx0), y1: f1(ty0), x2: f1(tx1), y2: f1(ty1) }));
      if (major) {
        const [lx, ly] = polar(angleOf(i, count), R_LABEL);
        kids.push(s('text', { class: 'dial-label', x: f1(lx), y: f1(ly + 2.4), 'text-anchor': 'middle', text: String(hr.hour).padStart(2, '0') }));
      }
      if (isNum(hr.temp)) {
        const k = (hr.temp - lo) / (hi - lo || 1);
        const [x0, y0] = polar(a, R_TEMP0);
        const [x1, y1] = polar(a, R_TEMP0 + 2 + k * (R_TEMP1 - R_TEMP0 - 2));
        kids.push(s('line', { class: 'dial-temp', x1: f1(x0), y1: f1(y0), x2: f1(x1), y2: f1(y1), stroke: rgbCss(tempColor(hr.temp)) }));
      } else {
        const [x0, y0] = polar(a, R_TEMP0);
        kids.push(s('circle', { class: 'dial-missing', cx: f1(x0), cy: f1(y0), r: 0.9 }));
      }
      if (isNum(hr.pop) && hr.pop > 0) {
        const [px, py] = polar(a, R_POP);
        kids.push(s('circle', { class: 'dial-pop', cx: f1(px), cy: f1(py), r: f1(0.5 + (hr.pop / 100) * 2.1) }));
      }
      if (hr.t + 3600 <= now) {
        const [x0, y0] = polar(a, R_TEMP0 - 2.5);
        kids.push(s('circle', { class: 'dial-past', cx: f1(x0), cy: f1(y0), r: 0.6 }));
      }
    }

    // Now marker, when "now" falls on this day.
    const nowI = (now - forecast.hours[start].t) / 3600;
    if (nowI >= 0 && nowI < count) {
      const [x0, y0] = polar(angleOf(nowI, count), R_IN - 3);
      const [x1, y1] = polar(angleOf(nowI, count), R_IN + 1);
      kids.push(s('line', { class: 'dial-now', x1: f1(x0), y1: f1(y0), x2: f1(x1), y2: f1(y1) }));
    }

    // The solar index for the selected hour.
    const sel = hourIndex - start;
    const a = angleOf(sel + 0.5, count);
    const [ix0, iy0] = polar(a, R_LENS + 1);
    const [ix1, iy1] = polar(a, R_TEMP1 + 3);
    const [tx, ty] = polar(a, R_TEMP1 + 6.5);
    const g = s('g', { class: 'dial-index' },
      s('line', { x1: f1(ix0), y1: f1(iy0), x2: f1(ix1), y2: f1(iy1) }),
      s('path', { d: `M0,-3.6 L3.4,2.6 L-3.4,2.6 Z`, transform: `translate(${f1(tx)},${f1(ty)}) rotate(${f1(a + 180)})` }));
    kids.push(g);

    // A transparent ring that takes pointer input without covering the lens.
    kids.push(s('path', {
      class: 'dial-hit',
      d: `M0,-112 A112,112 0 1 1 0,112 A112,112 0 1 1 0,-112 Z M0,-${R_LENS + 2} A${R_LENS + 2},${R_LENS + 2} 0 1 0 0,${R_LENS + 2} A${R_LENS + 2},${R_LENS + 2} 0 1 0 0,-${R_LENS + 2} Z`,
      'fill-rule': 'evenodd',
    }));
    replace(svg, ...kids);

    const hr = forecast.hours[hourIndex];
    ctl.setAttribute('aria-valuemin', '0');
    ctl.setAttribute('aria-valuemax', String(count - 1));
    ctl.setAttribute('aria-valuenow', String(sel));
    const t = isNum(hr.temp) ? `${round(tempTo(hr.temp, units))} ${SYSTEMS[units].temp}` : 'temperature missing';
    ctl.setAttribute('aria-valuetext', `${weekdayShort(hr.date)} ${hr.hhmm}, ${t}${isNum(hr.pop) ? `, precipitation chance ${round(hr.pop)}%` : ''}`);
  }

  function indexFromPoint(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const deg = ((Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI + 90 + 360) % 360;
    const dh = dayHours();
    if (!dh) return null;
    return dh.start + Math.min(dh.count - 1, Math.floor((deg / 360) * dh.count));
  }

  // On touch screens the ring must not swallow page scrolling: a drag only
  // scrubs when it starts on the solar index; a tap anywhere on the ring jumps.
  let tap = null;
  function nearIndex(clientX, clientY) {
    const i = indexFromPoint(clientX, clientY);
    const dh = dayHours();
    if (i === null || !dh) return false;
    const diff = Math.abs(i - props.hourIndex);
    return Math.min(diff, dh.count - diff) <= Math.max(1, Math.round(dh.count / 12));
  }
  svg.addEventListener('pointerdown', (e) => {
    if (!e.target.classList?.contains('dial-hit') || !props) return;
    if (e.pointerType === 'touch' && !nearIndex(e.clientX, e.clientY)) {
      tap = { x: e.clientX, y: e.clientY };
      return;
    }
    dragging = true;
    svg.setPointerCapture?.(e.pointerId);
    svg.classList.add('scrubbing');
    const i = indexFromPoint(e.clientX, e.clientY);
    if (i !== null && i !== props.hourIndex) onScrub(i, 'pointer');
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging || !props) return;
    const i = indexFromPoint(e.clientX, e.clientY);
    if (i !== null && i !== props.hourIndex) onScrub(i, 'pointer');
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    svg.classList.remove('scrubbing');
    try { svg.releasePointerCapture?.(e.pointerId); } catch { /* released */ }
  };
  svg.addEventListener('pointerup', (e) => {
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10) {
      const i = indexFromPoint(e.clientX, e.clientY);
      if (i !== null && i !== props.hourIndex) onScrub(i, 'pointer');
    }
    tap = null;
    end(e);
  });
  svg.addEventListener('pointercancel', (e) => { tap = null; end(e); });

  ctl.addEventListener('keydown', (e) => {
    if (!props) return;
    const n = props.forecast.hours.length;
    const dh = dayHours();
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = props.hourIndex + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = props.hourIndex - 1;
    else if (e.key === 'PageUp') next = props.hourIndex - 6;
    else if (e.key === 'PageDown') next = props.hourIndex + 6;
    else if (e.key === 'Home' && dh) next = dh.start;
    else if (e.key === 'End' && dh) next = dh.start + dh.count - 1;
    if (next === null) return;
    e.preventDefault();
    next = Math.max(0, Math.min(n - 1, next));
    if (next !== props.hourIndex) onScrub(next, 'key');
  });

  return {
    update(next) {
      props = next;
      render();
    },
    focus() { ctl.focus(); },
  };
}

/** The local hour index for "now", or -1 when now is outside the forecast. */
export function hourIndexAt(forecast, t) {
  return forecast.hours.findIndex((x) => t >= x.t && t < x.t + 3600);
}

