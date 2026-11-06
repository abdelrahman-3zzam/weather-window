// Living wind: one tile per hour of the selected day, each seen from above
// with north up. Particles in a tile drift in the forecast wind direction
// (the way the wind blows toward), and their speed and number follow the
// forecast wind speed. This is an artistic rendering of two forecast values
// per hour, not a map: the particles are not air parcels, and tiles do not
// stand for places. The numbers under each tile are the actual values.
//
// Motion runs at a low frame rate, only while the panel is on screen and the
// tab is visible. With reduced motion the tiles show still streak lines.

import { h, reducedMotion, whenNear } from './dom.js';
import { isNum, round } from '../core/num.js';
import { compass } from '../core/encoding.js';
import { windTo, SYSTEMS } from '../core/units.js';
import { weekdayLong } from '../core/time.js';

const FPS = 24;
const MAX_KMH = 60; // visual saturation only

/** Unit vector (canvas coords, y down) for the direction the wind blows toward. */
export function flowVector(fromDeg) {
  const a = ((fromDeg + 180) % 360) * (Math.PI / 180);
  return [Math.sin(a), -Math.cos(a)];
}

/** Per-hour wind tiles for one day; null fields where the forecast is missing. */
export function windTiles(forecast, dayIndex) {
  const d = forecast.days[dayIndex];
  if (!d || d.hourStart < 0) return [];
  const out = [];
  for (let k = 0; k < d.hourCount; k += 1) {
    const j = d.hourStart + k;
    const x = forecast.hours[j];
    const ok = isNum(x.wind) && isNum(x.windDir);
    out.push({ i: j, hhmm: x.hhmm, hour: x.hour, wind: isNum(x.wind) ? x.wind : null, dir: ok ? x.windDir : null, vec: ok ? flowVector(x.windDir) : null });
  }
  return out;
}

// Small deterministic generator so the drawing is the same on every visit.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

export function createWind(host, { onSelect }) {
  const canvas = h('canvas', { class: 'wind-canvas', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'wind-stage', tabindex: '0', role: 'application', 'aria-roledescription': 'wind tiles', 'aria-label': 'Wind by hour for the selected day. Arrow keys move between hours; Enter shows the hour in the lens.' }, canvas);
  const readout = h('p', { class: 'wind-readout', 'aria-live': 'polite' });
  host.append(stage, readout);

  let props = null;
  let tiles = [];
  let geom = null;
  let parts = [];
  let focusK = -1;
  let hoverK = -1;
  let raf = 0;
  let last = 0;
  let visible = false;
  const still = () => reducedMotion();

  function layout() {
    const w = Math.max(280, Math.round(stage.clientWidth || 800));
    const n = Math.max(1, tiles.length);
    const cols = Math.min(n, w < 640 ? 6 : 12);
    const rows = Math.ceil(n / cols);
    const gap = w < 640 ? 6 : 10;
    const size = Math.floor((w - gap * (cols - 1)) / cols);
    const label = 30;
    const H = rows * (size + label) + (rows - 1) * 8;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = `${H}px`;
    stage.style.height = `${H}px`;
    geom = { w, H, dpr, cols, rows, gap, size, label };
  }

  function tileRect(k) {
    const { cols, gap, size, label } = geom;
    const c = k % cols;
    const r = Math.floor(k / cols);
    return { x: c * (size + gap), y: r * (size + label + 8), s: size };
  }

  function seedParticles() {
    parts = tiles.map((t, k) => {
      const rand = rng(1000 + t.hour * 97 + k);
      const kmh = t.wind ?? 0;
      const n = t.vec ? Math.round(10 + Math.min(1, kmh / MAX_KMH) * 34) : 0;
      return Array.from({ length: n }, () => ({ x: rand(), y: rand(), age: rand() * 40, life: 30 + rand() * 40 }));
    });
  }

  function speedPx(kmh) {
    // Tile-widths per second; a square-root curve keeps light airs visible.
    return 0.04 + Math.sqrt(Math.min(kmh, MAX_KMH * 1.5) / MAX_KMH) * 0.42;
  }

  function colors() {
    const css = getComputedStyle(stage);
    return {
      ink: css.getPropertyValue('--text').trim() || '#e9e5da',
      muted: css.getPropertyValue('--text-3').trim() || '#85928c',
      line: css.getPropertyValue('--line-2').trim() || 'rgba(255,255,255,.14)',
      glacier: css.getPropertyValue('--glacier').trim() || '#9cc9d1',
      solar: css.getPropertyValue('--solar').trim() || '#f0b44c',
      oxide: css.getPropertyValue('--oxide').trim() || '#c86e50',
      mono: css.getPropertyValue('--mono').trim() || 'monospace',
    };
  }

  function draw(dt) {
    const ctx = canvas.getContext('2d');
    const { dpr, w, H } = geom;
    const col = colors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, H);
    const sel = props.hourIndex;
    tiles.forEach((t, k) => {
      const { x, y, s } = tileRect(k);
      // Tile plate.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, s, s);
      ctx.clip();
      ctx.fillStyle = 'rgba(127,160,165,.06)';
      ctx.fillRect(x, y, s, s);
      if (!t.vec) {
        ctx.strokeStyle = col.oxide;
        ctx.globalAlpha = 0.35;
        for (let q = -s; q < s; q += 6) { ctx.beginPath(); ctx.moveTo(x + q, y + s); ctx.lineTo(x + q + s, y); ctx.stroke(); }
        ctx.globalAlpha = 1;
      } else if (still() || !dt) {
        // Still streamlines: parallel strokes along the flow, length ~ speed.
        const len = s * (0.18 + speedPx(t.wind) * 0.9);
        const rand = rng(500 + k);
        const n = Math.round(10 + Math.min(1, t.wind / MAX_KMH) * 22);
        ctx.strokeStyle = col.glacier;
        ctx.lineWidth = 1.1;
        ctx.lineCap = 'round';
        for (let q = 0; q < n; q += 1) {
          const px = x + rand() * s;
          const py = y + rand() * s;
          ctx.globalAlpha = 0.35 + rand() * 0.5;
          ctx.beginPath();
          ctx.moveTo(px - t.vec[0] * len / 2, py - t.vec[1] * len / 2);
          ctx.lineTo(px + t.vec[0] * len / 2, py + t.vec[1] * len / 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else {
        const v = speedPx(t.wind) * dt;
        const tail = Math.max(2, s * (0.05 + speedPx(t.wind) * 0.35));
        ctx.strokeStyle = col.glacier;
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        for (const p of parts[k]) {
          p.x += t.vec[0] * v;
          p.y += t.vec[1] * v;
          p.age += dt * FPS;
          if (p.x < -0.1 || p.x > 1.1 || p.y < -0.1 || p.y > 1.1 || p.age > p.life) {
            // Re-enter from the upwind side.
            const r = Math.random();
            if (Math.abs(t.vec[0]) > Math.abs(t.vec[1])) { p.x = t.vec[0] > 0 ? -0.05 : 1.05; p.y = r; }
            else { p.y = t.vec[1] > 0 ? -0.05 : 1.05; p.x = r; }
            if (Math.random() < 0.5) { p.x = Math.random(); p.y = Math.random(); }
            p.age = 0;
          }
          const fade = Math.min(1, p.age / 8, (p.life - p.age) / 8);
          const px = x + p.x * s;
          const py = y + p.y * s;
          ctx.globalAlpha = 0.25 + 0.65 * Math.max(0, fade);
          ctx.beginPath();
          ctx.moveTo(px - t.vec[0] * tail, py - t.vec[1] * tail);
          ctx.lineTo(px, py);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      // Frame, north tick, selection.
      const isSel = t.i === sel;
      const isCur = k === focusK || k === hoverK;
      ctx.strokeStyle = isSel ? col.solar : isCur ? col.ink : col.line;
      ctx.lineWidth = isSel ? 1.6 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
      ctx.fillStyle = col.muted;
      ctx.fillRect(x + s / 2 - 0.5, y, 1, 4);
      // Actual values under the tile.
      ctx.textAlign = 'center';
      ctx.font = `600 ${s < 34 ? 8.5 : 9.5}px ${col.mono}`;
      ctx.fillStyle = isSel ? col.solar : col.muted;
      if (s >= 46 || t.hour % 3 === 0 || isSel || isCur) ctx.fillText(t.hhmm.slice(0, 2), x + s / 2, y + s + 12);
      ctx.fillStyle = col.ink;
      ctx.font = `500 ${s < 34 ? 8.5 : 9.5}px ${col.mono}`;
      ctx.fillText(isNum(t.wind) ? String(round(windTo(t.wind, props.units))) : '—', x + s / 2, y + s + 24);
    });
  }

  function frame(now) {
    raf = 0;
    if (!visible || document.hidden || still() || !props) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    if (now - last >= 1000 / FPS - 2) {
      last = now;
      draw(dt);
    }
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (raf || still() || !visible || document.hidden || !props) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  function describe(k) {
    const t = tiles[k];
    if (!t) return '';
    const u = SYSTEMS[props.units].wind;
    if (!isNum(t.wind)) return `${t.hhmm}: wind speed missing.`;
    if (!isNum(t.dir)) return `${t.hhmm}: ${round(windTo(t.wind, props.units))} ${u}, direction missing.`;
    return `${t.hhmm}: ${round(windTo(t.wind, props.units))} ${u} from the ${compass(t.dir)} (${round(t.dir)}°).`;
  }
  function showReadout(k) {
    const day = props.forecast.days[props.day];
    const base = `${weekdayLong(day.date)}. Numbers under each tile are forecast wind speed in ${SYSTEMS[props.units].wind}.`;
    readout.textContent = k >= 0 ? describe(k) : base;
  }

  function tileAt(px, py) {
    for (let k = 0; k < tiles.length; k += 1) {
      const r = tileRect(k);
      if (px >= r.x && px <= r.x + r.s && py >= r.y && py <= r.y + r.s + geom.label) return k;
    }
    return -1;
  }

  stage.addEventListener('pointermove', (e) => {
    if (!props) return;
    const rect = stage.getBoundingClientRect();
    const k = tileAt(e.clientX - rect.left, e.clientY - rect.top);
    if (k !== hoverK) { hoverK = k; showReadout(k); if (!raf) draw(0); }
  });
  stage.addEventListener('pointerleave', () => { hoverK = -1; showReadout(focusK); if (!raf) draw(0); });
  stage.addEventListener('click', (e) => {
    const rect = stage.getBoundingClientRect();
    const k = tileAt(e.clientX - rect.left, e.clientY - rect.top);
    if (k >= 0) onSelect(tiles[k].i);
  });
  stage.addEventListener('focus', () => {
    if (!props) return;
    const k = tiles.findIndex((t) => t.i === props.hourIndex);
    focusK = k >= 0 ? k : 0;
    showReadout(focusK);
    if (!raf) draw(0);
  });
  stage.addEventListener('blur', () => { focusK = -1; showReadout(-1); if (!raf) draw(0); });
  stage.addEventListener('keydown', (e) => {
    if (focusK < 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: geom.cols, ArrowUp: -geom.cols, Home: -999, End: 999 }[e.key];
    if (step !== undefined) {
      focusK = Math.max(0, Math.min(tiles.length - 1, focusK + step));
      showReadout(focusK);
      if (!raf) draw(0);
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      onSelect(tiles[focusK].i);
      e.preventDefault();
    }
  });

  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) start(); else stop(); })
    : null;
  if (io) io.observe(stage); else visible = true;
  const onVis = () => { if (document.hidden) stop(); else start(); };
  document.addEventListener('visibilitychange', onVis);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (props && tiles.length) { layout(); draw(0); } }) : null;
  ro?.observe(stage);

  let near = false;
  let queued = null;
  whenNear(stage, () => { near = true; if (queued) api.update(queued); });

  const api = {
    update(next) {
      if (!near) { queued = next; return; }
      const changed = !props || props.forecast !== next.forecast || props.day !== next.day || props.units !== next.units;
      props = next;
      if (changed) {
        tiles = windTiles(next.forecast, next.day);
        layout();
        seedParticles();
        showReadout(-1);
      }
      draw(0);
      start();
    },
    destroy() { stop(); io?.disconnect(); ro?.disconnect(); document.removeEventListener('visibilitychange', onVis); },
  };
  return api;
}
