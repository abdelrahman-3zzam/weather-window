# Decision log — Weather Window 2.0

Short records of consequential choices. Newest last.

## D1 · Static web app beside the Python app, not a replacement (2026-10-30)
**Found:** the latest working version was a Python/NiceGUI app (`weather_window_app.py`). The self-contained HTML version described in the brief was not in the project folders.
**Options:** (a) keep extending NiceGUI; (b) React + TypeScript + Vite; (c) vanilla ES modules, no build.
**Chosen:** (c). NiceGUI needs a running Python server per visitor, so it cannot be published on free static hosting, and its component model limits the custom visual work. React/TS would add a toolchain the project does not otherwise need for ~3k lines of UI. Plain modules give a static, zero-dependency site that any host can serve and that `python serve.py` runs locally.
**Kept:** the Python app is untouched; it remains the Structured Programming course deliverable. Its rules (same-hour matching, validation bounds, uniform shift, the 24/25/… vs 19/31/… "average trap" weeks) were carried over and are now unit-tested in JS.

## D2 · Unix timestamps + IANA timezone for all time logic
Open-Meteo's ISO local times use one fixed UTC offset for the whole response, so they drift by an hour after a daylight-saving change. Requests use `timeformat=unixtime`; local dates/hours are derived with `Intl.DateTimeFormat` and the returned `timezone`. A 25-hour local day is handled (tested with London, 25 Oct 2026). Daily `time` values are read 12 h after the given instant so a one-hour shift cannot change the date.

## D3 · Missing values are null, never zero; partial data degrades, structure errors fail
The old normalizer rejected the whole week if any single value was missing. Now: structural problems (no timestamps, wrong units, gaps in the hourly series) fail with a clear message; individual missing/out-of-range values become null, are counted in a banner, break chart lines, block statistics that need them, and make planner hours "unknown" rather than matches.

## D4 · Planner: windows, ranked by comfort margin
**Old rule:** single hours sorted by lowest UV, then rain, then distance from the temperature midpoint. Lexicographic UV-first ranking could prefer an hour at the edge of every other limit.
**New rule:** consecutive matching hours form windows; windows shorter than the chosen minimum duration are dropped. Each hour gets a comfort margin = mean headroom across the five quantities (temperature: 1 − |t − midpoint| / half-band; others: (limit − value) / limit), from 0 (on a limit) to 1. Windows rank by mean margin, then length, then start time. Each card names its tightest constraint. The same-hour rule, past-hour exclusion and "no forced result" are unchanged.
**Interval semantics:** [start, end), end may be 24; start > end means overnight and wraps. Start = end is rejected (00–24 means all day).
**Relaxation:** for each constraint separately, the smallest value that would create at least one qualifying window with every other limit fixed.

## D5 · What-if Lab models temperature only
Scenarios contain daily maxima and minima. Dragging a day moves its min with its max (daily range preserved). "Keep mean fixed" spreads the opposite change equally across the other six days, so the mean is exactly preserved. All presets average 25 °C. SD is the population SD (÷n) because the lab describes these seven days, not a sample. A forecast copy is labelled "hypothetical once edited" and never written back.

## D6 · No 3D library; one small data-driven canvas
Three.js (~150 kB gzipped) was considered for a 3D cloud/timeline. Rejected: it would be the heaviest part of the page while adding little understanding. The signature visuals are instead (1) the window: a 2D canvas sky driven by cloud cover, day/night, sun position between real sunrise and sunset, and precipitation type, capped at 30 fps / DPR 2, paused off-screen and when the tab is hidden, a still frame under reduced motion, CSS fallback without canvas; (2) the lab's balance beam, which makes "the mean is the balance point" literal.

## D7 · Self-hosted fonts and a strict CSP
Fraunces (display) and Inter (UI) are bundled as latin-subset variable WOFF2 files (~130 kB total, SIL OFL). No third-party requests other than Open-Meteo, which lets the CSP be `default-src 'self'` with `connect-src` limited to the two Open-Meteo hosts. All dynamic text goes through `textContent`; CSV cells starting with `= + - @` are neutralised.

## D8 · Freshness states
Live (fetched this visit, < 60 min), Cached (saved copy or older than 60 min), Stale (≥ 3 h), Expired (every forecast hour is past), Synthetic (demo). A failed refresh keeps the previous forecast on screen with an explanation and a retry button.

## D9 · Identity: "the Aperture" (2026-10-31)
**Problem:** v2 was tidy but generic (rounded cards, Inter/Fraunces, a four-pane window icon).
**Chosen idea:** the circle is the average; the contour that wanders off it is the real week. That single figure is the logo, the week signature, the lab's shapes view and the lens aperture, so a fragment of any screen still reads as Weather Window. Supporting rules: round apertures only for things you look *through*; squared plates with registration ticks for things you read; hairlines instead of boxes; one solar index (▾ / underline / needle) marks the current selection everywhere.
**Type:** Newsreader (display, editorial numerals), Hanken Grotesk (UI), Martian Mono (scales, labels, data). All OFL, self-hosted latin subsets, ~195 kB, font families renamed `* WW` to avoid local-font collisions. Fraunces/Inter were dropped because they are the default "AI editorial" pairing.
**Colour:** basalt ink / limestone paper, petrol = fits, solar = index/sun/heat, glacier = cool/wet, oxide = warning/extreme. One temperature ramp (`core/encoding.js` `TEMP_STOPS`) is shared by lens, dial, strip, signature and card.
**Motion:** "drift" (`cubic-bezier(.22,.61,.36,1)`, 0.9–1.1 s) for state changes; 140 ms snap for feedback; focus-pull (blur→sharp) for entering content. All disabled by `prefers-reduced-motion`.

## D10 · 3D: plain WebGL + one ray-marched shader, not Three.js (supersedes D6)
**Why 3D now:** the brief asked for a meaningful centrepiece; v2 rejected Three.js as weight without insight. The lens is designed so every effect maps to one forecast value (D11), which gives the 3D a job.
**Why not Three.js / R3F:** the scene is a single full-screen triangle with a fragment shader (volume of strata, threads, veil, streaks, plinth). Three.js would add ~150 kB gz for a scene graph we do not use; React would force a rewrite of a working vanilla app. The lens is ~10 kB of source, zero dependencies, and the CSP stays `script-src 'self'`.
**Engineering:** adaptive tiers (resolution 0.4–1.0 × DPR≤1.5, 20–52 march steps, 1–3 noise octaves) chosen from device hints and adjusted from frame timing; ≤30 fps, 12 fps after 25 s idle, stopped off-screen / hidden tab; reduced motion = still frames on change only; `webglcontextlost` and missing WebGL fall back to the v2 2D sky (labelled "Simplified 2D view"); resources released on destroy. Contour sheets are counted where the ray crosses them (not sampled as thin shells), which removes grain at low step counts.

## D11 · Visual encoding is explicit, tested and shown
`core/encoding.js` maps one value per effect: temperature → strata colour; wind speed → thread speed and strata ripple; wind direction → drift direction (`wind_direction_10m`, newly requested); cloud cover → veil density; precipitation *chance* → streak density (never amount); UV → light-shaft strength; is_day + real sunrise/sunset → night ambience and light direction (height approximate). Humidity is **not** encoded: no defensible visual. A missing value turns its effect off and the legend says so. The legend ("How to read the lens") renders the same rows the shader uses, and unit tests check monotonicity and the missing-value behaviour. The lens shows the "current" model block only when the selected hour is now; precipitation chance and UV always come from the hour.

## D12 · One selected moment drives the Overview
`state.hour` (null = follow now) and `state.day` are kept consistent: the dial, chart clicks/Enter, the hourly table and planner cards ("See it in the lens") set the moment; choosing a day opens it at 13:00 local (or now, for today). The readout, lens, dial needle, chart marker and table highlight all show the same hour.

## D13 · Week signature and card
The signature's circle is the mean of all hourly temperatures (not of daily maxima, which the lab uses); each day is a closed line around a 24-hour clock, scaled with reference rings at round ±° steps so the scale is visible. Gaps break lines. The PNG card is drawn on canvas from the same SVG path data (Path2D), carries place, dates, time zone and provenance ("Synthetic demo data" or Open-Meteo + status + retrieval time).

## D14 · Sound is opt-in per visit
Generated WebAudio only (filtered noise for wind, filtered clicks for precipitation chance, a quiet rate-limited tick for the dial); no files. It starts only from the button press, is never remembered as "on" (that would be autoplay on the next visit), suspends with the tab, and carries no information that is not on screen.

## D15 · Optional data fields
`wind_direction_10m` is optional in normalisation: older cached responses without it do not raise the "incomplete data" banner; the legend says direction is unavailable and threads drift without a direction.

## D16 · Visual collection, built as prototypes first (2026-11-01)
The second creative brief asked for several visual systems, proven before scaling. Four prototypes were built and judged in the real app: thermal relief (generative 2D + interactive data view), living wind (animated artwork), day portraits (procedural illustration) and the lab's before/after transition. All four stayed because each answers a question the app already asks (where are the warm hours; which way and how hard does the wind blow; what is each day like; what did my change do). Nothing was added that has no data behind it. Technology: Canvas 2D for the field and particles, SVG for portraits and glyphs, the existing WebGL lens for layers; no GSAP, no Three.js (D10 still holds), no new dependencies.

## D17 · Art and data are separated in the interface, not only in the docs
Every artistic view states its mapping next to it and labels what is forecast, derived and artistic (`.prov` tags). Rules: (1) the true values are always one gesture away (loupe, tile numbers, portrait aria-labels, readout); (2) a blend or decoration never invents a value: missing inputs remove their part (hatched cells, empty tiles, no sun); (3) motion speed or density is never presented as a measurement, and the wind tiles say they are not a map.

## D18 · Thermal relief: smooth for reading, raw on demand
Bilinear blending striped the hill-shade at every row and column; separable Catmull-Rom (C1) removes that. Because a blend between two days is not a forecast, the loupe shows the unblended hourly cells and the reading tag says "forecast value". Cubic overshoot is limited to the bands between real rows. The field is computed at CSS resolution and scaled up (¼ of the work on 2× screens), only when near the viewport, and cached by size, units and forecast.

## D19 · Glyphs: one family with the lens
Stock-style line icons made the condition symbols the most generic thing on screen. The aperture glyphs reuse the lens vocabulary (window circle, solar disc, horizontal strata, falling marks), keep 24×24 geometry and `currentColor`, and colour only the sun (solar) and precipitation (glacier) so they read at 16–18 px.

## Lessons
* Full-page Playwright screenshots repaint sticky headers mid-page; that is a screenshot artefact, not a layout bug.
* A CSS `display` rule on a component silently overrides the `hidden` attribute; a global `[hidden] { display: none !important; }` prevents menus and panels from staying visible.
* SVG elements re-rendered on every drag lose pointer capture; capture on the stable container instead.
* Ray-marched thin shells alias into grain at low step counts; count iso-surface crossings between steps instead.
* A dial ring that captures pointer events blocks page scrolling on phones; on touch, only a drag that starts on the index scrubs, a tap jumps.
* SVG `<text>` in a canvas `drawImage` does not get web fonts; drawing the share card directly with Path2D + `fillText` after `document.fonts.load` does.
* Bilinear interpolation is fine for colour but its gradient jumps at every grid line, so a hill-shade turns it into stripes; shade a C1 (cubic) surface instead.
* Rebuilding a canvas field on every state change is the easiest way to make a cheap interaction slow: cache by the inputs that actually change it.
* `prefers-reduced-motion` needs a designed still state (streamlines, a fixed loupe), not just a stopped animation.
* A grid item with `aspect-ratio` that is stretched to its row's height derives its width from that height and can spill over the neighbouring column. The window now uses the aspect ratio only when stacked; side by side it fills its column. A browser check measures the gap at 920–1617 px.
