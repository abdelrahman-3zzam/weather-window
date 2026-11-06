// Browser smoke test (Playwright). Serves the site, replaces Open-Meteo with
// fixtures so the run is deterministic and offline, exercises every section,
// and fails on console errors.
//
//   python serve.py --no-browser --port 8790 &   (or any static server)
//   node tests/browser.mjs http://127.0.0.1:8790/ [screenshot-dir]

import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { buildRaw } from './fixtures.js';

const BASE = process.argv[2] || 'http://127.0.0.1:8790/';
const SHOTS = process.argv[3] || null;

function liveFixture() {
  // A Cairo week starting at today's local midnight (UTC+2 or +3; Intl decides).
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const date = fmt.format(now);
  const guess = Date.parse(`${date}T00:00:00Z`) / 1000;
  const offset = (() => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(guess * 1000));
    return Number(p.find((x) => x.type === 'hour').value) * 3600;
  })();
  const start = guess - offset;
  const raw = buildRaw({ zone: 'Africa/Cairo', offset, startUtc: start, temp: (i) => 21 + 7 * Math.sin(((i % 24) - 9) * Math.PI / 12) + (Math.floor(i / 24) === 3 ? -6 : 0) });
  raw.current.time = Math.floor(Date.now() / 1000 / 900) * 900;
  raw.hourly.uv_index[30] = null; // one missing value to exercise the "missing" path
  return raw;
}

const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); };

async function page(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(liveFixture()) }));
  await ctx.route('https://geocoding-api.open-meteo.com/**', (r) => {
    const q = new URL(r.request().url()).searchParams.get('name');
    const results = q.toLowerCase().startsWith('tan') ? [{ name: 'Tanta', admin1: 'Gharbia Governorate', country: 'Egypt', latitude: 30.78847, longitude: 31.00192 }, { name: 'Tanta <img src=x onerror=alert(1)>', country: 'Testland', latitude: 1, longitude: 2 }] : [];
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(q.toLowerCase().startsWith('zz') ? {} : { results }) });
  });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('dialog', (d) => { errors.push(`unexpected dialog: ${d.message()}`); d.dismiss(); });
  return { ctx, p };
}

async function shot(p, name) {
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

// ---------- Desktop, dark ----------
{
  const { ctx, p } = await page({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await p.goto(BASE);
  await p.waitForSelector('.now-temp');
  check('demo loads with synthetic label', (await p.textContent('#status')).includes('Synthetic'));
  check('intro shown on first visit', await p.isVisible('#intro'));
  check('seven day buttons', (await p.locator('.daystrip .day').count()) === 7);
  check('insights rendered', (await p.locator('.insight').count()) >= 4);
  check('3D lens renders with WebGL', (await p.getAttribute('.instrument', 'data-renderer')) === 'webgl');
  check('lens legend names its data sources', (await p.textContent('#encoding')).includes('Precipitation chance') && (await p.textContent('#encoding')).includes('not a simulation'));
  check('week signature drawn with seven days', (await p.locator('.signature .sig-day').count()) === 7);
  // The day dial: keyboard scrubbing changes the hour in the lens and readout.
  const before = await p.textContent('.moment-line');
  await p.focus('.dial-control');
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  const afterDial = await p.textContent('.moment-line');
  check('dial arrow keys move the lens hour', before !== afterDial && afterDial.includes('11:00'), afterDial);
  check('back-to-now offered away from now', await p.isVisible('#back-now'));
  await p.click('#back-now');
  check('back to now restores the current hour', (await p.textContent('.moment-line')).includes('09:00'));
  // Sound: off by default, toggled only by the button.
  check('sound off by default', (await p.getAttribute('#sound-btn', 'aria-pressed')) === 'false');
  await p.click('#sound-btn');
  check('sound toggles on with a press', (await p.getAttribute('#sound-btn', 'aria-pressed')) === 'true');
  await p.click('#sound-btn');
  // Signature card export.
  const [png] = await Promise.all([p.waitForEvent('download'), p.click('#sig-download')]);
  check('signature card downloads as PNG', png.suggestedFilename().endsWith('.png'), png.suggestedFilename());
  await shot(p, 'desktop-overview-demo');

  // Visual collection: thermal relief, living wind, portraits, lens layers.
  check('thermal relief drawn', await p.evaluate(() => { const c = document.querySelector('.thermal-base'); return !!c && c.width > 300; }));
  await p.locator('.thermal-stage').scrollIntoViewIfNeeded();
  await p.focus('.thermal-stage');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowRight');
  check('thermal loupe announces a forecast value by keyboard', /\d{2}:00, -?\d/.test(await p.textContent('.thermal .sr-only')), await p.textContent('.thermal .sr-only'));
  await p.keyboard.press('Enter');
  check('thermal Enter shows that hour in the lens', (await p.textContent('.moment-line')).includes('Tuesday'), await p.textContent('.moment-line'));
  check('living wind: one tile per hour, labelled as artistic', (await p.textContent('.wind-panel')).includes('Artistic rendering') && (await p.textContent('.wind-panel h2')).includes('Tuesday'));
  await p.focus('.wind-stage');
  await p.keyboard.press('ArrowRight');
  check('wind tile readout gives speed and direction', /km\/h from the [NESW]{1,2} \(\d+°\)/.test(await p.textContent('.wind-readout')), await p.textContent('.wind-readout'));
  check('seven day portraits with a published key', (await p.locator('.portraits .portrait').count()) === 7 && (await p.textContent('.pt-key')).includes('Artistic mapping'));
  check('portrait labels carry the actual values', (await p.getAttribute('.portrait >> nth=0', 'aria-label')).includes('mean daytime cloud'));
  await p.click('.portrait >> nth=5');
  check('portrait selects its day', (await p.textContent('.day-detail h2')).includes('Saturday'));
  check('aperture weather glyphs used', (await p.locator('.daystrip .wx .wx-frame').count()) === 7);
  await p.click('.layer-strata');
  check('lens layer toggles', (await p.getAttribute('.layer-strata', 'aria-pressed')) === 'false');
  await p.click('.layer-strata');
  await p.click('.daystrip .day >> nth=3');
  check('selecting a day updates detail', (await p.textContent('.day-detail h2')).includes('Thursday'));
  check('selecting a day moves the lens to 13:00 that day', (await p.textContent('.moment-line')).includes('Thursday') && (await p.textContent('.moment-line')).includes('13:00'));
  await p.click('.segmented button:has-text("Precip")');
  check('metric switch draws bars', (await p.locator('.weekchart svg .bar').count()) > 100);
  await p.focus('.weekchart-svg');
  await p.keyboard.press('ArrowRight');
  check('chart keyboard tooltip', (await p.textContent('.chart-tip')).includes('Precipitation'));

  // Search with an injection attempt in a result name.
  await p.click('#intro .btn.ghost');
  await p.click('#place-btn');
  await p.fill('#search', 'tan');
  await p.waitForSelector('#search-results li');
  check('search results listed', (await p.locator('#search-results li').count()) === 2);
  check('result names rendered as text, not HTML', (await p.locator('#search-results img').count()) === 0);
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelector('#status')?.dataset.state === 'live');
  check('live forecast after selecting a place', (await p.textContent('.place-title')) === 'Tanta');
  for (const w of [1440, 1617, 1000, 920]) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.waitForTimeout(150);
    // Side by side the readout must start right of the lens; stacked, below it.
    const gap = await p.evaluate(() => {
      const r = document.querySelector('.readout').getBoundingClientRect();
      const l = document.querySelector('.instrument').getBoundingClientRect();
      return r.top >= l.bottom - 1 ? r.top - l.bottom : r.left - l.right;
    });
    check(`lens does not overlap readings at ${w}px`, gap >= 0, `${Math.round(gap)}px gap`);
  }
  await p.setViewportSize({ width: 1440, height: 900 });
  check('missing-value banner shown', (await p.textContent('#banner')).includes('Incomplete data'));
  await shot(p, 'desktop-overview-live');

  await p.fill('#search', '').catch(() => {});
  await p.click('#save-btn');
  check('save place', (await p.getAttribute('#save-btn', 'aria-pressed')) === 'true');

  await p.click('a[data-view="planner"]');
  await p.waitForSelector('.heatmap-svg');
  const windows = await p.locator('.window-card').count();
  check('planner finds windows on live fixture', windows > 0, `${windows} cards`);
  await p.click('.chip:has-text("Study outdoors")');
  await p.locator('#f-uv').fill('0');
  await p.waitForTimeout(50);
  const none = await p.textContent('.result-head');
  check('no forced result when nothing matches', none.includes('No window'), none.slice(0, 80));
  check('relaxation suggestions offered', (await p.locator('.relax-btn').count()) > 0 || (await p.textContent('.no-match')).includes('No single change'));
  if (await p.locator('.relax-btn').count()) {
    await p.click('.relax-btn >> nth=0');
    check('applying a relaxation yields a window', (await p.locator('.window-card').count()) > 0);
  }
  await p.focus('.heatmap');
  await p.keyboard.press('ArrowRight');
  check('heatmap inspector by keyboard', (await p.textContent('.inspector')).length > 20);
  check('window cards show their place in the day', (await p.locator('.window-card .wc-day').count()) > 0);
  await shot(p, 'desktop-planner');

  await p.click('a[data-view="lab"]');
  await p.waitForSelector('.lab-svg');
  const meanCells = await p.locator('.stats-table tbody tr:first-child td.num').allTextContents();
  check('lab: both weeks start at mean 25', meanCells.every((t) => t.startsWith('25')), meanCells.join(' / '));
  await p.click('.lane-b .lane-actions button:has-text("+2")');
  const after = await p.locator('.stats-table tbody tr:first-child td.num').allTextContents();
  check('lab: shift +2 moves B mean to 27', after[1].startsWith('27'), after.join(' / '));
  check('lab: changed panel says range unchanged', (await p.textContent('.changed-card')).includes('unchanged'));
  // Keyboard drag on a handle with keep-mean on.
  await p.locator('.lab-handle.lane-a >> nth=2').focus();
  for (let i = 0; i < 6; i += 1) await p.keyboard.press('ArrowUp');
  const a2 = await p.locator('.stats-table tbody tr:first-child td.num').allTextContents();
  check('lab: keep-mean drag keeps A at 25', a2[0].startsWith('25'), a2.join(' / '));
  // Pointer drag.
  const hnd = p.locator('.lab-handle.lane-b >> nth=0');
  const box = await hnd.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2, box.y - 60, { steps: 6 });
  await p.mouse.up();
  check('lab: pointer drag registered', (await p.textContent('.changed-card')).includes('moved a day'));
  await p.click('.lane-a .chip:has-text("This week")');
  check('lab: forecast copy labelled hypothetical', (await p.textContent('.lab-label')).includes('Hypothetical'));
  check('lab: before/after ghost shown after a change', (await p.locator('.lab-ghost').count()) >= 1 && (await p.locator('.lab-shape-ghost').count()) >= 1);
  check('lab: shapes view drawn for both weeks', (await p.locator('.lab-shapes .lab-shape').count()) === 2);
  await shot(p, 'desktop-lab');

  // Units and theme.
  await p.click('#units-btn');
  check('units switch to °F', (await p.textContent('#units-btn')).includes('°F'));
  await p.click('a[data-view="overview"]');
  check('overview shows °F values', /\d+°/.test(await p.textContent('.now-temp')));
  await p.click('#theme-btn');
  check('theme toggles to light', (await p.getAttribute('html', 'data-theme')) === 'light');
  await shot(p, 'desktop-overview-light-imperial');

  // Export.
  await p.click('#menu-btn');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#export-btn')]);
  const path = await dl.path();
  const fs = await import('node:fs');
  const csv = fs.readFileSync(path, 'utf8');
  check('CSV export has provenance and units', csv.includes('# Data status') && csv.includes('temp_max_C'));

  // Empty search.
  await p.click('#place-btn');
  await p.fill('#search', 'zzqx');
  await p.waitForFunction(() => document.querySelector('#search-status').textContent.includes('No places'));
  check('empty search state', true);
  await p.keyboard.press('Escape');

  // Reload: settings, saved place and cache persist; cached copy shown first.
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: true, reason: 'Service unavailable' }) }));
  await p.reload();
  await p.waitForSelector('.now-temp');
  await p.waitForFunction(() => document.querySelector('#banner')?.textContent.includes('Could not refresh'));
  check('failed refresh keeps cached forecast', (await p.textContent('.place-title')) === 'Tanta' && (await p.textContent('#status')).includes('Cached'));
  check('units persisted', (await p.textContent('#units-btn')).includes('°F'));
  check('intro stays dismissed', !(await p.isVisible('#intro')));
  await shot(p, 'desktop-failed-refresh');

  // Privacy: clear everything.
  await p.click('#menu-btn');
  await p.click('#privacy-btn');
  await p.click('#clear-btn');
  const left = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('weather-window')).length);
  check('clear data removes storage', left === 0, `${left} keys left`);
  await ctx.close();
}

// ---------- Mobile, light, reduced motion ----------
{
  const { ctx, p } = await page({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce', hasTouch: true, isMobile: true });
  await p.goto(BASE);
  await p.waitForSelector('.now-temp');
  const overflow = async () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('mobile overview: no horizontal page scroll', (await overflow()) <= 0, `${await overflow()}px`);
  await shot(p, 'mobile-overview');
  await p.click('a[data-view="planner"]');
  await p.waitForSelector('.heatmap-svg');
  check('mobile planner: no horizontal page scroll', (await overflow()) <= 0, `${await overflow()}px`);
  await shot(p, 'mobile-planner');
  await p.click('a[data-view="lab"]');
  await p.waitForSelector('.lab-svg');
  check('mobile lab: no horizontal page scroll', (await overflow()) <= 0, `${await overflow()}px`);
  await shot(p, 'mobile-lab');
  await p.click('#place-btn');
  check('mobile place panel fits', await p.evaluate(() => { const r = document.querySelector('#place-panel').getBoundingClientRect(); return r.right <= window.innerWidth && r.left >= 0; }));
  await shot(p, 'mobile-search');
  await ctx.close();
}

// ---------- No WebGL: 2D fallback ----------
{
  const { ctx, p } = await page({ viewport: { width: 1280, height: 800 } });
  await p.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/.test(type) ? null : orig.call(this, type, ...rest); };
  });
  await p.goto(BASE);
  await p.waitForSelector('.now-temp');
  check('without WebGL the lens falls back to 2D', (await p.getAttribute('.instrument', 'data-renderer')) === '2d');
  check('fallback is labelled', (await p.textContent('.instrument-caption')).includes('2D'));
  check('fallback hides lens layer toggles', await p.locator('.layer-bar').isHidden());
  await ctx.close();
}

// ---------- Storage blocked ----------
{
  const { ctx, p } = await page({ viewport: { width: 1024, height: 768 } });
  await p.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  await p.goto(BASE);
  await p.waitForSelector('.now-temp');
  check('storage blocked: app still renders with notice', (await p.textContent('#banner')).includes('Storage unavailable'));
  await ctx.close();
}

await browser.close();

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
const relevant = errors.filter((e) => !e.includes('503') && !e.includes('Failed to load resource'));
console.log(`\n${results.length - failed}/${results.length} checks passed; ${relevant.length} console errors/warnings`);
relevant.forEach((e) => console.log('  ', e));
process.exit(failed || relevant.length ? 1 : 0);
