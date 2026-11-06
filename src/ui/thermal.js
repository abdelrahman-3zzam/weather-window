// Thermal relief: the week's hourly temperatures as a landscape.
//
// Rows are days, columns are local hours. Each forecast hour sets the height
// of the terrain at its row; the field between rows and between hours is a
// bilinear blend, drawn as posterised thermal bands with contour lines and a
// hill-shade so warm afternoons rise as ridges and cold dawns sink as
// valleys. The blend is an artistic reading aid, so the loupe under the
// cursor shows the true values: the raw hourly cells, unblended, with numbers.
//
// Interaction: hover or touch to move the loupe, click or Enter to show that
// hour in the lens, arrow keys to walk hours (←/→) and days (↑/↓).

import { h, replace, reducedMotion } from './dom.js';
import { isNum, round } from '../core/num.js';
import { tempColor, rgbCss } from '../core/encoding.js';
import { tempTo, tempDeltaTo, SYSTEMS } from '../core/units.js';
import { weekdayShort, dayMonth } from '../core/time.js';

/** 7 × 24 grid of hourly temperatures by local hour; null where unknown. */
export function thermalGrid(forecast) {
  return forecast.days.map((d) => {
    const row = new Array(24).fill(null);
    const idx = new Array(24).fill(-1);
    if (d.hourStart < 0) return { row, idx, date: d.date };
    for (let k = 0; k < d.hourCount; k += 1) {
      const j = d.hourStart + k;
      const x = forecast.hours[j];
      if (x.hour < 0 || x.hour > 23) continue;
      // On a 25-hour day the repeated hour keeps its first value.
      if (idx[x.hour] === -1) { row[x.hour] = isNum(x.temp) ? x.temp : null; idx[x.hour] = j; }
    }
    return { row, idx, date: d.date };
  });
}

/** Catmull-Rom sample of a series at fractional index f; NaN if a tap is missing. */
function cubic(arr, f) {
  const n = arr.length;
  let i = Math.floor(f);
  if (i < 0) i = 0; else if (i > n - 1) i = n - 1;
  const t = f - i;
  const p1 = arr[i];
  if (t === 0 || i === n - 1) return isNum(p1) ? p1 : NaN;
  const p2 = arr[i + 1];
  if (!isNum(p1) || !isNum(p2)) return NaN;
  const a0 = i > 0 ? arr[i - 1] : p1;
  const a3 = i + 2 < n ? arr[i + 2] : p2;
  const q0 = isNum(a0) ? a0 : p1;
  const q3 = isNum(a3) ? a3 : p2;
  return 0.5 * ((2 * p1) + (-q0 + p2) * t + (2 * q0 - 5 * p1 + 4 * p2 - q3) * t * t + (-q0 + 3 * p1 - 3 * p2 + q3) * t * t * t);
}

function bandStep(rangeDisplay) {
  return rangeDisplay > 30 ? 4 : rangeDisplay > 18 ? 2 : rangeDisplay > 8 ? 1 : 0.5;
}

export function createThermal(host, { onSelect }) {
  const wrap = h('div', { class: 'thermal' });
  const base = h('canvas', { class: 'thermal-base', 'aria-hidden': 'true' });
  const over = h('canvas', { class: 'thermal-over', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'thermal-stage', tabindex: '0', role: 'application', 'aria-roledescription': 'thermal relief', 'aria-label': 'Thermal relief of the week. Arrow keys move by hour and day; Enter shows the hour in the lens.' }, base, over);
  const legend = h('div', { class: 'thermal-legend' });
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  wrap.append(stage, legend, live);
  host.append(wrap);

  let props = null;
  let grid = null;
  let geom = null;
  let fieldCache = null;
  let cursor = null; // { d, hr }
  let pointer = null; // { x, y } in CSS px
  let revealed = false;
  let raf = 0;

  const PAD = { l: 64, r: 10, t: 26, b: 8 };

  function layout() {
    const w = Math.max(300, Math.round(stage.clientWidth || 800));
    const hgt = Math.round(Math.max(230, Math.min(380, w * 0.34)));
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    for (const c of [base, over]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(hgt * dpr);
      c.style.height = `${hgt}px`;
    }
    stage.style.height = `${hgt}px`;
    geom = { w, h: hgt, dpr, pw: w - PAD.l - PAD.r, ph: hgt - PAD.t - PAD.b };
  }

  function drawBase() {
    const { units } = props;
    const ctx = base.getContext('2d');
    const { dpr, w, h: H, pw, ph } = geom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, base.width, base.height);
    const all = grid.flatMap((r) => r.row).filter(isNum);
    if (!all.length) return;
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const stepD = bandStep(tempDeltaTo(hi - lo, units));
    const stepC = stepD / tempDeltaTo(1, units);
    geom.lo = lo; geom.hi = hi; geom.stepD = stepD;

    const X0 = Math.round(PAD.l * dpr);
    const Y0 = Math.round(PAD.t * dpr);
    const cacheKey = `${base.width}x${base.height}|${units}`;
    if (!fieldCache || fieldCache.key !== cacheKey || fieldCache.grid !== grid) {
      fieldCache = { key: cacheKey, grid, img: renderField(lo, hi, stepC) };
    }
    // The field is computed at CSS resolution and scaled up smoothly: a quarter
    // of the work on high-density screens, with no visible loss on soft bands.
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fieldCache.img, X0, Y0, Math.round(geom.pw * dpr), Math.round(geom.ph * dpr));
    drawAnnotations(ctx, lo, hi, stepC);
  }

  function renderField(lo, hi, stepC) {
    const { pw, ph } = geom;
    const dpr = 1;
    const off = document.createElement('canvas');
    off.width = Math.round(pw);
    off.height = Math.round(ph);
    const ctx = off.getContext('2d');
    // Field at device resolution inside the plot area. Catmull-Rom along the
    // hours, then across the days (separable), so the surface is smooth enough
    // to shade without stripes at every row and column.
    const PW = Math.round(pw * dpr);
    const PH = Math.round(ph * dpr);
    const rows = grid.length;
    const across = grid.map((r) => {
      const out = new Float32Array(PW);
      for (let x = 0; x < PW; x += 1) out[x] = cubic(r.row, (x / (PW - 1)) * 23);
      return out;
    });
    const field = new Float32Array(PW * PH);
    const col = new Array(rows);
    for (let y = 0; y < PH; y += 1) {
      const fy = rows > 1 ? (y / (PH - 1)) * (rows - 1) : 0;
      for (let x = 0; x < PW; x += 1) {
        for (let d = 0; d < rows; d += 1) col[d] = across[d][x];
        field[y * PW + x] = cubic(col, fy);
      }
    }
    const img = ctx.createImageData(PW, PH);
    const px = img.data;
    const span = hi - lo || 1;
    const k = Math.max(2, Math.round(3 * dpr));
    const gain = 26 / k;
    for (let y = 0; y < PH; y += 1) {
      for (let x = 0; x < PW; x += 1) {
        const i = y * PW + x;
        const v = field[i];
        const o = i * 4;
        if (Number.isNaN(v)) {
          const hatch = ((x + y) >> 2) % 3 === 0;
          px[o] = 200; px[o + 1] = 110; px[o + 2] = 80; px[o + 3] = hatch ? 90 : 18;
          continue;
        }
        const band = Math.floor((v - lo) / stepC);
        const c = tempColor(lo + (band + 0.5) * stepC);
        // Hill-shade with light from the upper left, on the continuous field.
        const vl = field[i - (x >= k ? k : 0)];
        const vu = field[i - (y >= k ? k * PW : 0)];
        const gx = Number.isNaN(vl) ? 0 : (v - vl) / span;
        const gy = Number.isNaN(vu) ? 0 : (v - vu) / span;
        const shade = Math.max(0.72, Math.min(1.16, 1 + (gx * 0.6 + gy) * gain));
        const vr = field[i + (x < PW - 1 ? 1 : 0)];
        const vd = field[i + (y < PH - 1 ? PW : 0)];
        const edge = (!Number.isNaN(vr) && Math.floor((vr - lo) / stepC) !== band) || (!Number.isNaN(vd) && Math.floor((vd - lo) / stepC) !== band);
        const m = edge ? shade * 0.62 : shade;
        px[o] = Math.min(255, c[0] * m);
        px[o + 1] = Math.min(255, c[1] * m);
        px[o + 2] = Math.min(255, c[2] * m);
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return off;
  }

  function drawAnnotations(ctx, lo, hi, stepC) {
    const { units } = props;
    const { dpr, pw, ph } = geom;
    const rows = grid.length;
    // Annotations: hour scale, day labels, the true rows, daily peaks and lows.
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(stage);
    const ink = css.getPropertyValue('--text').trim() || '#e9e5da';
    const muted = css.getPropertyValue('--text-3').trim() || '#85928c';
    ctx.font = `500 9.5px ${css.getPropertyValue('--mono') || 'monospace'}`;
    ctx.fillStyle = muted;
    ctx.textAlign = 'center';
    for (let hr = 0; hr <= 23; hr += 3) {
      const x = PAD.l + (hr / 23) * pw;
      ctx.fillText(String(hr).padStart(2, '0'), x, PAD.t - 10);
      ctx.fillRect(x - 0.5, PAD.t - 6, 1, 4);
    }
    ctx.textAlign = 'left';
    grid.forEach((r, d) => {
      const y = PAD.t + (rows > 1 ? (d / (rows - 1)) * ph : ph / 2);
      ctx.fillStyle = props.day === d ? ink : muted;
      ctx.fillText(`${weekdayShort(r.date)} ${dayMonth(r.date).split(' ')[0]}`, 0, y + 3);
      // Dotted guide: the only rows that are forecast values.
      ctx.fillStyle = 'rgba(10,17,19,.38)';
      for (let x = PAD.l; x < PAD.l + pw; x += 4) ctx.fillRect(x, y - 0.5, 1.5, 1);
      const known = r.row.map((v, hr) => [v, hr]).filter(([v]) => isNum(v));
      if (known.length) {
        const mx = known.reduce((a, b) => (b[0] > a[0] ? b : a));
        const mn = known.reduce((a, b) => (b[0] < a[0] ? b : a));
        mark(ctx, PAD.l + (mx[1] / 23) * pw, y, 'up', `${round(tempTo(mx[0], units))}°`, ink);
        mark(ctx, PAD.l + (mn[1] / 23) * pw, y, 'down', `${round(tempTo(mn[0], units))}°`, ink);
      }
    });
    renderLegend(lo, hi, stepC);
  }

  function mark(ctx, x, y, dir, label, ink) {
    ctx.save();
    ctx.fillStyle = 'rgba(10,17,19,.82)';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (dir === 'up') { ctx.moveTo(x, y - 6); ctx.lineTo(x + 4.5, y + 2); ctx.lineTo(x - 4.5, y + 2); }
    else { ctx.moveTo(x, y + 6); ctx.lineTo(x + 4.5, y - 2); ctx.lineTo(x - 4.5, y - 2); }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.font = '600 9px ui-monospace, monospace';
    const tw = ctx.measureText(label).width;
    // Label beside the mark, flipped left near the right edge.
    const right = x + tw + 14 < geom.w;
    const lx = right ? x + 7 : x - 7 - tw - 6;
    ctx.fillStyle = 'rgba(10,17,19,.74)';
    ctx.fillRect(lx, y - 6, tw + 6, 12);
    ctx.fillStyle = '#f3efe4';
    ctx.textAlign = 'left';
    ctx.fillText(label, lx + 3, y + 3);
    ctx.restore();
  }

  function renderLegend(lo, hi, stepC) {
    const u = props.units;
    const n = Math.min(14, Math.max(2, Math.ceil((hi - lo) / stepC)));
    const sw = [];
    for (let i = 0; i < n; i += 1) {
      const v = lo + (i + 0.5) * stepC;
      sw.push(h('span', { class: 'tl-band', style: { background: rgbCss(tempColor(v)) } }));
    }
    replace(legend,
      h('span', { class: 'tl-end' }, `${round(tempTo(lo, u))}${SYSTEMS[u].temp}`),
      h('span', { class: 'tl-bands', 'aria-hidden': 'true' }, ...sw),
      h('span', { class: 'tl-end' }, `${round(tempTo(hi, u))}${SYSTEMS[u].temp}`),
      h('span', { class: 'tl-note' }, `Bands every ${geom.stepD}°. Dotted rows are forecast hours; colour between them is blended. The loupe shows the true hourly values.`));
  }

  // ---------- Overlay: selected hour, cursor crosshair, loupe ----------
  function cellXY(d, hr) {
    const rows = grid.length;
    return [PAD.l + (hr / 23) * geom.pw, PAD.t + (rows > 1 ? (d / (rows - 1)) * geom.ph : geom.ph / 2)];
  }

  function cellAt(x, y) {
    const rows = grid.length;
    const hr = Math.round(((x - PAD.l) / geom.pw) * 23);
    const d = Math.round(((y - PAD.t) / geom.ph) * (rows - 1));
    if (hr < 0 || hr > 23 || d < 0 || d >= rows) return null;
    return { d, hr };
  }

  function drawOver(progress = 1) {
    if (!geom || !grid || !props) return;
    const ctx = over.getContext('2d');
    const { dpr, w, h: H } = geom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, H);
    if (progress < 1) {
      // Opening sweep: the relief is uncovered hour by hour.
      const x = PAD.l + progress * geom.pw;
      ctx.fillStyle = getComputedStyle(stage).getPropertyValue('--surface').trim() || '#0f191c';
      ctx.fillRect(x, PAD.t - 1, w - x, geom.ph + 2);
      ctx.fillStyle = getComputedStyle(stage).getPropertyValue('--solar').trim() || '#f0b44c';
      ctx.fillRect(x - 1, PAD.t - 4, 2, geom.ph + 8);
      return;
    }
    const css = getComputedStyle(stage);
    const solar = css.getPropertyValue('--solar').trim() || '#f0b44c';
    // The hour shown in the lens.
    if (props.sel) {
      const [sx, sy] = cellXY(props.sel.d, props.sel.hr);
      ctx.strokeStyle = solar;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, PAD.t - 4); ctx.lineTo(sx, sy - 7); ctx.stroke();
    }
    if (!cursor) return;
    const [cx, cy] = cellXY(cursor.d, cursor.hr);
    const px = pointer ? pointer.x : cx;
    const py = pointer ? pointer.y : cy;
    // The loupe: raw hourly cells around the cursor, unblended, with values.
    const R = Math.min(78, geom.h * 0.3);
    const lx = Math.min(w - R - 4, Math.max(R + 4, px));
    const ly = Math.min(H - R - 4, Math.max(R + 4, py - R * 0.2));
    ctx.save();
    ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(8,13,15,.92)';
    ctx.fillRect(lx - R, ly - R, R * 2, R * 2);
    const cw = 34;
    const ch = 26;
    for (let dd = -3; dd <= 3; dd += 1) {
      for (let dh = -3; dh <= 3; dh += 1) {
        const d = cursor.d + dd;
        const hr = cursor.hr + dh;
        if (d < 0 || d >= grid.length || hr < 0 || hr > 23) continue;
        const v = grid[d].row[hr];
        const x = lx + dh * cw - cw / 2;
        const y = ly + dd * ch - ch / 2;
        ctx.fillStyle = isNum(v) ? rgbCss(tempColor(v)) : 'rgba(200,110,80,.25)';
        ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
        ctx.fillStyle = 'rgba(10,17,19,.85)';
        ctx.font = `${dd === 0 && dh === 0 ? 700 : 500} 10px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(isNum(v) ? `${round(tempTo(v, props.units))}°` : '—', x + cw / 2, y + ch / 2 + 3.5);
      }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(233,229,218,.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = solar;
    ctx.strokeRect(lx - cw / 2, ly - ch / 2, cw, ch);
    // Index tick on the rim and a reading tag.
    ctx.fillStyle = solar;
    ctx.beginPath(); ctx.arc(lx + R * 0.707, ly - R * 0.707, 3, 0, Math.PI * 2); ctx.fill();
    const r = grid[cursor.d];
    const v = r.row[cursor.hr];
    const tag = `${weekdayShort(r.date)} ${String(cursor.hr).padStart(2, '0')}:00 · ${isNum(v) ? `${round(tempTo(v, props.units), 1)}${SYSTEMS[props.units].temp}` : 'missing'} · forecast value`;
    ctx.font = '600 10px ui-monospace, monospace';
    const tw = ctx.measureText(tag).width;
    const tx = Math.min(w - tw - 10, Math.max(4, lx - tw / 2));
    const ty = ly + R + 16 > H ? ly - R - 8 : ly + R + 16;
    ctx.fillStyle = 'rgba(8,13,15,.88)';
    ctx.fillRect(tx - 5, ty - 11, tw + 10, 15);
    ctx.fillStyle = '#f3efe4';
    ctx.textAlign = 'left';
    ctx.fillText(tag, tx, ty);
  }

  function announceCursor() {
    if (!cursor) return;
    const r = grid[cursor.d];
    const v = r.row[cursor.hr];
    live.textContent = `${weekdayShort(r.date)} ${String(cursor.hr).padStart(2, '0')}:00, ${isNum(v) ? `${round(tempTo(v, props.units), 1)} ${SYSTEMS[props.units].temp}` : 'missing'}.`;
  }

  function sweep() {
    if (revealed || reducedMotion()) { revealed = true; drawOver(); return; }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 1100);
      const e = 1 - (1 - k) ** 3;
      drawOver(e);
      if (k < 1) raf = requestAnimationFrame(step);
      else { revealed = true; drawOver(); }
    };
    raf = requestAnimationFrame(step);
  }

  // The field is only computed once the panel is near the screen.
  let near = typeof IntersectionObserver === 'undefined';
  let pending = false;
  const nearIo = near ? null : new IntersectionObserver((es) => {
    if (!es[0].isIntersecting) return;
    near = true;
    nearIo.disconnect();
    if (pending && props) { pending = false; layout(); drawBase(); drawOver(revealed ? 1 : 0); }
  }, { rootMargin: '400px 0px' });
  nearIo?.observe(stage);

  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((es) => { if (es[0].isIntersecting && props && !revealed) { sweep(); io.disconnect(); } }, { threshold: 0.35 })
    : null;
  io?.observe(stage);

  stage.addEventListener('pointermove', (e) => {
    if (!props || !revealed) return;
    const rect = stage.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const c = cellAt(pointer.x, pointer.y);
    if (c) { cursor = c; drawOver(); }
  });
  stage.addEventListener('pointerleave', () => { pointer = null; if (document.activeElement !== stage) cursor = null; drawOver(); });
  stage.addEventListener('click', () => {
    if (cursor && grid[cursor.d].idx[cursor.hr] >= 0) onSelect(grid[cursor.d].idx[cursor.hr]);
  });
  stage.addEventListener('focus', () => {
    if (!props) return;
    revealed = true;
    cursor = cursor || props.sel || { d: 0, hr: 12 };
    pointer = null;
    drawOver();
    announceCursor();
  });
  stage.addEventListener('blur', () => { cursor = null; drawOver(); });
  stage.addEventListener('keydown', (e) => {
    if (!props || !cursor) return;
    const mv = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
    if (mv) {
      cursor = { d: Math.max(0, Math.min(grid.length - 1, cursor.d + mv[0])), hr: Math.max(0, Math.min(23, cursor.hr + mv[1])) };
      pointer = null;
      drawOver();
      announceCursor();
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      const j = grid[cursor.d].idx[cursor.hr];
      if (j >= 0) onSelect(j);
      e.preventDefault();
    }
  });

  let resizeRaf = 0;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => { if (props && near) { layout(); drawBase(); drawOver(revealed ? 1 : 0); } });
  }) : null;
  ro?.observe(stage);

  return {
    update(next) {
      const dataChanged = !props || props.forecast !== next.forecast || props.units !== next.units || props.day !== next.day;
      if (!props || props.forecast !== next.forecast || !grid) grid = thermalGrid(next.forecast);
      props = next;
      const hr = next.forecast.hours[next.hourIndex];
      const d = hr ? next.forecast.days.findIndex((x) => x.date === hr.date) : -1;
      props.sel = hr && d >= 0 ? { d, hr: hr.hour } : null;
      if (!near) { pending = true; return; }
      if (dataChanged || !geom) { layout(); drawBase(); }
      drawOver(revealed ? 1 : 0);
    },
    destroy() { ro?.disconnect(); io?.disconnect(); nearIo?.disconnect(); cancelAnimationFrame(raf); },
  };
}
