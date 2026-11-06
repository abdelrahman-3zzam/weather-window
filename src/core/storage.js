// Local persistence. Everything stays in this browser; nothing is synced.
// Every read is validated, and every failure (private mode, quota, blocked
// storage) degrades to "not saved" instead of breaking the page.

import { inRange } from './num.js';
import { validatePrefs } from './matcher.js';

const PREFIX = 'weather-window:v1:';
const MAX_PLACES = 12;
const MAX_CACHE = 4;

function backend() {
  try {
    const s = globalThis.localStorage;
    const probe = `${PREFIX}probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

let store = undefined;
function get() {
  if (store === undefined) store = backend();
  return store;
}

export function storageAvailable() {
  return get() !== null;
}

function read(key) {
  const s = get();
  if (!s) return null;
  try {
    const text = s.getItem(PREFIX + key);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function write(key, value) {
  const s = get();
  if (!s) return false;
  try {
    s.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function validPlace(p) {
  return p !== null && typeof p === 'object'
    && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 120
    && inRange(p.lat, -90, 90) && inRange(p.lon, -180, 180)
    && (p.detail === undefined || (typeof p.detail === 'string' && p.detail.length <= 160));
}

export function placeKey(p) {
  return `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
}

function cleanPlace(p) {
  return { name: p.name, detail: p.detail || '', lat: p.lat, lon: p.lon };
}

const SETTINGS_DEFAULT = { units: 'metric', theme: 'system', introDismissed: false };

export function loadSettings() {
  const s = read('settings');
  const out = { ...SETTINGS_DEFAULT };
  if (s && typeof s === 'object') {
    if (s.units === 'metric' || s.units === 'imperial') out.units = s.units;
    if (['system', 'dark', 'light'].includes(s.theme)) out.theme = s.theme;
    if (typeof s.introDismissed === 'boolean') out.introDismissed = s.introDismissed;
    const prefs = validatePrefs(s.prefs);
    if (prefs.ok) out.prefs = prefs.prefs;
    if (typeof s.profile === 'string' && s.profile.length < 20) out.profile = s.profile;
    if (s.lastPlace && validPlace(s.lastPlace)) out.lastPlace = cleanPlace(s.lastPlace);
  }
  return out;
}

export function saveSettings(settings) {
  const value = {
    units: settings.units,
    theme: settings.theme,
    introDismissed: Boolean(settings.introDismissed),
    prefs: settings.prefs,
    profile: settings.profile,
    lastPlace: settings.lastPlace && validPlace(settings.lastPlace) ? cleanPlace(settings.lastPlace) : undefined,
  };
  return write('settings', value);
}

export function loadPlaces() {
  const list = read('places');
  if (!Array.isArray(list)) return [];
  return list.filter(validPlace).map(cleanPlace).slice(0, MAX_PLACES);
}

export function savePlaces(list) {
  return write('places', list.filter(validPlace).map(cleanPlace).slice(0, MAX_PLACES));
}

/** Cache of raw provider responses, re-validated whenever they are read. */
export function loadCached(place) {
  const index = read('cache-index');
  if (!Array.isArray(index)) return null;
  const key = placeKey(place);
  if (!index.includes(key)) return null;
  const entry = read(`cache:${key}`);
  if (!entry || typeof entry !== 'object' || !inRange(entry.fetchedAt, 0, 1e11) || !entry.raw) return null;
  return entry;
}

export function saveCached(place, raw, fetchedAt) {
  const key = placeKey(place);
  let index = read('cache-index');
  if (!Array.isArray(index)) index = [];
  index = [key, ...index.filter((k) => k !== key && typeof k === 'string')];
  const s = get();
  while (index.length > MAX_CACHE) {
    const old = index.pop();
    try { s && s.removeItem(`${PREFIX}cache:${old}`); } catch { /* ignore */ }
  }
  const ok = write(`cache:${key}`, { fetchedAt, raw });
  write('cache-index', index);
  return ok;
}

/** Remove everything Weather Window saved in this browser. */
export function clearAll() {
  const s = get();
  if (!s) return false;
  try {
    const keys = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => s.removeItem(k));
    return true;
  } catch {
    return false;
  }
}

/** For tests: swap the backend. */
export function _setBackend(b) {
  store = b;
}
