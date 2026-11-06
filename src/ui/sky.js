// The window: a small canvas sky drawn from the current model values
// (cloud cover, day/night, sun position between sunrise and sunset, and the
// weather-code group). It is an illustration, labelled as such, and the same
// facts are always available as text next to it.
//
// Performance rules: device-pixel ratio capped at 2, ~30 fps, paused when
// the tab is hidden or the window is scrolled out of view, and a single
// still frame when the visitor prefers reduced motion.

import { reducedMotion } from './dom.js';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function palette(scene) {
  const grey = Math.min(1, (scene.cloud ?? 0) / 100) * 0.75 + (['rain', 'storm', 'drizzle', 'snow', 'fog'].includes(scene.group) ? 0.2 : 0);
  if (!scene.isDay) {
    return { top: [8, 14, 28], bottom: mix([24, 38, 62], [40, 46, 56], grey), land: [6, 10, 18], land2: [10, 17, 28] };
  }
  const f = scene.sunFrac ?? 0.5;
  const edge = Math.max(0, 1 - Math.min(f, 1 - f) / 0.14); // 1 at sunrise/sunset, 0 by mid-morning
  const top = mix(mix([42, 112, 176], [66, 92, 140], edge), [122, 134, 146], grey);
  const bottom = mix(mix([176, 214, 228], [246, 178, 112], edge), [184, 190, 194], grey);
  return { top, bottom, land: mix([22, 58, 64], [52, 44, 52], edge * 0.6), land2: mix([34, 86, 88], [86, 66, 70], edge * 0.6) };
}

export function createSky(canvas) {
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) return null;
  let scene = { isDay: true, sunFrac: 0.5, cloud: 20, group: 'partly' };
  let clouds = [];
  let stars = [];
  let drops = [];
  let w = 0;
  let hgt = 0;
  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;
  const rand = mulberry(7);

  function seed() {
    const r = mulberry(Math.round((scene.cloud ?? 0) * 13 + (scene.isDay ? 1 : 2)));
    const count = Math.round(((scene.cloud ?? 0) / 100) * 9) + (scene.group === 'clear' ? 0 : 1);
    clouds = Array.from({ length: count }, (_, i) => ({
      x: r() * 1.3 - 0.15,
      y: 0.12 + r() * 0.42,
      s: 0.14 + r() * 0.18,
      v: 0.004 + r() * 0.006,
      layer: i % 3,
    }));
    stars = Array.from({ length: 70 }, () => ({ x: r(), y: r() * 0.65, a: 0.3 + r() * 0.7, tw: r() * 6 }));
    const heavy = scene.group === 'storm' ? 140 : scene.group === 'rain' ? 100 : scene.group === 'drizzle' ? 50 : scene.group === 'snow' ? 80 : 0;
    drops = Array.from({ length: heavy }, () => ({ x: rand(), y: rand(), v: 0.6 + rand() * 0.6 }));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    w = Math.max(1, Math.round(rect.width));
    hgt = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawCloud(cx, cy, size, alpha, tint) {
    const r = size * w;
    const blobs = [[0, 0, 1], [-0.75, 0.18, 0.7], [0.8, 0.2, 0.72], [-0.3, -0.35, 0.72], [0.35, -0.3, 0.8]];
    for (const [dx, dy, k] of blobs) {
      const x = cx * w + dx * r * 0.9;
      const y = cy * hgt + dy * r * 0.6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * k);
      g.addColorStop(0, rgb(tint, alpha));
      g.addColorStop(1, rgb(tint, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(time) {
    const t = time / 1000;
    const pal = palette(scene);
    const sky = ctx.createLinearGradient(0, 0, 0, hgt);
    sky.addColorStop(0, rgb(pal.top));
    sky.addColorStop(0.78, rgb(pal.bottom));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, hgt);

    if (!scene.isDay) {
      const visibleStars = Math.max(0, 1 - (scene.cloud ?? 0) / 85);
      for (const st of stars) {
        const a = st.a * visibleStars * (0.75 + 0.25 * Math.sin(t * 1.3 + st.tw));
        if (a <= 0.02) continue;
        ctx.fillStyle = `rgba(230,240,255,${a})`;
        ctx.fillRect(st.x * w, st.y * hgt, 1.4, 1.4);
      }
    }

    // Sun along an arc from sunrise (left) to sunset (right); a moon at night.
    const f = scene.isDay ? (scene.sunFrac ?? 0.5) : 0.62;
    const sx = (0.12 + 0.76 * f) * w;
    const sy = hgt * (0.78 - Math.sin(Math.PI * f) * 0.58);
    const discR = Math.max(10, Math.min(w, hgt) * 0.06);
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, discR * 5);
    const dim = 1 - Math.min(0.85, (scene.cloud ?? 0) / 110);
    glow.addColorStop(0, scene.isDay ? `rgba(255,236,190,${0.55 * dim})` : `rgba(220,230,255,${0.22 * dim})`);
    glow.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, hgt);
    ctx.fillStyle = scene.isDay ? `rgba(255,244,214,${0.35 + 0.65 * dim})` : `rgba(232,238,250,${0.25 + 0.7 * dim})`;
    ctx.beginPath();
    ctx.arc(sx, sy, discR, 0, Math.PI * 2);
    ctx.fill();

    const tint = scene.isDay ? (scene.group === 'storm' ? [150, 156, 166] : [250, 251, 252]) : [96, 108, 128];
    for (const c of clouds) {
      const x = ((c.x + c.v * t * (1 + c.layer * 0.4)) % 1.4) - 0.2;
      drawCloud(x, c.y, c.s, scene.isDay ? 0.5 + c.layer * 0.12 : 0.35, tint);
    }

    if (scene.group === 'fog') {
      for (let i = 0; i < 4; i += 1) {
        ctx.fillStyle = `rgba(220,226,230,${0.16 + i * 0.05})`;
        ctx.fillRect(0, hgt * (0.45 + i * 0.1) + Math.sin(t * 0.3 + i) * 4, w, hgt * 0.06);
      }
    }

    // Two low horizons.
    ctx.fillStyle = rgb(pal.land2);
    ctx.beginPath();
    ctx.moveTo(0, hgt * 0.8);
    ctx.bezierCurveTo(w * 0.3, hgt * 0.74, w * 0.55, hgt * 0.84, w, hgt * 0.77);
    ctx.lineTo(w, hgt);
    ctx.lineTo(0, hgt);
    ctx.fill();
    ctx.fillStyle = rgb(pal.land);
    ctx.beginPath();
    ctx.moveTo(0, hgt * 0.88);
    ctx.bezierCurveTo(w * 0.35, hgt * 0.84, w * 0.7, hgt * 0.92, w, hgt * 0.86);
    ctx.lineTo(w, hgt);
    ctx.lineTo(0, hgt);
    ctx.fill();

    if (drops.length) {
      const snow = scene.group === 'snow';
      ctx.strokeStyle = snow ? 'rgba(245,248,255,0.85)' : 'rgba(210,228,245,0.5)';
      ctx.fillStyle = 'rgba(245,248,255,0.85)';
      ctx.lineWidth = 1;
      for (const d of drops) {
        const y = ((d.y + t * d.v * (snow ? 0.08 : 0.9)) % 1) * hgt;
        const x = (d.x * w + (snow ? Math.sin(t + d.x * 9) * 6 : -y * 0.12)) % w;
        if (snow) ctx.fillRect(x, y, 2, 2);
        else {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 2, y + 9);
          ctx.stroke();
        }
      }
    }
  }

  function loop(time) {
    if (destroyed) return;
    raf = 0;
    if (!visible || document.hidden) return;
    if (time - last >= 33) {
      last = time;
      frame(time);
    }
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (reducedMotion()) {
      frame(20000);
      return;
    }
    if (!raf) raf = requestAnimationFrame(loop);
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); frame(performance.now()); }) : null;
  ro?.observe(canvas);
  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; if (visible) start(); })
    : null;
  io?.observe(canvas);
  const onVis = () => { if (!document.hidden) start(); };
  document.addEventListener('visibilitychange', onVis);
  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onMotion = () => { cancelAnimationFrame(raf); raf = 0; start(); };
  motion?.addEventListener?.('change', onMotion);

  resize();

  return {
    set(next) {
      scene = { ...scene, ...next };
      seed();
      frame(performance.now());
      start();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      motion?.removeEventListener?.('change', onMotion);
    },
  };
}
