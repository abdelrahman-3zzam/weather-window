// Weather Window — application shell: state, data loading, header controls
// and routing. Views live in src/ui/, domain logic in src/core/.

import { h, replace, announce, toast, $ } from './ui/dom.js';
import { icon, brandMark } from './ui/icons.js';
import { createOverview } from './ui/overview.js';
import { createPlanner } from './ui/planner.js';
import { createLab, initialLab } from './ui/labview.js';
import { hourIndexAt } from './ui/dial.js';
import { toggleSound, soundSupported, tick } from './ui/sound.js';
import { reducedMotion } from './ui/dom.js';
import { fetchForecast, searchPlaces, ApiError, coarse } from './data/api.js';
import { normalizeForecast, ForecastError, qualityNote } from './core/normalize.js';
import { demoRaw, DEMO_NOW, DEMO_LOCATION } from './core/demo.js';
import { freshness } from './core/freshness.js';
import { fmtDuration, localParts, weekdayLong } from './core/time.js';
import { DEFAULT_PREFS, validatePrefs } from './core/matcher.js';
import { forecastCsv } from './core/csv.js';
import { fmtTemp, fmtDelta, fmtPrecip, fmtPct, SYSTEMS } from './core/units.js';
import * as store from './core/storage.js';

const VIEWS = ['overview', 'planner', 'lab'];

const settings = store.loadSettings();
const state = {
  units: settings.units,
  theme: settings.theme,
  prefs: settings.prefs || { ...DEFAULT_PREFS },
  profile: settings.profile || 'walk',
  introDismissed: settings.introDismissed,
  places: store.loadPlaces(),
  place: DEMO_LOCATION,
  forecast: null,
  source: 'demo',
  fetchedAt: null,
  loading: false,
  error: null,
  view: 'overview',
  day: 0,
  hour: null, // null follows "now"; otherwise an index into forecast.hours
  metric: 'temp',
  lab: initialLab(),
  present: false,
};

// ---------- Context shared with views ----------
const now = () => (state.source === 'demo' ? DEMO_NOW : Date.now() / 1000);

function fmt() {
  const u = state.units;
  return {
    temp: (v) => fmtTemp(v, u),
    delta: (v, signed) => fmtDelta(v, u, 1, signed).replace(SYSTEMS[u].temp, '°'),
    deltaPlain: (v) => fmtDelta(v, u, 1).replace(SYSTEMS[u].temp, '°'),
    precip: (v) => fmtPrecip(v, u),
    pct: (v) => fmtPct(v),
  };
}

const ctx = {
  state: () => state,
  now,
  fmt,
  freshness: () => freshness(state.source, state.fetchedAt, now(), state.forecast?.span),
  fetchedLabel: () => (state.fetchedAt ? new Date(state.fetchedAt * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null),
  selectDay(i) {
    const f = state.forecast;
    if (!f || i < 0 || i >= f.days.length) return;
    state.day = i;
    // Today follows "now"; another day opens at early afternoon local time.
    const d = f.days[i];
    const nowI = hourIndexAt(f, now());
    if (nowI >= d.hourStart && nowI < d.hourStart + d.hourCount) state.hour = null;
    else if (d.hourStart >= 0) {
      const k = f.hours.slice(d.hourStart, d.hourStart + d.hourCount).findIndex((x) => x.hour === 13);
      state.hour = d.hourStart + (k >= 0 ? k : Math.floor(d.hourCount / 2));
    }
    overview.update(state, 'day');
    if (state.view !== 'overview') go('overview');
    announce(`Showing ${weekdayLong(d.date)}.`);
  },
  setMoment(i, { quiet = false } = {}) {
    const f = state.forecast;
    if (!f) return;
    const nowI = hourIndexAt(f, now());
    if (i === null) {
      if (nowI < 0) return;
      i = nowI;
    }
    const hr = f.hours[i];
    if (!hr) return;
    state.hour = i === nowI ? null : i;
    const di = f.days.findIndex((d) => d.date === hr.date);
    const dayChanged = di >= 0 && di !== state.day;
    if (di >= 0) state.day = di;
    overview.update(state, dayChanged ? 'day' : 'moment');
    if (quiet) tick();
    else announce(`Lens shows ${weekdayLong(hr.date)} ${hr.hhmm}.`);
  },
  showMoment(i) {
    if (i < 0) return;
    if (state.view !== 'overview') go('overview');
    ctx.setMoment(i);
    setTimeout(() => document.querySelector('.instrument')?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }), 80);
  },
  toast,
  setMetric(m) {
    state.metric = m;
    overview.update(state, 'metric');
  },
  setPrefs(p, profile) {
    state.prefs = p;
    state.profile = profile;
    if (validatePrefs(p).ok) persist();
    planner.update(state);
  },
  setLab(patch) {
    state.lab = { ...state.lab, ...patch };
    lab.update(state);
  },
};

// ---------- Views ----------
const overview = createOverview($('#view-overview'), ctx);
const planner = createPlanner($('#view-planner'), ctx);
const lab = createLab($('#view-lab'), ctx);

function persist() {
  const ok = store.saveSettings({
    units: state.units, theme: state.theme, introDismissed: state.introDismissed, prefs: state.prefs, profile: state.profile,
    lastPlace: state.place.demo ? undefined : state.place,
  });
  return ok;
}

function renderAll() {
  renderHeader();
  if (!state.forecast) return;
  overview.update(state, 'all');
  planner.update(state);
  lab.update(state);
}

// ---------- Header ----------
replace($('.brand-slot'), brandMark(30));
replace($('.footer-mark'), brandMark(26));
replace($('.place-btn-icon'), icon('pin', { size: 18 }));
replace($('#search-close'), icon('close', { size: 18 }));
replace($('#refresh-btn'), icon('refresh', { size: 18 }));
replace($('#menu-btn'), icon('grid', { size: 18 }));
replace($('#geo-btn'), icon('locate', { size: 16 }), 'Use my location');
replace($('#export-btn'), icon('download', { size: 16 }), 'Export forecast as CSV');
replace($('#present-btn'), icon('play', { size: 16 }), 'Presentation mode');
replace($('#privacy-btn'), icon('info', { size: 16 }), 'Your data & privacy');

function renderHeader() {
  $('#place-name').textContent = state.place.name;
  const fr = ctx.freshness();
  const status = $('#status');
  status.dataset.state = state.loading ? 'loading' : fr.key;
  const age = fr.age !== undefined && state.source !== 'demo' ? ` · ${fmtDuration(fr.age)}` : '';
  replace(status, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'status-label' }, state.loading ? 'Updating…' : fr.label), h('span', { class: 'status-age' }, state.loading ? '' : age));
  status.title = fr.detail;
  const refresh = $('#refresh-btn');
  refresh.disabled = state.place.demo || state.loading;
  refresh.title = state.place.demo ? 'The demo week is synthetic and never refreshes' : 'Fetch a fresh forecast';
  refresh.classList.toggle('spin', state.loading);
  const saved = !state.place.demo && state.places.some((p) => store.placeKey(p) === store.placeKey(state.place));
  const save = $('#save-btn');
  save.disabled = state.place.demo;
  save.setAttribute('aria-pressed', String(saved));
  save.setAttribute('aria-label', saved ? 'Remove from saved places' : 'Save this place');
  save.title = save.getAttribute('aria-label');
  replace(save, icon('star', { size: 18, cls: saved ? 'filled' : '' }));
  replace($('#units-btn'), state.units === 'metric' ? '°C' : '°F', h('span', { class: 'u-wind' }, state.units === 'metric' ? ' · km/h' : ' · mph'));
  $('#units-btn').setAttribute('aria-label', `Units: ${SYSTEMS[state.units].name}. Switch to ${state.units === 'metric' ? 'imperial' : 'metric'}.`);
  const dark = document.documentElement.dataset.theme === 'dark';
  replace($('#theme-btn'), icon(dark ? 'sun' : 'moon', { size: 18 }));
  $('#theme-btn').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  renderSaved();
  renderBanner();
}

function renderBanner() {
  const b = $('#banner');
  const parts = [];
  if (state.error) {
    parts.push(h('p', { class: 'banner-msg error' }, h('strong', null, state.forecast && state.source !== 'demo' ? 'Could not refresh. ' : 'Could not load the forecast. '), state.error,
      state.forecast && state.source !== 'demo' ? ` Showing the copy retrieved ${fmtDuration(now() - state.fetchedAt)}.` : '',
      state.retry ? h('button', { type: 'button', class: 'btn mini', onclick: state.retry }, 'Try again') : null,
      h('button', { type: 'button', class: 'btn mini ghost', 'aria-label': 'Dismiss', onclick: () => { state.error = null; renderBanner(); } }, icon('close', { size: 14 }))));
  }
  const fr = ctx.freshness();
  if (!state.error && (fr.key === 'stale' || fr.key === 'expired')) {
    parts.push(h('p', { class: 'banner-msg warn' }, h('strong', null, `${fr.label}. `), fr.detail, ' ', h('button', { type: 'button', class: 'btn mini', onclick: () => load(state.place) }, 'Refresh now')));
  }
  if (state.forecast) {
    const q = qualityNote(state.forecast.quality);
    if (q) parts.push(h('p', { class: 'banner-msg info' }, h('strong', null, 'Incomplete data. '), q));
  }
  if (!store.storageAvailable()) parts.push(h('p', { class: 'banner-msg info' }, h('strong', null, 'Storage unavailable. '), 'This browser is blocking local storage, so saved places and settings will not be kept after you leave.'));
  b.hidden = parts.length === 0;
  replace(b, ...parts);
}

// ---------- Data loading ----------
let requestSeq = 0;
let inflight = null;

function adopt(raw, place, source, fetchedAt, at) {
  const forecast = normalizeForecast(raw, at);
  const samePlace = state.forecast && state.place && !state.place.demo && !place.demo && store.placeKey(state.place) === store.placeKey(place);
  state.forecast = forecast;
  state.place = place;
  state.source = source;
  state.fetchedAt = fetchedAt;
  if (!samePlace) {
    const today = localParts(now(), forecast.clock).date;
    const i = forecast.days.findIndex((d) => d.date === today);
    state.day = i >= 0 ? i : 0;
    state.hour = null;
    planner.reset();
  } else {
    state.day = Math.min(state.day, forecast.days.length - 1);
    if (state.hour !== null && state.hour >= forecast.hours.length) state.hour = null;
  }
}

function showDemo() {
  inflight?.abort();
  requestSeq += 1;
  state.loading = false;
  state.error = null;
  adopt(demoRaw(), DEMO_LOCATION, 'demo', null, DEMO_NOW);
  persist();
  renderAll();
}

async function load(place, { useCache = true } = {}) {
  inflight?.abort();
  const seq = ++requestSeq;
  const ctrl = new AbortController();
  inflight = ctrl;

  // Show a cached copy immediately, clearly labelled, while we fetch.
  if (useCache) {
    const cached = store.loadCached(place);
    if (cached) {
      try {
        adopt(cached.raw, place, 'cache', cached.fetchedAt, Date.now() / 1000);
      } catch { /* a corrupt cache entry is ignored */ }
    }
  }
  state.loading = true;
  state.error = null;
  state.retry = null;
  renderAll();

  try {
    const raw = await fetchForecast(place, ctrl.signal);
    if (seq !== requestSeq) return; // a newer request superseded this one
    const at = Date.now() / 1000;
    adopt(raw, place, 'live', at, at);
    store.saveCached(place, raw, at);
    state.loading = false;
    persist();
    renderAll();
    announce(`Forecast for ${place.name} loaded.`);
  } catch (err) {
    if (seq !== requestSeq) return;
    state.loading = false;
    if (err instanceof ApiError && err.code === 'aborted') { renderAll(); return; }
    state.error = err instanceof ApiError || err instanceof ForecastError ? err.message : 'Something unexpected went wrong while reading the forecast.';
    state.retry = () => load(place);
    if (!state.forecast) showDemo();
    renderAll();
    toast(state.error, 'error');
    if (!(err instanceof ApiError) && !(err instanceof ForecastError)) console.error(err);
  } finally {
    if (inflight === ctrl) inflight = null;
  }
}

function selectPlace(place) {
  closePanel();
  const clean = { name: place.name, detail: place.detail || '', lat: coarse(place.lat), lon: coarse(place.lon) };
  load(clean);
}

// ---------- Location panel ----------
const panel = $('#place-panel');
const placeBtn = $('#place-btn');
const search = $('#search');
const results = $('#search-results');
const searchStatus = $('#search-status');
let searchTimer = 0;
let searchCtrl = null;
let found = [];
let active = -1;

function openPanel() {
  panel.hidden = false;
  placeBtn.setAttribute('aria-expanded', 'true');
  search.focus();
}

function closePanel({ focus = true } = {}) {
  if (panel.hidden) return;
  panel.hidden = true;
  placeBtn.setAttribute('aria-expanded', 'false');
  search.setAttribute('aria-expanded', 'false');
  if (focus) placeBtn.focus();
}

placeBtn.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
$('#search-close').addEventListener('click', () => closePanel());
document.addEventListener('pointerdown', (e) => {
  if (!panel.hidden && !e.target.closest('.place-control')) closePanel({ focus: false });
  if (!$('#menu').hidden && !e.target.closest('.actions')) toggleMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!panel.hidden) closePanel();
    if (!$('#menu').hidden) { toggleMenu(false); $('#menu-btn').focus(); }
  }
});

function renderResults() {
  search.setAttribute('aria-expanded', String(found.length > 0));
  replace(results, ...found.map((p, i) => h('li', {
    id: `res-${i}`, role: 'option', class: i === active ? 'active' : '', 'aria-selected': String(i === active),
    onclick: () => selectPlace(p),
  }, h('span', { class: 'res-name' }, p.name), h('span', { class: 'res-detail' }, p.detail || `${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°`))));
  if (active >= 0) search.setAttribute('aria-activedescendant', `res-${active}`);
  else search.removeAttribute('aria-activedescendant');
}

search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = search.value.trim();
  searchCtrl?.abort();
  if (q.length < 2) {
    found = [];
    active = -1;
    renderResults();
    searchStatus.textContent = q.length ? 'Type at least two letters.' : '';
    return;
  }
  searchStatus.textContent = 'Searching…';
  searchTimer = setTimeout(async () => {
    const ctrl = new AbortController();
    searchCtrl = ctrl;
    try {
      const list = await searchPlaces(q, ctrl.signal);
      if (ctrl.signal.aborted) return;
      found = list;
      active = list.length ? 0 : -1;
      renderResults();
      searchStatus.textContent = list.length ? `${list.length} place${list.length > 1 ? 's' : ''} found. Use ↑ ↓ and Enter.` : `No places match “${q}”. Check the spelling or try a nearby larger city.`;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'aborted') return;
      found = [];
      renderResults();
      searchStatus.textContent = err instanceof ApiError ? err.message : 'Search failed.';
    }
  }, 320);
});

search.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' && found.length) { active = (active + 1) % found.length; renderResults(); e.preventDefault(); }
  else if (e.key === 'ArrowUp' && found.length) { active = (active - 1 + found.length) % found.length; renderResults(); e.preventDefault(); }
  else if (e.key === 'Enter' && active >= 0 && found[active]) { selectPlace(found[active]); e.preventDefault(); }
});

$('#geo-btn').addEventListener('click', () => {
  const btn = $('#geo-btn');
  if (!('geolocation' in navigator)) {
    searchStatus.textContent = 'This browser cannot share a location. Search for a city instead.';
    return;
  }
  btn.disabled = true;
  searchStatus.textContent = 'Waiting for your browser’s permission…';
  navigator.geolocation.getCurrentPosition((pos) => {
    btn.disabled = false;
    const lat = coarse(pos.coords.latitude);
    const lon = coarse(pos.coords.longitude);
    searchStatus.textContent = '';
    selectPlace({ name: 'My location', detail: `≈ ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, lat, lon });
    toast('Using your approximate location.', 'ok');
  }, (err) => {
    btn.disabled = false;
    searchStatus.textContent = err.code === 1
      ? 'Location permission was declined. You can search for a city instead.'
      : 'Your location could not be determined. Search for a city instead.';
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
});

$('#demo-btn').addEventListener('click', () => { closePanel(); showDemo(); toast('Showing the synthetic demo week.', 'ok'); });

function renderSaved() {
  const list = $('#saved-list');
  if (!state.places.length) {
    replace(list, h('li', { class: 'muted small empty' }, 'Saved places appear here. Use the star next to the forecast to save one.'));
    return;
  }
  replace(list, ...state.places.map((p) => h('li', null,
    h('button', { type: 'button', class: 'saved-go', onclick: () => selectPlace(p) }, h('span', null, p.name), h('small', null, p.detail)),
    h('button', { type: 'button', class: 'btn ghost icon-only mini', 'aria-label': `Remove ${p.name}`, onclick: () => togglePlace(p) }, icon('trash', { size: 14 })))));
}

function togglePlace(place) {
  const key = store.placeKey(place);
  const has = state.places.some((p) => store.placeKey(p) === key);
  state.places = has ? state.places.filter((p) => store.placeKey(p) !== key) : [{ name: place.name, detail: place.detail, lat: place.lat, lon: place.lon }, ...state.places].slice(0, 12);
  const ok = store.savePlaces(state.places);
  toast(ok ? (has ? `${place.name} removed from saved places.` : `${place.name} saved in this browser.`) : 'Could not save: this browser is blocking storage.', ok ? 'ok' : 'error');
  renderHeader();
}

// ---------- Actions ----------
$('#refresh-btn').addEventListener('click', () => { if (!state.place.demo) load(state.place, { useCache: false }); });
$('#save-btn').addEventListener('click', () => { if (!state.place.demo) togglePlace(state.place); });
$('#units-btn').addEventListener('click', () => {
  state.units = state.units === 'metric' ? 'imperial' : 'metric';
  persist();
  renderAll();
  announce(`Units: ${SYSTEMS[state.units].name}.`);
});

function applyTheme() {
  const sys = globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme === 'system' ? sys : state.theme;
}
$('#theme-btn').addEventListener('click', () => {
  state.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  persist();
  renderHeader();
});
globalThis.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (state.theme === 'system') { applyTheme(); renderHeader(); } });

function toggleMenu(open) {
  $('#menu').hidden = !open;
  $('#menu-btn').setAttribute('aria-expanded', String(open));
  if (open) $('#menu button').focus();
}
$('#menu-btn').addEventListener('click', () => toggleMenu($('#menu').hidden));

$('#export-btn').addEventListener('click', () => {
  toggleMenu(false);
  if (!state.forecast) return;
  const fr = ctx.freshness();
  try {
    const csv = forecastCsv({
      forecast: state.forecast,
      place: state.place.demo ? 'Demo week (synthetic)' : `${state.place.name}${state.place.detail ? `, ${state.place.detail}` : ''}`,
      provenance: state.source === 'demo' ? 'SYNTHETIC DEMO DATA, not a forecast' : `${fr.label} (${fr.detail})`,
      fetchedIso: state.fetchedAt ? new Date(state.fetchedAt * 1000).toISOString() : null,
    });
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const slug = state.place.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place';
    const a = h('a', { href: url, download: `weather-window_${state.place.demo ? 'demo' : slug}_${state.forecast.days[0].date}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('CSV exported. Values are in metric units with labelled columns.', 'ok');
  } catch {
    toast('The export could not be created in this browser.', 'error');
  }
});

$('#present-btn').addEventListener('click', () => {
  toggleMenu(false);
  state.present = !state.present;
  document.body.classList.toggle('present', state.present);
  replace($('#present-btn'), icon('play', { size: 16 }), state.present ? 'Exit presentation mode' : 'Presentation mode');
  toast(state.present ? 'Presentation mode: larger type. Keys 1, 2, 3 switch sections.' : 'Presentation mode off.', 'ok');
  lab.resize();
});

const dialog = $('#privacy-dialog');
$('#privacy-btn').addEventListener('click', () => {
  toggleMenu(false);
  $('#storage-state').textContent = store.storageAvailable()
    ? `Currently saved: ${state.places.length} place${state.places.length === 1 ? '' : 's'}, your settings, and recent forecasts.`
    : 'This browser is not allowing local storage, so nothing is being saved.';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
});
$('#clear-btn').addEventListener('click', () => {
  const ok = store.clearAll();
  state.places = [];
  state.prefs = { ...DEFAULT_PREFS };
  state.profile = 'walk';
  state.introDismissed = false;
  dialog.close?.();
  toast(ok ? 'Everything Weather Window saved in this browser has been cleared.' : 'Storage is unavailable, so there was nothing to clear.', ok ? 'ok' : 'error');
  renderAll();
  renderIntro();
});

// ---------- Sound (optional, off on every visit) ----------
const soundBtn = $('#sound-btn');
function renderSound(on) {
  replace(soundBtn, icon(on ? 'soundOn' : 'soundOff', { size: 18 }));
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', on ? 'Sound on. Turn off the ambient sound layer' : 'Sound off. Turn on the ambient sound layer');
  soundBtn.title = on ? 'Ambient sound is on: wind and precipitation chance of the hour in the lens' : 'Ambient sound (off)';
}
if (!soundSupported()) soundBtn.hidden = true;
renderSound(false);
soundBtn.addEventListener('click', async () => {
  const on = await toggleSound();
  renderSound(on);
  toast(on ? 'Sound on: a quiet air bed follows the wind, a patter follows the precipitation chance.' : 'Sound off.', 'ok');
});

// ---------- Section reveal ----------
const revealer = typeof IntersectionObserver !== 'undefined' && !reducedMotion()
  ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' })
  : null;
for (const el of document.querySelectorAll('.reveal')) {
  if (revealer) revealer.observe(el);
  else el.classList.add('in');
}

// ---------- Intro (first visit) ----------
function renderIntro() {
  const el = $('#intro');
  el.hidden = state.introDismissed || state.view !== 'overview';
  if (state.introDismissed) return;
  replace(el,
    h('div', { class: 'intro-copy' },
      h('p', { class: 'eyebrow' }, 'Weather Window · a week beyond the average'),
      h('h2', { id: 'intro-h', class: 'intro-title' }, 'Does the average tell ', h('em', null, 'the whole story?')),
      h('p', null, 'Two weeks can share the same average and still feel nothing alike. Look through the lens at any hour, find the hours that suit you, and see what an average hides.')),
    h('div', { class: 'intro-actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => { dismissIntro(); openPanel(); } }, icon('search', { size: 16 }), 'See my week'),
      h('a', { class: 'btn', href: '#lab', onclick: dismissIntro }, icon('flask', { size: 16 }), 'Try the 60-second experiment'),
      h('button', { type: 'button', class: 'btn ghost', onclick: dismissIntro }, 'Just explore the demo')),
  );
}

function dismissIntro() {
  state.introDismissed = true;
  persist();
  $('#intro').hidden = true;
}

// ---------- Routing ----------
function go(view) {
  if (location.hash !== `#${view}`) location.hash = view;
  else route();
}

function route() {
  const v = location.hash.replace('#', '');
  const view = VIEWS.includes(v) ? v : 'overview';
  const changed = view !== state.view;
  state.view = view;
  for (const el of document.querySelectorAll('.view')) el.hidden = el.dataset.view !== view;
  $('#intro').hidden = state.introDismissed || view !== 'overview';
  for (const a of document.querySelectorAll('.sections a')) {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = `${{ overview: 'Overview', planner: 'Find your window', lab: 'What-if lab' }[view]} · Weather Window`;
  if (view === 'lab') lab.resize();
  if (changed && state.forecast) {
    if (view === 'overview') overview.update(state, 'all');
    $('#main').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
  }
}
window.addEventListener('hashchange', route);

document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest?.('input, select, textarea, [role="slider"], .weekchart-svg, .heatmap')) return;
  const i = ['1', '2', '3'].indexOf(e.key);
  if (i >= 0) go(VIEWS[i]);
});

// Keep "now", freshness and past-hour exclusion honest while the page stays open.
setInterval(() => {
  if (document.hidden || !state.forecast) return;
  renderHeader();
  if (state.source !== 'demo') planner.update(state);
}, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.forecast) { renderHeader(); if (state.source !== 'demo') planner.update(state); } });
window.addEventListener('resize', () => lab.resize());

// ---------- Start ----------
applyTheme();
renderIntro();
showDemo();
route();
// The opening: the iris widens and the readout focuses in. Nothing waits on it.
if (!reducedMotion()) {
  document.body.classList.add('opening');
  overview.open();
  setTimeout(() => document.body.classList.remove('opening'), 1800);
}
if (settings.lastPlace) load(settings.lastPlace);
