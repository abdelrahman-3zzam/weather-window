// The Aperture: Weather Window's signature 3D scene.
//
// A circular lens looks into a glass air column standing on a topographic
// plinth. Inside the column: contour strata coloured by temperature, air
// threads that drift with the wind, a cloud veil whose density follows cloud
// cover, falling streaks whose density follows precipitation chance, and a
// light shaft whose strength follows the UV index. The mapping lives in
// core/encoding.js and is shown to the visitor next to the lens.
//
// Rendering: one full-screen triangle and a ray-marched fragment shader in
// plain WebGL 1 (no library). Adaptive quality lowers resolution, march steps
// and noise octaves when frames run long; the loop runs at most 30 fps, drops
// to 12 fps when idle, stops when off-screen or hidden, and draws single
// still frames under reduced motion. Context loss or a missing WebGL falls
// back to the 2D sky (handled by the caller through `onFail`).

import { reducedMotion } from './dom.js';
import { blendParams } from '../core/encoding.js';

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uRot;
uniform vec3 uTint;
uniform float uWind;
uniform vec2 uWindDir;
uniform float uHaze;
uniform float uPrecip;
uniform float uSnow;
uniform float uLight;
uniform float uNight;
uniform vec3 uSunDir;
uniform float uStorm;
uniform float uSteps;
uniform float uOctaves;
uniform float uReveal;
uniform vec4 uLayers; // strata, threads, streaks, veil: 1 shown, 0 hidden

const float R = 1.0;
const float H = 0.6;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float noise2(vec2 x) {
  vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), f.x), mix(hash12(i + vec2(0., 1.)), hash12(i + vec2(1., 1.)), f.x), f.y);
}
float noise3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3. - 2. * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1., 0., 0.)), f.x), mix(hash13(i + vec3(0., 1., 0.)), hash13(i + vec3(1., 1., 0.)), f.x), f.y),
    mix(mix(hash13(i + vec3(0., 0., 1.)), hash13(i + vec3(1., 0., 1.)), f.x), mix(hash13(i + vec3(0., 1., 1.)), hash13(i + vec3(1., 1., 1.)), f.x), f.y), f.z);
}
float fbm2(vec2 p) { float a = .5; float s = 0.; for (int i = 0; i < 3; i++) { s += a * noise2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
float fbm3(vec3 p) {
  float a = .5; float s = 0.;
  for (int i = 0; i < 3; i++) { if (float(i) >= uOctaves) break; s += a * noise3(p); p = p * 2.02 + vec3(3.1, 1.7, 5.3); a *= .5; }
  return s;
}

vec3 sky(vec3 rd) {
  float y = clamp(rd.y * .5 + .5, 0., 1.);
  vec3 day = mix(vec3(.50, .60, .58), vec3(.10, .27, .31), y);
  vec3 night = mix(vec3(.05, .09, .11), vec3(.012, .025, .035), y);
  vec3 c = mix(day, night, uNight);
  c = mix(c, mix(vec3(.46, .50, .50), vec3(.08, .10, .11), uNight), uHaze * .55);
  float sd = max(dot(rd, uSunDir), 0.);
  c += vec3(1., .80, .52) * (pow(sd, 90.) * 1.4 + pow(sd, 7.) * .22) * uLight * (1. - uHaze * .65);
  c += vec3(.62, .72, .9) * pow(sd, 260.) * uNight * (1. - uHaze);
  float st = step(.9965, hash12(floor(rd.xy * 160. + rd.z * 37.)));
  c += vec3(.8, .86, 1.) * st * uNight * (1. - uHaze) * .7;
  return c;
}

vec2 cylinder(vec3 ro, vec3 rd) {
  float a = dot(rd.xz, rd.xz);
  float b = dot(ro.xz, rd.xz);
  float c = dot(ro.xz, ro.xz) - R * R;
  float h = b * b - a * c;
  if (h < 0.) return vec2(-1.);
  h = sqrt(h);
  float t0 = (-b - h) / a;
  float t1 = (-b + h) / a;
  float ry = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
  float y0 = (-H - ro.y) / ry;
  float y1 = (H - ro.y) / ry;
  if (y0 > y1) { float tt = y0; y0 = y1; y1 = tt; }
  t0 = max(t0, y0); t1 = min(t1, y1);
  if (t1 < t0) return vec2(-1.);
  return vec2(max(t0, 0.), t1);
}

float strata(vec3 p, float t) {
  vec2 wd = length(uWindDir) > .01 ? normalize(uWindDir) : vec2(.8, -.6);
  vec2 drift = wd * t * (.015 + .32 * uWind);
  float disp = fbm2(p.xz * 1.15 + drift * 1.4);
  return p.y * 5.6 + (disp - .5) * (.7 + 2.4 * uWind) + .12 * sin(t * .25);
}

// sheet: 0..1 share of a contour sheet crossed during this step.
vec4 air(vec3 p, vec3 rd, float t, float sheet) {
  vec2 wd = length(uWindDir) > .01 ? normalize(uWindDir) : vec2(.8, -.6);
  vec2 drift = wd * t * (.015 + .32 * uWind);
  float rr = length(p.xz);
  float wall = smoothstep(1.0, .86, rr);
  float hgt = (p.y + H) / (2. * H);

  // Sheets glow toward the glass, so the strata read as stacked contour rings.
  sheet *= wall * (.18 + .82 * smoothstep(.35, .95, rr)) * smoothstep(-H, -H + .45, p.y) * smoothstep(H, H - .08, p.y);

  sheet *= uLayers.x;

  // Cloud veil, upper column, density from cloud cover.
  float cloud = 0.;
  if (uHaze > .02 && uLayers.w > .001) {
    float n = fbm3(vec3(p.x + drift.x, p.y * 1.7 - t * .015, p.z + drift.y) * 2.1);
    cloud = smoothstep(.62 - uHaze * .38, .78 - uHaze * .2, n + uHaze * .18) * smoothstep(-.55, .35, p.y) * (.35 + .65 * uHaze) * uLayers.w;
  }

  // Air threads: comet-like dashes on lanes across the wind.
  float u = dot(p.xz, wd);
  float v = dot(p.xz, vec2(-wd.y, wd.x));
  float laneF = v * 3.2 + .35 * noise2(vec2(u * .7, p.y * 2.1));
  float tierF = p.y * 2.6 + .25;
  float lane = abs(fract(laneF) - .5) / 3.2;
  float tier = abs(fract(tierF) - .5) / 2.6;
  float id = floor(laneF) + floor(tierF) * 7.;
  float dash = pow(fract(u * .9 - t * (.05 + 1.1 * uWind) + hash12(vec2(id, 3.7))), 3.);
  float thr = smoothstep(.034, .0, length(vec2(lane, tier))) * (.18 + .82 * dash) * (.3 + .7 * uWind) * uLayers.y;

  // Precipitation streaks; density follows the chance, never the amount.
  float pr = 0.;
  if (uPrecip > .01 && uLayers.z > .001) {
    vec3 q = p;
    q.xz -= wd * p.y * .45 * uWind;
    q.y += t * mix(1.5, .16, uSnow);
    vec2 cell = floor(q.xz * 9.);
    float hs = hash12(cell);
    if (hs < uPrecip * .75) {
      vec2 lp = fract(q.xz * 9.) - .5 - (vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - .5) * .6;
      float ph = fract(q.y * mix(.9, 2.4, uSnow) + hs * 13.);
      float len = mix(.26, .05, uSnow);
      float seg = smoothstep(0., .03, ph) * smoothstep(len, len * .4, ph);
      pr = smoothstep(mix(.07, .13, uSnow), 0., length(lp)) * seg * uLayers.z;
    }
  }

  vec3 lightCol = mix(vec3(1., .85, .6), vec3(.5, .62, .86), uNight);
  float scatter = pow(max(dot(rd, uSunDir), 0.), 5.);
  vec3 sheetCol = uTint * mix(.7, 1.15, hgt) * mix(1., .55, uNight);
  vec3 cloudCol = mix(vec3(.80, .84, .85), vec3(.36, .38, .44), uStorm) * mix(1., .32, uNight);
  vec3 col = sheetCol * sheet * .55
    + mix(vec3(.86, .97, .95), uTint, .2) * thr * 1.8
    + vec3(.82, .9, 1.) * pr * 1.25 * mix(1., .6, uNight)
    + cloudCol * cloud * .75
    + lightCol * scatter * uLight * (cloud * 1.6 + sheet * .6 + .012);
  float dens = sheet * .16 + thr * .4 + pr * .55 + cloud * .55;
  return vec4(col * wall, dens * wall);
}

vec3 plinth(vec3 pos, vec3 rd) {
  float h = fbm2(pos.xz * 1.5 + 4.);
  float f = abs(fract(h * 11.) - .5);
  float line = smoothstep(.42, .5, f);
  float rr = length(pos.xz);
  float fade = smoothstep(1.32, .9, rr);
  vec3 base = mix(vec3(.05, .11, .12), vec3(.015, .03, .035), uNight);
  vec3 lc = mix(uTint, vec3(.8, .86, .82), .55) * mix(.38, .22, uNight);
  float lit = .65 + .35 * max(uSunDir.y, 0.) * uLight;
  float ring = smoothstep(.012, .0, abs(rr - 1.0)) * .6;
  return (base + lc * line * .55 + vec3(.9, .78, .5) * ring * (.3 + .7 * uLight)) * lit * fade;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - .5 * uRes) / (.5 * min(uRes.x, uRes.y));
  float r = length(uv);
  if (r > 1.0) { gl_FragColor = vec4(0.); return; }

  // A thick lens: magnified centre, compressed rim.
  vec2 lv = uv * (.86 + .22 * r * r);

  float yaw = uRot.x;
  float pitch = uRot.y;
  vec3 ro = vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * 2.8;
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(fw, vec3(0., 1., 0.)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * 1.75 + rt * lv.x + up * lv.y);

  vec3 bg = sky(rd);
  if (rd.y < 0.) {
    float tp = (-H - ro.y) / rd.y;
    vec3 pp = ro + rd * tp;
    if (length(pp.xz) < 1.32) bg = mix(bg, plinth(pp, rd), smoothstep(1.32, 1.1, length(pp.xz)));
  }

  vec4 acc = vec4(0.);
  vec2 seg = cylinder(ro, rd);
  float t = uTime;
  if (seg.y > 0.) {
    float len = seg.y - seg.x;
    float ds = len / uSteps;
    float jit = hash12(gl_FragCoord.xy);
    float sPrev = strata(ro + rd * seg.x, t);
    for (int i = 0; i < 64; i++) {
      if (float(i) >= uSteps || acc.a > .97) break;
      vec3 p = ro + rd * (seg.x + ds * (float(i) + jit));
      // Contour sheets are counted where the ray crosses them, which keeps
      // them crisp at any step count instead of sampling a thin shell.
      float sNow = strata(p, t);
      float crossed = min(abs(floor(sNow) - floor(sPrev)), 1.);
      sPrev = sNow;
      vec4 smp = air(p, rd, t, crossed / max(ds * 9., .001));
      float a = 1. - exp(-smp.a * ds * 9.);
      acc.rgb += (1. - acc.a) * smp.rgb * ds * 5.5;
      acc.a += (1. - acc.a) * a;
    }
    // The glass: a faint fresnel on the wall and hairline rims top and bottom.
    vec3 pe = ro + rd * seg.x;
    vec3 n = normalize(vec3(pe.x, 0., pe.z));
    float fres = pow(1. - abs(dot(rd, n)), 4.) * step(abs(pe.y), H - .01);
    float rim = smoothstep(.02, .0, abs(abs(pe.y) - H)) * smoothstep(.04, .0, abs(length(pe.xz) - R));
    acc.rgb += vec3(.75, .85, .82) * (fres * .16 + rim * .5);
  }
  vec3 col = acc.rgb + (1. - acc.a) * bg;

  col = col / (1. + col * .55);
  col *= mix(1., .5, smoothstep(.62, 1., r));
  col += vec3(.10, .05, -.02) * smoothstep(.9, .995, r);
  col += vec3(.75, .82, .8) * smoothstep(.006, .0, abs(r - .986)) * .35;
  col += (hash12(gl_FragCoord.xy) - .5) / 255.;

  float a = smoothstep(1., .992, r) * smoothstep(uReveal, uReveal - .015, r);
  gl_FragColor = vec4(col * a, a);
}
`;

const TIERS = [
  { scale: 1, steps: 52, oct: 3 },
  { scale: 0.82, steps: 42, oct: 3 },
  { scale: 0.66, steps: 34, oct: 2 },
  { scale: 0.52, steps: 26, oct: 2 },
  { scale: 0.4, steps: 20, oct: 1 },
];

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader failed: ${log}`);
  }
  return sh;
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export function createLens(canvas, { onFail } = {}) {
  let gl = null;
  try {
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  } catch { gl = null; }
  if (!gl) return null;

  let prog;
  try {
    prog = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (err) {
    if (globalThis.WW_DEBUG) console.warn(err);
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const n of ['uRes', 'uTime', 'uRot', 'uTint', 'uWind', 'uWindDir', 'uHaze', 'uPrecip', 'uSnow', 'uLight', 'uNight', 'uSunDir', 'uStorm', 'uSteps', 'uOctaves', 'uReveal', 'uLayers']) U[n] = gl.getUniformLocation(prog, n);

  // Weaker devices start one tier lower; frame timing adjusts from there.
  const cores = navigator.hardwareConcurrency || 4;
  const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches;
  let tier = coarse || cores <= 4 ? 2 : 1;
  const minTier = tier;

  let cur = null;
  let from = null;
  const layers = [1, 1, 1, 1];
  const layerTarget = [1, 1, 1, 1];
  let target = null;
  let tStart = 0;
  const DUR = 1100;
  let yaw = 0.55;
  let pitch = 0.2;
  let vyaw = 0;
  let reveal = 1.05;
  let raf = 0;
  let last = 0;
  let lastInput = performance.now();
  let clock = 0;
  let visible = true;
  let lost = false;
  let destroyed = false;
  let samples = [];
  let cssSize = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssSize = Math.max(1, Math.round(Math.min(rect.width, rect.height)));
    const dpr = Math.min(1.5, globalThis.devicePixelRatio || 1);
    const px = Math.min(1000, Math.round(cssSize * dpr * TIERS[tier].scale));
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function draw() {
    if (lost || !cur) return;
    const q = TIERS[tier];
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, clock);
    gl.uniform2f(U.uRot, yaw, pitch);
    gl.uniform3f(U.uTint, cur.tempColor[0] / 255, cur.tempColor[1] / 255, cur.tempColor[2] / 255);
    gl.uniform1f(U.uWind, cur.wind);
    gl.uniform2f(U.uWindDir, cur.windDir[0], cur.windDir[1]);
    gl.uniform1f(U.uHaze, cur.haze);
    gl.uniform1f(U.uPrecip, cur.precip);
    gl.uniform1f(U.uSnow, cur.snow);
    gl.uniform1f(U.uLight, cur.light);
    gl.uniform1f(U.uNight, cur.night);
    gl.uniform3f(U.uSunDir, ...normalize(cur.sunDir));
    gl.uniform1f(U.uStorm, cur.storm);
    gl.uniform1f(U.uSteps, q.steps);
    gl.uniform1f(U.uOctaves, q.oct);
    gl.uniform1f(U.uReveal, reveal);
    gl.uniform4f(U.uLayers, ...layers);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  function adapt(dt) {
    samples.push(dt);
    if (samples.length < 24) return;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    samples = [];
    if (avg > 46 && tier < TIERS.length - 1) { tier += 1; resize(); }
    else if (avg < 30 && tier > minTier - 1 && tier > 0 && performance.now() - lastInput > 4000) {
      // Only climb back while the page is calm, and never above the start tier minus one.
      tier -= 1;
      resize();
    }
  }

  function step(now) {
    raf = 0;
    if (destroyed || lost || !visible || document.hidden) return;
    const fading = layers.some((v, k) => v !== layerTarget[k]);
    const idle = now - lastInput > 25000 && !target && !fading;
    const interval = idle ? 83 : 33;
    if (now - last >= interval) {
      const dt = last ? Math.min(250, now - last) : 33;
      if (last && !idle) adapt(dt);
      last = now;
      clock += dt / 1000;
      if (target) {
        const k = Math.min(1, (now - tStart) / DUR);
        cur = blendParams(from, target, easeInOut(k));
        if (k >= 1) { cur = target; target = null; }
      }
      if (Math.abs(vyaw) > 0.0001) { yaw += vyaw; vyaw *= 0.92; }
      else yaw += 0.0009 * (dt / 33);
      if (reveal < 1.05) reveal = Math.min(1.05, reveal + dt / 900);
      for (let k = 0; k < 4; k += 1) {
        const d = layerTarget[k] - layers[k];
        layers[k] = Math.abs(d) < 0.02 ? layerTarget[k] : layers[k] + d * Math.min(1, dt / 140);
      }
      draw();
    }
    raf = requestAnimationFrame(step);
  }

  function kick() {
    if (destroyed || lost) return;
    if (reducedMotion()) { draw(); return; }
    if (!raf) raf = requestAnimationFrame(step);
  }

  // Drag to turn the column. Vertical drags on touch screens still scroll.
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, yaw, pitch, t: performance.now() };
    lastInput = performance.now();
    canvas.setPointerCapture?.(e.pointerId);
    canvas.classList.add('turning');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const ny = drag.yaw + dx * 0.009;
    vyaw = (ny - yaw) * 0.5;
    yaw = ny;
    if (e.pointerType !== 'touch') pitch = Math.max(-0.12, Math.min(0.72, drag.pitch + dy * 0.005));
    lastInput = performance.now();
    if (reducedMotion()) { vyaw = 0; draw(); } else kick();
  });
  const end = (e) => {
    if (!drag) return;
    drag = null;
    canvas.classList.remove('turning');
    try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* released */ }
    if (reducedMotion()) vyaw = 0;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    cancelAnimationFrame(raf);
    raf = 0;
    onFail?.('context-lost');
  });

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); draw(); }) : null;
  ro?.observe(canvas);
  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; if (visible) { last = 0; kick(); } }, { rootMargin: '80px' })
    : null;
  io?.observe(canvas);
  const onVis = () => { if (!document.hidden) { last = 0; kick(); } };
  document.addEventListener('visibilitychange', onVis);
  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onMotion = () => { cancelAnimationFrame(raf); raf = 0; reveal = 1.05; kick(); };
  motion?.addEventListener?.('change', onMotion);

  resize();

  return {
    kind: 'webgl',
    set(params, { instant = false } = {}) {
      lastInput = performance.now();
      if (!cur || instant || reducedMotion()) {
        cur = params;
        target = null;
        draw();
      } else {
        from = cur;
        target = params;
        tStart = performance.now();
      }
      kick();
    },
    /** Show or hide the lens's layers: { strata, threads, streaks, veil } booleans. */
    setLayers(on) {
      ['strata', 'threads', 'streaks', 'veil'].forEach((key, k) => { layerTarget[k] = on[key] === false ? 0 : 1; });
      lastInput = performance.now();
      if (reducedMotion()) { layers.splice(0, 4, ...layerTarget); draw(); } else kick();
    },
    open() {
      // The opening: the iris widens from a pinhole. Skipped for reduced motion.
      if (reducedMotion()) return;
      reveal = 0.04;
      kick();
    },
    nudge(dYaw) {
      yaw += dYaw;
      lastInput = performance.now();
      if (reducedMotion()) draw(); else kick();
    },
    get tier() { return tier; },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      motion?.removeEventListener?.('change', onMotion);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
