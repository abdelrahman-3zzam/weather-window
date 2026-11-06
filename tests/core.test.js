import test from 'node:test';
import assert from 'node:assert/strict';

import { mean, range, stdDev, maxStep, countWithin, summarize } from '../src/core/stats.js';
import { isNum, numOrNull, round } from '../src/core/num.js';
import { tempTo, tempFrom, tempDeltaTo, windTo, windFrom, fmtTemp } from '../src/core/units.js';
import { normalizeForecast, ForecastError } from '../src/core/normalize.js';
import { demoRaw, DEMO_NOW } from '../src/core/demo.js';
import { makeClock, localParts, isIsoDate, addDays } from '../src/core/time.js';
import {
  validatePrefs, evaluateHour, findWindows, inInterval, suggestRelaxations, intervalLength, DEFAULT_PREFS,
} from '../src/core/matcher.js';
import { PRESETS, fromPreset, shiftAll, setDay, labStats, compareStats, stretch, fromForecast } from '../src/core/lab.js';
import { weeklyInsights, weekStory } from '../src/core/insights.js';
import { csvCell, forecastCsv } from '../src/core/csv.js';
import { freshness } from '../src/core/freshness.js';
import * as storage from '../src/core/storage.js';
import { buildRaw, LONDON_DST } from './fixtures.js';
import { encodeMoment, momentFor, tempColor, compass, sunPath, blendParams } from '../src/core/encoding.js';
import { contourPath, weekGeometry } from '../src/ui/signature.js';
import { thermalGrid } from '../src/ui/thermal.js';
import { flowVector, windTiles } from '../src/ui/wind.js';
import { portraitInputs } from '../src/ui/portraits.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('numeric guards reject NaN, Infinity, booleans, strings', () => {
  assert.equal(isNum(NaN), false);
  assert.equal(isNum(Infinity), false);
  assert.equal(isNum(true), false);
  assert.equal(isNum('3'), false);
  assert.equal(isNum(0), true);
  assert.equal(numOrNull(120, 0, 100), null);
  assert.equal(round(-0.4), 0);
});

test('statistics on the original "average trap" weeks', () => {
  const a = [24, 25, 24, 25, 24, 25, 28];
  const b = [19, 31, 20, 30, 21, 29, 25];
  assert.equal(mean(a), 25);
  assert.equal(mean(b), 25);
  assert.equal(range(a), 4);
  assert.equal(range(b), 12);
  assert.equal(maxStep(a).size, 3);
  assert.equal(maxStep(b).size, 12);
  assert.equal(countWithin(a, 24, 26), 6);
  assert.equal(countWithin(b, 24, 26), 1);
  // Population SD: sqrt(mean of squared deviations).
  close(stdDev(a), Math.sqrt((1 + 0 + 1 + 0 + 1 + 0 + 9) / 7));
  close(stdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2);
  assert.equal(stdDev([25, 25, 25]), 0);
  assert.equal(maxStep([25]), null);
});

test('statistics refuse incomplete data instead of treating gaps as zero', () => {
  assert.equal(mean([1, null, 3]), null);
  assert.equal(range([]), null);
  assert.equal(stdDev(undefined), null);
  assert.equal(countWithin([1, 2], 3, 1), null);
});

test('unit conversion: offsets for values, scale only for differences', () => {
  assert.equal(tempTo(0, 'imperial'), 32);
  assert.equal(tempTo(100, 'imperial'), 212);
  close(tempFrom(212, 'imperial'), 100);
  assert.equal(tempDeltaTo(10, 'imperial'), 18);
  close(windFrom(windTo(30, 'imperial'), 'imperial'), 30);
  assert.equal(fmtTemp(null, 'metric'), '—');
});

test('every preset has the same mean daily maximum of 25 °C', () => {
  for (const key of Object.keys(PRESETS)) {
    close(mean(fromPreset(key).highs), 25);
  }
});

test('uniform shift moves the mean by the shift and leaves range and SD unchanged', () => {
  const s = fromPreset('seesaw');
  const before = labStats(s);
  const after = labStats(shiftAll(s, 3));
  close(after.mean, before.mean + 3);
  close(after.range, before.range);
  close(after.sd, before.sd);
  close(after.maxStep, before.maxStep);
  close(after.meanLow, before.meanLow + 3);
  // The original object is untouched.
  assert.deepEqual(s.highs, PRESETS.seesaw.highs);
});

test('setDay with keepMean keeps the mean exactly while the spread changes', () => {
  const s = fromPreset('flat');
  const edited = setDay(s, 3, 35, true);
  close(mean(edited.highs), 25);
  assert.ok(stdDev(edited.highs) > 0);
  // The edited day's range (high − low) is preserved.
  close(edited.highs[3] - edited.lows[3], s.highs[3] - s.lows[3]);
  const free = setDay(s, 3, 35, false);
  close(mean(free.highs), 25 + 10 / 7);
});

test('stretch keeps the mean and scales the SD', () => {
  const s = fromPreset('steady');
  const st = stretch(s, 2);
  close(mean(st.highs), 25);
  close(stdDev(st.highs), 2 * stdDev(s.highs));
});

test('compareStats reports same means for steady and seesaw, different ranges', () => {
  const band = [24, 26];
  const c = compareStats(labStats(fromPreset('steady'), band), labStats(fromPreset('seesaw'), band));
  assert.equal(c.mean, 'same');
  assert.equal(c.range, 'different');
  assert.equal(c.inBand, 'different');
});

test('time: IANA zone parts and fixed-offset fallback', () => {
  const t = Date.UTC(2026, 6, 1, 12, 0, 0) / 1000;
  assert.equal(localParts(t, makeClock('Africa/Cairo', 0)).hour, 15);
  assert.equal(localParts(t, makeClock('Not/AZone', 7200)).hour, 14);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('normalize: the demo week passes validation with 7 days and 168 hours', () => {
  const f = normalizeForecast(demoRaw(), DEMO_NOW);
  assert.equal(f.days.length, 7);
  assert.equal(f.hours.length, 168);
  assert.equal(f.days[0].date, '2026-10-19');
  assert.equal(f.hours[0].hhmm, '00:00');
  assert.ok(f.days.every((d) => d.hourCount === 24));
  assert.equal(f.quality.missingFields.length, 0);
});

test('normalize: daylight-saving end gives a 25-hour local day and correct dates', () => {
  const f = normalizeForecast(buildRaw(LONDON_DST));
  assert.deepEqual(f.days.map((d) => d.date), ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
  const sun = f.days[3];
  assert.equal(sun.hourCount, 25);
  const labels = f.hours.slice(sun.hourStart, sun.hourStart + 4).map((h) => h.hhmm);
  assert.deepEqual(labels, ['00:00', '01:00', '01:00', '02:00']);
  assert.equal(f.days[6].hourCount, 23);
});

test('normalize: missing values become null and are counted, never zero', () => {
  const raw = buildRaw({ ...LONDON_DST, overrides: { 'hourly.uv_index.5': null, 'hourly.wind_speed_10m.6': -3, 'daily.temperature_2m_max.2': 'hot' } });
  const f = normalizeForecast(raw);
  assert.equal(f.hours[5].uv, null);
  assert.equal(f.hours[6].wind, null);
  assert.equal(f.days[2].high, null);
  assert.equal(f.quality.missingValues['hourly.uv'], 1);
});

test('normalize: missing whole fields degrade, structural errors throw', () => {
  const raw = buildRaw(LONDON_DST);
  delete raw.hourly.uv_index;
  const f = normalizeForecast(raw);
  assert.ok(f.quality.missingFields.includes('hourly.uv'));
  assert.ok(f.hours.every((h) => h.uv === null));

  assert.throws(() => normalizeForecast({ error: true, reason: 'Bad latitude' }), ForecastError);
  assert.throws(() => normalizeForecast({ hourly: { time: ['2026-10-01T00:00'] }, daily: { time: [] } }), ForecastError);
  const wrongUnit = buildRaw(LONDON_DST);
  wrongUnit.hourly_units.temperature_2m = '°F';
  assert.throws(() => normalizeForecast(wrongUnit), /unit/);
  const gap = buildRaw(LONDON_DST);
  gap.hourly.time[10] += 60;
  assert.throws(() => normalizeForecast(gap), /evenly/);
});

test('preferences: validation catches inverted temperatures, equal hours, bad durations', () => {
  assert.equal(validatePrefs(DEFAULT_PREFS).ok, true);
  assert.equal(validatePrefs({ ...DEFAULT_PREFS, tempMin: 30, tempMax: 20 }).ok, false);
  assert.equal(validatePrefs({ ...DEFAULT_PREFS, startHour: 8, endHour: 8 }).ok, false);
  assert.equal(validatePrefs({ ...DEFAULT_PREFS, startHour: 0, endHour: 24 }).ok, true);
  assert.equal(validatePrefs({ ...DEFAULT_PREFS, startHour: 8, endHour: 10, minHours: 3 }).ok, false);
  assert.equal(validatePrefs({ ...DEFAULT_PREFS, rh: NaN }).ok, false);
  assert.equal(validatePrefs({ ...DEFAULT_PREFS, startHour: 7.5 }).ok, false);
});

test('time intervals: end is exclusive, overnight wraps', () => {
  const day = { startHour: 8, endHour: 19 };
  assert.equal(inInterval(8, day), true);
  assert.equal(inInterval(18, day), true);
  assert.equal(inInterval(19, day), false);
  const night = { startHour: 22, endHour: 3 };
  assert.equal(inInterval(23, night), true);
  assert.equal(inInterval(2, night), true);
  assert.equal(inInterval(3, night), false);
  assert.equal(inInterval(12, night), false);
  assert.equal(intervalLength(night), 5);
});

const base = { t: 1000000, hour: 10, temp: 22, rh: 50, wind: 10, pop: 10, uv: 2 };
const prefs = { tempMin: 18, tempMax: 26, rh: 70, wind: 20, pop: 30, uv: 4, startHour: 8, endHour: 19, minHours: 1 };

test('evaluateHour uses only the same hour and never treats missing as zero', () => {
  assert.equal(evaluateHour(base, prefs, 0).status, 'match');
  assert.equal(evaluateHour({ ...base, uv: null }, prefs, 0).status, 'unknown');
  assert.equal(evaluateHour({ ...base, uv: null, wind: 40 }, prefs, 0).status, 'miss');
  assert.equal(evaluateHour({ ...base, temp: 17.9 }, prefs, 0).status, 'miss');
  assert.equal(evaluateHour(base, prefs, base.t + 1).status, 'past');
  assert.equal(evaluateHour({ ...base, hour: 19 }, prefs, 0).status, 'outside');
  const e = evaluateHour(base, prefs, 0);
  assert.ok(e.score > 0 && e.score <= 1);
  // Temperature exactly at the midpoint has full headroom.
  assert.equal(e.checks.find((c) => c.key === 'tempMax').headroom, 1);
});

test('findWindows groups consecutive hours, honours minimum duration, ranks by margin', () => {
  const hours = [];
  for (let i = 0; i < 12; i += 1) hours.push({ ...base, t: 1000000 + i * 3600, hour: 8 + i });
  hours[3] = { ...hours[3], wind: 30 }; // breaks the run: 8,9,10 | 12..19
  hours[8] = { ...hours[8], uv: 3.9 }; // weaker hour inside the second run
  const r = findWindows(hours, { ...prefs, minHours: 2 }, 0);
  assert.equal(r.windows.length, 2);
  assert.ok(r.windows.every((w) => w.length >= 2));
  assert.equal(r.windows[0].start, hours[0].t); // shorter run has the better average margin
  assert.equal(r.windows[1].length, 7);
  assert.equal(r.counts.miss, 1);
  assert.equal(r.counts.outside, 1); // 19:00 is excluded by the [8,19) interval
  const none = findWindows(hours, { ...prefs, uv: 1 }, 0);
  assert.equal(none.windows.length, 0);
});

test('suggestRelaxations finds the smallest change that yields a window', () => {
  const hours = [];
  for (let i = 0; i < 6; i += 1) hours.push({ ...base, t: 1000000 + i * 3600, hour: 9 + i, wind: 22 + i });
  const s = suggestRelaxations(hours, { ...prefs, minHours: 2 }, 0);
  const wind = s.find((x) => x.key === 'wind');
  assert.equal(wind.to, 23);
  assert.equal(s[0].key, 'wind');
});

test('planner on the demo week: no past hours, all matches satisfy every limit', () => {
  const f = normalizeForecast(demoRaw(), DEMO_NOW);
  const r = findWindows(f.hours, DEFAULT_PREFS, DEMO_NOW);
  assert.ok(r.windows.length > 0);
  for (const w of r.windows) {
    assert.ok(w.start >= DEMO_NOW);
    for (const e of w.hours) {
      const h = e.hour;
      assert.ok(h.temp >= DEFAULT_PREFS.tempMin && h.temp <= DEFAULT_PREFS.tempMax);
      assert.ok(h.rh <= DEFAULT_PREFS.rh && h.wind <= DEFAULT_PREFS.wind && h.pop <= DEFAULT_PREFS.pop && h.uv <= DEFAULT_PREFS.uv);
      assert.ok(h.hour >= DEFAULT_PREFS.startHour && h.hour < DEFAULT_PREFS.endHour);
    }
  }
});

const fmt = {
  temp: (v) => `${Math.round(v)}°`, delta: (v, s) => `${s && v > 0 ? '+' : ''}${Math.round(v * 10) / 10}°`,
  deltaPlain: (v) => `${Math.round(v * 10) / 10}°`, precip: (v) => `${v} mm`, pct: (v) => `${v}%`,
};

test('insights only appear when computable and name their quantity', () => {
  const f = normalizeForecast(demoRaw(), DEMO_NOW);
  const ins = weeklyInsights(f.days, fmt);
  const ids = ins.map((i) => i.id);
  assert.ok(ids.includes('average'));
  assert.ok(ids.includes('warmest'));
  assert.equal(ins.find((i) => i.id === 'warmest').day, 2);
  assert.equal(ins.find((i) => i.id === 'wet').day, 3);
  assert.match(ins.find((i) => i.id === 'wet').detail, /separate quantity/);
  const broken = f.days.map((d, i) => (i === 1 ? { ...d, high: null } : d));
  const ins2 = weeklyInsights(broken, fmt).map((i) => i.id);
  assert.ok(!ins2.includes('average') && !ins2.includes('swing'));
  assert.match(weekStory(broken, fmt), /missing/);
});

test('lab: forecast copy refuses incomplete data', () => {
  const f = normalizeForecast(demoRaw(), DEMO_NOW);
  assert.ok(fromForecast(f.days, 'Demo'));
  assert.equal(fromForecast(f.days.map((d, i) => (i ? d : { ...d, low: null })), 'Demo'), null);
});

test('CSV neutralises formulas and quotes separators', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('Kafr El-Sheikh, Egypt'), '"Kafr El-Sheikh, Egypt"');
  assert.equal(csvCell(null), '');
  const f = normalizeForecast(demoRaw(), DEMO_NOW);
  const csv = forecastCsv({ forecast: f, place: 'Demo', provenance: 'Synthetic demo' });
  assert.match(csv, /temp_max_C/);
  assert.equal(csv.split('\r\n').filter((l) => l.startsWith('hourly,')).length, 168);
});

test('freshness labels', () => {
  const now = 2000000000;
  const span = { start: now - 3600, end: now + 86400 };
  assert.equal(freshness('demo', 0, now).key, 'synthetic');
  assert.equal(freshness('live', now - 60, now, span).key, 'live');
  assert.equal(freshness('cache', now - 60, now, span).key, 'cached');
  assert.equal(freshness('live', now - 2 * 3600, now, span).key, 'cached');
  assert.equal(freshness('cache', now - 4 * 3600, now, span).key, 'stale');
  assert.equal(freshness('cache', now - 60, now, { start: 0, end: now - 1 }).key, 'expired');
});

test('storage validates what it reads and survives a broken backend', () => {
  const mem = new Map();
  storage._setBackend({
    getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k),
    key: (i) => [...mem.keys()][i], get length() { return mem.size; },
  });
  storage.savePlaces([{ name: 'Tanta', lat: 30.8, lon: 31 }, { name: '<b>x</b>', lat: 200, lon: 0 }]);
  assert.equal(storage.loadPlaces().length, 1);
  mem.set('weather-window:v1:settings', '{not json');
  assert.equal(storage.loadSettings().units, 'metric');
  mem.set('weather-window:v1:settings', JSON.stringify({ units: 'kelvin', theme: 'dark', prefs: { ...DEFAULT_PREFS, tempMin: 99 } }));
  const s = storage.loadSettings();
  assert.equal(s.units, 'metric');
  assert.equal(s.theme, 'dark');
  assert.equal(s.prefs, undefined);
  assert.equal(storage.clearAll(), true);
  assert.equal(mem.size, 0);

  storage._setBackend({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } });
  assert.deepEqual(storage.loadPlaces(), []);
  assert.equal(storage.savePlaces([{ name: 'a', lat: 0, lon: 0 }]), false);
  storage._setBackend(null);
  assert.equal(storage.storageAvailable(), false);
});


test('encoding: each lens effect follows one value, and missing values switch it off', () => {
  const base = { t: 5000, temp: 20, wind: 25, windDir: 270, cloud: 60, pop: 40, uv: 5, code: 2, isDay: 1, sunrise: 0, sunset: 10000 };
  const e = encodeMoment(base);
  close(e.params.haze, 0.6);
  close(e.params.precip, 0.4);
  assert.equal(e.night, 0);
  // Wind from the west (270°) drifts toward the east (+x).
  close(e.params.windDir[0], 1, 1e-9);
  close(e.params.windDir[1], 0, 1e-9);
  // Monotonic: more cloud, denser veil; more chance, more streaks.
  assert.ok(encodeMoment({ ...base, cloud: 90 }).params.haze > e.params.haze);
  assert.ok(encodeMoment({ ...base, pop: 80 }).params.precip > e.params.precip);
  assert.ok(encodeMoment({ ...base, wind: 50 }).params.wind > e.params.wind);
  const missing = encodeMoment({ ...base, cloud: null, pop: null, windDir: null, temp: null });
  assert.equal(missing.params.haze, 0);
  assert.equal(missing.params.precip, 0);
  assert.deepEqual(missing.params.windDir, [0, 0]);
  assert.match(missing.legend.find((r) => r.key === 'haze').data, /unavailable/);
  assert.match(missing.legend.find((r) => r.key === 'colour').data, /unavailable/);
  assert.match(e.legend.find((r) => r.key === 'streaks').note, /not an amount/);
  const night = encodeMoment({ ...base, isDay: 0, t: 20000 });
  assert.equal(night.params.light, 0);
  assert.equal(night.night, 1);
});

test('encoding: temperature ramp, compass and sun path are well behaved', () => {
  assert.deepEqual(tempColor(null), [128, 136, 134]);
  assert.deepEqual(tempColor(-50), tempColor(-15));
  const warm = tempColor(30);
  const cool = tempColor(0);
  assert.ok(warm[0] > cool[0] && warm[2] < cool[2]);
  assert.equal(compass(0), 'N');
  assert.equal(compass(359), 'N');
  assert.equal(compass(225), 'SW');
  assert.equal(compass(null), null);
  const noon = sunPath({ t: 5000, sunrise: 0, sunset: 10000 }, 30);
  assert.ok(noon.up && Math.abs(noon.azimuth - 180) < 1e-9);
  assert.equal(sunPath({ t: 12000, sunrise: 0, sunset: 10000 }).up, false);
  assert.equal(sunPath({ t: 5000, sunrise: null, sunset: 10000 }), null);
  const mid = blendParams({ haze: 0, windDir: [0, 0] }, { haze: 1, windDir: [1, 0] }, 0.5);
  close(mid.haze, 0.5);
  close(mid.windDir[0], 0.5);
});

test('lens moment uses the current block only for "now", and the hour otherwise', () => {
  const f = normalizeForecast(demoRaw(), DEMO_NOW);
  const i = f.hours.findIndex((x) => DEMO_NOW >= x.t && DEMO_NOW < x.t + 3600);
  const nowM = momentFor(f, i, { useCurrent: true });
  assert.equal(nowM.isCurrent, true);
  assert.equal(nowM.temp, f.current.temp);
  assert.equal(nowM.pop, f.hours[i].pop); // chance always comes from the hour
  const later = momentFor(f, i + 5);
  assert.equal(later.isCurrent, false);
  assert.equal(later.temp, f.hours[i + 5].temp);
  assert.equal(momentFor(f, 9999), null);
});

test('signature: the circle is the hourly mean; gaps break lines instead of closing them', () => {
  const f = normalizeForecast(demoRaw(), DEMO_NOW);
  const g = weekGeometry(f);
  const temps = f.hours.map((x) => x.temp);
  close(g.mean, temps.reduce((a, b) => a + b, 0) / temps.length, 1e-9);
  assert.equal(g.days.length, 7);
  assert.ok(g.days.every((d) => d.path.endsWith('Z')));
  const open = contourPath([1, 2, null, 4, 5], 3, 50, 2);
  assert.ok(!open.endsWith('Z'));
  assert.equal((open.match(/M/g) || []).length, 2);
});

test('thermal grid: one row per day, each forecast hour in its own cell', () => {
  const f = normalizeForecast(demoRaw(), DEMO_NOW);
  const g = thermalGrid(f);
  assert.equal(g.length, f.days.length);
  const d = f.days[2];
  const x = f.hours[d.hourStart + 15];
  assert.equal(g[2].row[x.hour], x.temp);
  assert.equal(g[2].idx[x.hour], d.hourStart + 15);
  // DST: a 23- or 25-hour day still maps onto 24 clock-hour cells, each
  // pointing at a distinct real forecast hour (or left empty), never invented.
  const lf = normalizeForecast(buildRaw(LONDON_DST));
  for (const r of thermalGrid(lf)) {
    const used = r.idx.filter((j) => j >= 0);
    assert.equal(new Set(used).size, used.length);
    r.idx.forEach((j, hr) => { if (j >= 0) assert.equal(lf.hours[j].hour, hr); else assert.equal(r.row[hr], null); });
  }
});

test('wind: tiles flow the way the wind blows toward, and keep actual values', () => {
  // A north wind (from 0°) blows toward the south: down the screen.
  const [x, y] = flowVector(0);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y - 1) < 1e-9);
  const [ex, ey] = flowVector(270); // from the west, toward the east
  assert.ok(Math.abs(ex - 1) < 1e-9 && Math.abs(ey) < 1e-9);
  const f = normalizeForecast(demoRaw(), DEMO_NOW);
  const tiles = windTiles(f, 1);
  assert.equal(tiles.length, f.days[1].hourCount);
  const h = f.hours[tiles[5].i];
  assert.equal(tiles[5].wind, h.wind);
  assert.equal(tiles[5].dir, h.windDir);
});

test('portraits: inputs come straight from the forecast; missing values stay missing', () => {
  const f = normalizeForecast(demoRaw(), DEMO_NOW);
  const inp = portraitInputs(f, 0);
  assert.equal(inp.high, f.days[0].high);
  assert.equal(inp.popMax, f.days[0].popMax);
  assert.equal(inp.temps.length, f.days[0].hourCount);
  assert.ok(inp.cloud >= 0 && inp.cloud <= 100);
  assert.ok(inp.windFrom >= 0 && inp.windFrom < 360);
  const g = structuredClone(f);
  for (const x of g.hours) { x.windDir = null; x.cloud = null; }
  const miss = portraitInputs(g, 0);
  assert.equal(miss.windFrom, null);
  assert.equal(miss.cloud, null);
});
