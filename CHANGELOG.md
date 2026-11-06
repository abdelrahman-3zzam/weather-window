# Changelog

## 3.1.0 — 2026-11-01 · "The Aperture: visual collection"
### Added
- **Thermal relief** (Overview): the week's 7×24 hourly temperatures as a topographic field. Catmull-Rom blend, posterised bands every 0.5/1/2/4°, hill-shade and contours, daily max/min marks. A **loupe** follows the pointer (or arrow keys) and shows the raw, unblended forecast cells with numbers; click / Enter shows that hour in the lens. Opening sweep reveal; computed only near the viewport, at CSS resolution, and cached across day changes.
- **Living wind** (Overview): one tile per hour of the selected day, seen from above with north up. Streaks travel the way the forecast wind blows; speed and density follow forecast speed. Labelled "Artistic rendering"; the numbers under the tiles are the forecast. 24 fps, only on screen; still streamlines under reduced motion; keyboard and pointer select an hour.
- **Seven days, seven atmospheres**: a generated portrait per day. The horizon is the day's 24 hourly temperatures on the week scale (forecast); sky, sun, cloud bands and rain streaks follow cloud cover, UV max, precipitation chance/sum and mean wind through a published key. Click to select a day.
- **Aperture weather glyphs**: an original glyph family (window circle + solar disc, cloud strata, falling marks) replacing the generic line icons for conditions.
- **Lens layers**: Strata (temperature), Threads (wind), Veil (cloud), Streaks (precipitation) can be peeled away to see one value at a time. Hidden in the 2D fallback.
- **Lab before/after**: every change is animated (0.5 s) and leaves a dashed "before" line on the chart and in the shapes view until the next change.
- **Provenance labels** (`.prov`): Forecast · Derived · Artistic · Hypothetical · Synthetic.
- 3 unit tests (thermal grid incl. DST, wind flow vectors and tiles, portrait inputs) and 12 browser checks.

### Changed
- Day selection no longer recomputes heavy visuals: thermal field and portraits are cached; day switch ~30 ms of script on the test machine (was ~430 ms before caching).

## 3.0.0 — 2026-10-31 · "The Aperture"
### Added
- Signature 3D lens (plain WebGL, custom shader): glass air column on a topographic plinth; strata coloured by temperature, air threads drifting with wind speed and direction, cloud veil from cloud cover, streaks from precipitation chance, light from UV and the real sun times. Drag to turn. Adaptive quality, idle throttling, off-screen pause, reduced-motion stills, 2D fallback on missing WebGL or context loss.
- Day dial around the lens: one turn = one local day, hourly temperature marks on the week scale, precipitation-chance dots, daylight arc, now mark, draggable solar index, full keyboard control (arrows, Page Up/Down, Home/End).
- "How to read the lens" legend generated from the same encoding the shader uses.
- Week signature (circle = hourly average, lines = days) with day keys, and a downloadable 1080×1350 PNG card with provenance.
- Lab: "Same circle, different shapes" view of both weeks.
- Planner: each window shows its place in the day (night shaded) and links to the lens.
- Optional generated sound layer (off by default, per visit).
- Opening: iris widens from a pinhole and the readout focuses in (no waiting); section reveals.
- Wind direction from Open-Meteo (`wind_direction_10m`), shown in readout and hourly table.
- 4 unit tests (encoding, moment selection, signature geometry) and 18 browser checks (WebGL, 2D fallback, dial keyboard, back-to-now, sound default, PNG export, planner day bars, lab shapes).

### Changed
- New identity: Aperture mark, wordmark, Newsreader / Hanken Grotesk / Martian Mono, basalt–limestone–petrol–solar palette, plates with registration ticks, hairline layouts, solar index for selection, motion tokens. Favicon, touch icon, social image regenerated.
- Overview reorganised around one selected moment (lens, readout, dial, chart marker, table highlight).
- Chart click / Enter now shows that hour in the lens.


## 2.0.0 — 2026-10-30
Rebuilt as a static web product. The Python/NiceGUI 1.x app is unchanged and remains the course deliverable.

### Added
- Overview: data-driven "window" sky illustration, seven-day strip with shared-scale range bars, 168-hour chart with five metrics, night shading, now marker, keyboard reading; selected-day detail with defined quantities, UV category and WHO link, hour-by-hour table; weekly story and data-checked insights.
- Find your window: profiles, live sliders with unit conversion, overnight intervals, minimum duration, 7×24 status grid with keyboard inspector, ranked windows with explanations and per-hour checks, side-by-side comparison, failure breakdown and one-step relaxations, copyable plan summary.
- What-if lab: two weeks on one chart, pointer and keyboard dragging, keep-mean mode, shift/exaggerate/smooth, comfort band, forecast copy, balance-beam view with ±1 SD, same/differs statistics table, change explanations, guided 60-second experiment.
- Live/Cached/Stale/Expired/Synthetic labels, failed-refresh recovery, cached instant start, request cancellation and out-of-order protection, 12 s timeouts, rate-limit message.
- Opt-in geolocation rounded to ~1 km, saved places, privacy dialog with clear-all, storage-blocked mode.
- Units (metric/imperial), dark/light themes, presentation mode, CSV export with provenance and formula neutralisation.
- 25 unit tests and a 37-check Playwright smoke test; README, decision log, security headers, social image, favicon, manifest.

### Changed
- Time handling is DST-correct (unix timestamps + IANA zone).
- Missing values no longer invalidate the whole forecast.
- Planner ranking now uses comfort margin over windows (see DECISIONS D4).
