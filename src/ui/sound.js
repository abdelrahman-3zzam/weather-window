// Optional sound layer. Off on every visit, started only by the visitor's
// own press of the sound button (never autoplayed, never remembered as "on"),
// and never needed to understand anything.
//
// Two generated layers, no audio files: a soft air bed (filtered noise whose
// brightness and level follow the selected hour's wind speed) and a light
// patter of filtered clicks whose density follows precipitation chance.
// Scrubbing the day dial plays a short, quiet tick, rate-limited so it never
// chatters. Everything fades in and out over a second.

let ctx = null;
let master = null;
let air = null;
let rain = null;
let rainTimer = 0;
let on = false;
let lastTick = 0;
let mood = { wind: 0.2, precip: 0 };

function noiseBuffer(ac, seconds = 2) {
  const len = ac.sampleRate * seconds;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  // Brown-ish noise: integrated white noise, gentler than hiss.
  let last = 0;
  for (let i = 0; i < len; i += 1) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.2;
  }
  return buf;
}

function build() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 400;
  filter.Q.value = 0.4;
  const gain = ctx.createGain();
  gain.gain.value = 0.2;
  // A slow swell so the bed breathes instead of droning.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.06;
  lfo.connect(lfoGain).connect(gain.gain);
  src.connect(filter).connect(gain).connect(master);
  src.start();
  lfo.start();
  air = { filter, gain };

  const rainGain = ctx.createGain();
  rainGain.gain.value = 0.5;
  const rainFilter = ctx.createBiquadFilter();
  rainFilter.type = 'bandpass';
  rainFilter.frequency.value = 2600;
  rainFilter.Q.value = 0.8;
  rainFilter.connect(rainGain).connect(master);
  rain = { filter: rainFilter, buf: noiseBuffer(ctx, 0.05) };
  return true;
}

function apply() {
  if (!ctx || !air) return;
  const t = ctx.currentTime;
  air.filter.frequency.setTargetAtTime(260 + 1500 * mood.wind, t, 0.8);
  air.gain.gain.setTargetAtTime(0.12 + 0.3 * mood.wind, t, 0.8);
}

function patter() {
  clearTimeout(rainTimer);
  if (!on || !ctx) return;
  if (mood.precip > 0.02) {
    const drop = ctx.createBufferSource();
    drop.buffer = rain.buf;
    drop.playbackRate.value = 0.7 + Math.random() * 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.15 + Math.random() * 0.3;
    drop.connect(g).connect(rain.filter);
    drop.start();
  }
  // Higher chance, denser patter; at zero chance the loop idles quietly.
  const gap = mood.precip > 0.02 ? 40 + (1 - mood.precip) * 420 * Math.random() : 600;
  rainTimer = setTimeout(patter, gap);
}

export function soundSupported() {
  return !!(globalThis.AudioContext || globalThis.webkitAudioContext);
}

export function soundOn() {
  return on;
}

/** Toggle from a user gesture. Returns the new state. */
export async function toggleSound() {
  if (!on) {
    if (!ctx && !build()) return false;
    try { await ctx.resume(); } catch { return false; }
    on = true;
    apply();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0.35, ctx.currentTime, 0.4);
    patter();
  } else {
    on = false;
    clearTimeout(rainTimer);
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    setTimeout(() => { if (!on) ctx?.suspend().catch(() => {}); }, 1200);
  }
  return on;
}

/** Follow the selected moment: wind 0–1 and precipitation chance 0–1. */
export function setMood(next) {
  mood = { wind: Math.max(0, Math.min(1, next.wind ?? 0)), precip: Math.max(0, Math.min(1, next.precip ?? 0)) };
  apply();
}

/** A short tick for dial movement. Quiet and rate-limited. */
export function tick() {
  if (!on || !ctx) return;
  const now = performance.now();
  if (now - lastTick < 55) return;
  lastTick = now;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = 1320;
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
  o.connect(g).connect(master);
  o.start();
  o.stop(ctx.currentTime + 0.07);
}

// Silence when the tab is hidden; resume when it returns.
document.addEventListener('visibilitychange', () => {
  if (!ctx || !on) return;
  if (document.hidden) ctx.suspend().catch(() => {});
  else ctx.resume().catch(() => {});
});
