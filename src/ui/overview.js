// Experience A — Overview: look through the lens at one hour, then read the
// week around it. The lens, the readout, the dial, the strip, the chart and
// the signature all point at the same selected moment.

import { h, s, replace } from './dom.js';
import { icon, weatherIcon } from './icons.js';
import { createInstrument } from './instrument.js';
import { createWeekChart, chartMetrics } from './weekchart.js';
import { createSignature, signatureCard } from './signature.js';
import { createThermal } from './thermal.js';
import { createWind } from './wind.js';
import { createPortraits } from './portraits.js';
import { hourIndexAt } from './dial.js';
import { setMood } from './sound.js';
import { isNum, round } from '../core/num.js';
import { fmtTemp, fmtWind, fmtPct, fmtUv, fmtPrecip, tempTo } from '../core/units.js';
import { describeCode, uvCategory } from '../core/weathercodes.js';
import { localParts, weekdayShort, weekdayLong, dayMonth } from '../core/time.js';
import { weeklyInsights, weekStory } from '../core/insights.js';
import { momentFor, encodeMoment, compass, tempColor, rgbCss } from '../core/encoding.js';

const WHO_UV = 'https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-(uv)-index';

export function createOverview(root, ctx) {
  const instrumentHost = h('div', { class: 'instrument-host' });
  const readout = h('div', { class: 'readout' });
  const strip = h('div', { class: 'daystrip', role: 'group', 'aria-label': 'Choose a day' });
  const metricBar = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Chart metric' });
  const chartHost = h('div', { class: 'chart-host' });
  const chartNote = h('p', { class: 'chart-note' });
  const thermalHost = h('div', { class: 'thermal-host' });
  const windHost = h('div', { class: 'wind-host' });
  const windTitle = h('span', null);
  const portraitsHost = h('div', { class: 'portraits', role: 'group', 'aria-label': 'Day portraits. Choose a day' });
  const sigFigure = h('div', { class: 'sig-figure-host' });
  const sigKeys = h('div', { class: 'sig-keys-host' });
  const sigActions = h('div', { class: 'sig-actions' });
  const detail = h('div', { class: 'panel day-detail', 'aria-live': 'polite' });
  const insights = h('div', { class: 'panel insights' });

  root.append(
    h('div', { class: 'ov-hero' }, instrumentHost, readout),
    strip,
    h('section', { class: 'panel chart-panel reveal', 'aria-labelledby': 'chart-h' },
      h('div', { class: 'panel-head' },
        h('div', null, h('p', { class: 'eyebrow' }, '168 hours'), h('h2', { id: 'chart-h' }, 'The shape of the week')),
        metricBar),
      chartHost, chartNote),
    h('section', { class: 'panel thermal-panel reveal', 'aria-labelledby': 'thermal-h' },
      h('div', { class: 'panel-head' },
        h('div', null, h('p', { class: 'eyebrow' }, 'Thermal relief'), h('h2', { id: 'thermal-h' }, 'The week as a ', h('em', null, 'landscape')))),
      h('p', { class: 'muted thermal-lede' }, 'Warm afternoons rise as ridges, cold dawns sink as valleys. Move across it: the loupe shows the actual forecast hours underneath the blend. Click to see that hour in the lens. ', h('span', { class: 'prov prov-actual' }, 'Forecast'), ' dotted rows and loupe values. ', h('span', { class: 'prov prov-art' }, 'Blended'), ' colour between rows and the hill-shade.'),
      thermalHost),
    h('section', { class: 'panel wind-panel reveal', 'aria-labelledby': 'wind-h' },
      h('div', { class: 'panel-head' },
        h('div', null, h('p', { class: 'eyebrow' }, 'Living wind'), h('h2', { id: 'wind-h' }, windTitle))),
      h('p', { class: 'muted wind-lede' }, 'Each tile is one hour, seen from above with north up. The streaks travel the way the forecast wind blows, faster and denser when it is stronger. ',
        h('span', { class: 'prov prov-art' }, 'Artistic rendering'), ' The streaks are not real air and the tiles are not a map; the numbers are the forecast.'),
      windHost),
    h('section', { class: 'panel sig-panel reveal', 'aria-labelledby': 'sig-h' },
      sigFigure,
      h('div', { class: 'sig-copy' },
        h('p', { class: 'eyebrow' }, 'The week’s signature'),
        h('h2', { id: 'sig-h' }, 'The circle is the average. ', h('em', null, 'The lines are the week.')),
        h('p', { class: 'muted' }, 'If the average told the whole story, all seven days would sit on the circle. They never do. Pick a day to trace it.'),
        sigKeys, sigActions)),
    h('section', { class: 'panel portraits-panel reveal', 'aria-labelledby': 'pt-h' },
      h('div', { class: 'panel-head' },
        h('div', null, h('p', { class: 'eyebrow' }, 'Seven days, seven atmospheres'), h('h2', { id: 'pt-h' }, 'Every day has ', h('em', null, 'a face')))),
      portraitsHost,
      h('details', { class: 'pt-key' },
        h('summary', null, 'How each portrait is made'),
        h('ul', null,
          h('li', null, h('span', { class: 'prov prov-actual' }, 'Forecast'), ' The horizon is that day’s 24 hourly temperatures, on the same scale for the whole week, coloured by temperature. A higher ridge is a warmer hour.'),
          h('li', null, h('span', { class: 'prov prov-derived' }, 'Derived'), ' Cloud uses the mean of the daytime hours; the wind slant uses the speed-weighted mean of the hourly directions.'),
          h('li', null, h('span', { class: 'prov prov-art' }, 'Artistic mapping'), ' The sky greys with more cloud, the sun grows with the UV maximum and sits over the warmest hour, one cloud band per 20% cover, rain streaks by the maximum precipitation chance (length by the day’s total), leaning with the mean wind. The far hills are decoration.'),
          h('li', null, 'The same forecast always draws the same portrait. A missing value removes its part instead of inventing one.')))),
    h('div', { class: 'ov-grid reveal' }, detail, insights),
  );

  const instrument = createInstrument(instrumentHost, { onScrub: (i) => ctx.setMoment(i, { quiet: true }) });
  const chart = createWeekChart(chartHost, { onSelectDay: (i) => ctx.selectDay(i), onSelectHour: (i) => ctx.setMoment(i) });
  const wind = createWind(windHost, { onSelect: (i) => ctx.setMoment(i) });
  const portraits = createPortraits(portraitsHost, { onSelectDay: (i) => ctx.selectDay(i) });
  const thermal = createThermal(thermalHost, { onSelect: (i) => ctx.setMoment(i) });
  const signature = createSignature(sigFigure, sigKeys, { onSelectDay: (i) => ctx.selectDay(i) });

  replace(sigActions, h('button', { type: 'button', class: 'btn', id: 'sig-download', onclick: downloadCard }, icon('image', { size: 16 }), 'Download signature card'));

  // ---------- The selected moment ----------
  function resolveMoment(st) {
    const f = st.forecast;
    const nowI = hourIndexAt(f, ctx.now());
    let i = Number.isInteger(st.hour) && f.hours[st.hour] ? st.hour : nowI;
    if (i < 0) {
      const d = f.days[st.day];
      i = d && d.hourStart >= 0 ? d.hourStart + Math.min(d.hourCount - 1, 13) : 0;
    }
    const useCurrent = i === nowI && st.hour === null;
    return { i, nowI, moment: momentFor(f, i, { useCurrent }) };
  }

  function lat(st) {
    return isNum(st.place?.lat) ? st.place.lat : 30;
  }

  function renderReadout(st, sel) {
    const { forecast, units, place } = st;
    const m = sel.moment;
    const cond = describeCode(m.code);
    const day = forecast.days.find((d) => d.date === m.date) || forecast.days[0];
    const synthetic = st.source === 'demo';
    const enc = encodeMoment(m, { fmt: ctx.fmt(), lat: lat(st) });
    const uv = uvCategory(m.uv);
    const away = !m.isCurrent && sel.nowI >= 0;
    readout.style.setProperty('--moment', rgbCss(tempColor(m.temp)));
    replace(readout,
      h('p', { class: 'eyebrow' }, synthetic ? 'Synthetic demo week · not a real place' : m.isCurrent ? 'Now · model estimate, not a station reading' : 'Forecast hour · model estimate'),
      h('h1', { class: 'place-title' }, place.name),
      h('p', { class: 'place-sub' }, [place.detail, `${forecast.days.length}-day outlook`, forecast.timezone].filter(Boolean).join(' · ')),
      h('p', { class: 'moment-line' },
        h('span', { class: `tag${m.isCurrent ? ' now' : ''}${synthetic ? ' synthetic' : ''}` }, m.isCurrent ? (synthetic ? 'Demo now' : 'Now') : 'Forecast'),
        h('span', null, `${weekdayLong(m.date)} ${dayMonth(m.date)} · ${localParts(m.t, forecast.clock).hhmm} local`)),
      h('div', { class: 'now-row' },
        h('div', { class: 'now-temp' }, fmtTemp(m.temp, units)),
        h('div', { class: 'now-cond' },
          weatherIcon(cond.group, { night: m.isDay === 0, size: 40 }),
          h('span', null, cond.label),
          h('span', { class: 'muted' }, `Day ${fmtTemp(day.low, units)} → ${fmtTemp(day.high, units)}`))),
      h('dl', { class: 'now-facts' },
        fact('Feels like', fmtTemp(m.feels, units)),
        fact('Humidity', fmtPct(m.rh)),
        fact('Wind', fmtWind(m.wind, units), isNum(m.windDir) ? `from the ${compass(m.windDir)}` : ''),
        fact('Cloud cover', fmtPct(m.cloud)),
        fact('Precip. chance', fmtPct(m.pop), 'this hour'),
        fact('UV index', fmtUv(m.uv), uv ? uv.label : '')),
      away || !m.isCurrent ? h('div', { class: 'readout-actions' },
        away ? h('button', { type: 'button', class: 'btn', id: 'back-now', onclick: () => ctx.setMoment(null) }, icon('now', { size: 16 }), 'Back to now') : null,
        h('button', { type: 'button', class: 'btn ghost', onclick: () => instrument.focusDial() }, 'Step through the hours')) : null,
      h('p', { class: 'story' }, weekStory(forecast.days, ctx.fmt())),
      legendBlock(enc),
    );
    return enc;
  }

  function legendBlock(enc) {
    return h('details', { class: 'encoding', id: 'encoding' },
      h('summary', null, 'How to read the lens', h('small', null, 'an illustration, not a simulation')),
      h('ul', { class: 'encoding-list' }, ...enc.legend.map((row) => h('li', { 'data-key': row.key },
        encGlyph(row.key, enc),
        h('span', { class: 'enc-visual' }, row.visual),
        h('span', { class: 'enc-data' }, row.data, h('small', null, row.note))))),
      h('p', { class: 'encoding-note' }, 'Each effect follows one forecast value for the selected hour. Nothing in the lens is measured separately, and the contour strata and glass column are a visual language, not air layers or pressure levels.'));
  }

  function encGlyph(key, enc) {
    const base = { viewBox: '0 0 26 26', class: 'enc-glyph', 'aria-hidden': 'true', fill: 'none', 'stroke-width': 1.4, 'stroke-linecap': 'round' };
    const tint = rgbCss(enc.params.tempColor);
    if (key === 'colour') return s('svg', base, s('circle', { cx: 13, cy: 13, r: 9, fill: tint, stroke: 'none' }));
    if (key === 'flow') return s('svg', { ...base, stroke: 'currentColor' }, s('path', { d: 'M3 9h12M7 14h15M3 19h10' }), s('path', { d: 'M18 6l3 3-3 3' }));
    if (key === 'haze') return s('svg', { ...base, stroke: 'currentColor' }, s('path', { d: 'M5 16a4 4 0 0 1 4-4 5 5 0 0 1 9 1.5A3 3 0 0 1 18 19H8a3 3 0 0 1-3-3Z', 'stroke-dasharray': '2 2' }));
    if (key === 'streaks') return s('svg', { ...base, stroke: 'currentColor' }, s('path', { d: 'M8 5l-2 6M14 8l-2 6M20 5l-2 6M11 15l-2 6M17 16l-2 6' }));
    return s('svg', { ...base, stroke: 'var(--solar)' }, s('circle', { cx: 13, cy: 13, r: 4 }), s('path', { d: 'M13 3v3M13 20v3M3 13h3M20 13h3M6 6l2 2M18 18l2 2M6 20l2-2M18 8l2-2' }));
  }

  function fact(label, value, note) {
    return h('div', { class: 'fact' }, h('dt', null, label), h('dd', null, value, note ? h('small', null, note) : null));
  }

  // ---------- The week strip ----------
  function renderStrip(st) {
    const { forecast, units, day } = st;
    const lows = forecast.days.map((d) => d.low).filter(isNum);
    const highs = forecast.days.map((d) => d.high).filter(isNum);
    const lo = lows.length ? Math.min(...lows) : 0;
    const hi = highs.length ? Math.max(...highs) : 1;
    const pct = (v) => ((v - lo) / (hi - lo || 1)) * 100;
    replace(strip, ...forecast.days.map((d, i) => {
      const cond = describeCode(d.code);
      const bar = isNum(d.high) && isNum(d.low)
        ? h('span', { class: 'range-track', 'aria-hidden': 'true' }, h('span', { class: 'range-fill', style: { left: `${pct(d.low)}%`, width: `${Math.max(2, pct(d.high) - pct(d.low))}%`, background: `linear-gradient(90deg, ${rgbCss(tempColor(d.low))}, ${rgbCss(tempColor(d.high))})` } }))
        : h('span', { class: 'range-track missing', 'aria-hidden': 'true' });
      return h('button', {
        type: 'button', class: `day${i === day ? ' on' : ''}`, 'aria-pressed': String(i === day),
        'aria-label': `${weekdayLong(d.date)} ${dayMonth(d.date)}: ${cond.label}, low ${fmtTemp(d.low, units)}, high ${fmtTemp(d.high, units)}, precipitation chance up to ${fmtPct(d.popMax)}`,
        onclick: () => ctx.selectDay(i),
      },
      h('span', { class: 'day-name' }, i === 0 && st.source !== 'demo' && isToday(st, d) ? 'Today' : weekdayShort(d.date)),
      h('span', { class: 'day-date' }, dayMonth(d.date)),
      h('span', { class: 'day-top' }, weatherIcon(cond.group, { size: 24 })),
      h('span', { class: 'day-temps' }, h('b', null, fmtTemp(d.high, units)), h('span', null, fmtTemp(d.low, units))),
      bar,
      h('span', { class: `day-pop${isNum(d.popMax) && d.popMax >= 30 ? ' wet' : ''}` }, icon('drop', { size: 11 }), fmtPct(d.popMax)));
    }));
  }

  function isToday(st, d) {
    return localParts(ctx.now(), st.forecast.clock).date === d.date;
  }

  function renderMetricBar(st) {
    const M = chartMetrics(st.units);
    replace(metricBar, ...Object.entries(M).map(([key, m]) => h('button', {
      type: 'button', class: key === st.metric ? 'on' : '', 'aria-pressed': String(key === st.metric),
      onclick: () => ctx.setMetric(key),
    }, m.label.replace('Precipitation chance', 'Precip. chance'))));
    const notes = {
      temp: 'Air temperature at 2 m for each hour. Shaded bands are night; the solar line is the hour in the lens. Click any hour to look at it.',
      pop: 'Chance of more than 0.1 mm of precipitation in each hour. A probability, not an amount.',
      rh: 'Relative humidity at 2 m for each hour.',
      wind: 'Mean wind speed at 10 m for each hour. Gusts can be stronger.',
      uv: 'UV index averaged over each hour. 3 or more: sun protection recommended (WHO).',
    };
    chartNote.textContent = notes[st.metric];
  }

  // ---------- Selected day ----------
  function renderDetail(st, sel) {
    const { forecast, units, day } = st;
    const d = forecast.days[day];
    const cond = describeCode(d.code);
    const uv = uvCategory(d.uvMax);
    const sun = (t) => (isNum(t) ? localParts(t, forecast.clock).hhmm : '—');
    const hours = d.hourStart >= 0 ? forecast.hours.slice(d.hourStart, d.hourStart + d.hourCount) : [];
    const daylen = isNum(d.sunrise) && isNum(d.sunset) ? `${Math.floor((d.sunset - d.sunrise) / 3600)} h ${Math.round(((d.sunset - d.sunrise) % 3600) / 60)} min of daylight` : 'Daylight times unavailable';

    replace(detail,
      h('div', { class: 'panel-head' },
        h('div', null, h('p', { class: 'eyebrow' }, 'Selected day'), h('h2', null, `${weekdayLong(d.date)}, ${dayMonth(d.date)}`)),
        h('div', { class: 'detail-cond' }, weatherIcon(cond.group, { size: 32 }), h('span', null, cond.label))),
      h('div', { class: 'detail-grid' },
        tile('Daily maximum', fmtTemp(d.high, units), 'Peak temperature, usually mid-afternoon'),
        tile('Daily minimum', fmtTemp(d.low, units), 'Lowest temperature, usually near dawn'),
        tile('Precipitation chance', fmtPct(d.popMax), 'Highest hourly probability of >0.1 mm'),
        tile('Expected precipitation', fmtPrecip(d.precipSum, units), 'Model total for the day; an amount, not a chance'),
        tile('Strongest wind', fmtWind(d.windMax, units), 'Daily maximum of mean wind at 10 m'),
        tile('Mean humidity', fmtPct(d.rhMean), 'Average of the hourly values'),
      ),
      h('div', { class: `uv-note uv-${uv?.key ?? 'na'}` },
        h('div', { class: 'uv-badge' }, h('span', null, 'UV'), h('b', null, fmtUv(d.uvMax))),
        h('p', null, uv ? h('strong', null, `${uv.label}. `) : null, uv ? uv.advice : 'UV index unavailable for this day.', ' ',
          h('a', { href: WHO_UV, target: '_blank', rel: 'noopener noreferrer' }, 'WHO guidance'))),
      h('div', { class: 'sun-row' },
        h('span', null, icon('sunrise', { size: 18 }), `Sunrise ${sun(d.sunrise)}`),
        h('span', null, icon('sunset', { size: 18 }), `Sunset ${sun(d.sunset)}`),
        h('span', { class: 'muted' }, daylen)),
      hours.length ? hourlyTable(hours, units, d.hourStart, sel.i) : h('p', { class: 'muted' }, 'No hourly values for this day.'),
    );
  }

  function tile(label, value, note) {
    return h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, label), h('span', { class: 'tile-value' }, value), h('span', { class: 'tile-note' }, note));
  }

  let hourlyOpen = false;
  function hourlyTable(hours, units, start, selected) {
    const peak = Math.max(...hours.map((x) => tempTo(x.temp, units)).filter(isNum));
    const det = h('details', { class: 'hourly', open: hourlyOpen ? true : null, ontoggle: (e) => { hourlyOpen = e.currentTarget.open; } },
      h('summary', null, 'Hour by hour', h('span', { class: 'muted' }, ` · ${hours.length} hours, local time`)),
      h('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Hourly forecast table' },
        h('table', null,
          h('thead', null, h('tr', null, ...['Time', 'Sky', 'Temp', 'Feels', 'Humidity', 'Precip. chance', 'Wind', 'UV'].map((c) => h('th', { scope: 'col' }, c)))),
          h('tbody', null, ...hours.map((x, k) => {
            const cond = describeCode(x.code);
            const cls = [tempTo(x.temp, units) === peak ? 'peak' : '', start + k === selected ? 'selected' : ''].filter(Boolean).join(' ');
            return h('tr', { class: cls || null },
              h('th', { scope: 'row' }, h('button', { type: 'button', class: 'hour-go', onclick: () => ctx.setMoment(start + k), 'aria-label': `Show ${x.hhmm} in the lens` }, x.hhmm)),
              h('td', null, weatherIcon(cond.group, { size: 18, night: x.isDay === 0, label: cond.label })),
              h('td', null, fmtTemp(x.temp, units)),
              h('td', null, fmtTemp(x.feels, units)),
              h('td', null, fmtPct(x.rh)),
              h('td', null, fmtPct(x.pop)),
              h('td', null, `${fmtWind(x.wind, units)}${isNum(x.windDir) ? ` ${compass(x.windDir)}` : ''}`),
              h('td', null, fmtUv(x.uv)));
          })))));
    return det;
  }

  function renderInsights(st) {
    const list = weeklyInsights(st.forecast.days, ctx.fmt());
    replace(insights,
      h('div', { class: 'panel-head' }, h('div', null, h('p', { class: 'eyebrow' }, 'Worth a closer look'), h('h2', null, 'This week, in facts'))),
      list.length
        ? h('ul', { class: 'insight-list' }, ...list.map((ins) => h('li', { class: `insight k-${ins.kind}` },
          h('button', {
            type: 'button', class: 'insight-btn', disabled: ins.day === null ? true : null,
            onclick: ins.day === null ? null : () => ctx.selectDay(ins.day),
            'aria-label': ins.day === null ? null : `${ins.title}: ${ins.value}. Show this day.`,
          },
          h('span', { class: 'insight-title' }, ins.title),
          h('span', { class: 'insight-value' }, ins.value),
          h('span', { class: 'insight-detail' }, ins.detail)),
          ins.id === 'average' ? h('a', { class: 'insight-link', href: '#lab' }, 'See it in the What-if Lab', icon('chevron', { size: 14 })) : null)))
        : h('p', { class: 'muted' }, 'Not enough complete data to compute insights for this week.'),
    );
  }

  // ---------- The signature card ----------
  let lastState = null;
  let detailDay = null;
  async function downloadCard() {
    const st = lastState;
    if (!st?.forecast) return;
    const btn = root.querySelector('#sig-download');
    btn.disabled = true;
    try {
      const f = st.forecast;
      const fr = ctx.freshness();
      const first = f.days[0].date;
      const lastD = f.days[f.days.length - 1].date;
      const blob = await signatureCard({
        forecast: f,
        units: st.units,
        placeLabel: st.place.name,
        dateRange: `${weekdayShort(first)} ${dayMonth(first)} – ${weekdayShort(lastD)} ${dayMonth(lastD)} · ${f.timezone}`,
        provenance: st.source === 'demo'
          ? 'Synthetic demo data · not a forecast for any place'
          : `Forecast data: Open-Meteo.com (CC BY 4.0) · ${fr.label}${ctx.fetchedLabel() ? ` · retrieved ${ctx.fetchedLabel()}` : ''}`,
      });
      const url = URL.createObjectURL(blob);
      const slug = st.place.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place';
      const a = h('a', { href: url, download: `weather-window-signature_${st.place.demo ? 'demo' : slug}_${first}.png` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      ctx.toast('Signature card saved as PNG.', 'ok');
    } catch {
      ctx.toast('The signature card could not be created in this browser.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  return {
    update(st, what = 'all') {
      if (!st.forecast) return;
      lastState = st;
      if (what === 'all' || what === 'data') {
        renderInsights(st);
        renderMetricBar(st);
      }
      if (what === 'metric') renderMetricBar(st);
      const sel = resolveMoment(st);
      const enc = renderReadout(st, sel);
      instrument.update({ forecast: st.forecast, hourIndex: sel.i, units: st.units, now: ctx.now(), encoded: enc, moment: sel.moment, synthetic: st.source === 'demo' });
      setMood({ wind: enc.params.wind, precip: enc.params.precip });
      renderStrip(st);
      chart.update({ forecast: st.forecast, metric: st.metric, units: st.units, dayIndex: st.day, now: ctx.now(), hourIndex: sel.i });
      replace(windTitle, `${weekdayLong(st.forecast.days[st.day].date)}’s wind, `, h('em', null, 'hour by hour'));
      wind.update({ forecast: st.forecast, units: st.units, day: st.day, hourIndex: sel.i });
      thermal.update({ forecast: st.forecast, units: st.units, day: st.day, hourIndex: sel.i });
      if (what !== 'moment' || detailDay !== st.day) renderDetail(st, sel);
      else root.querySelectorAll('.hourly tbody tr').forEach((tr, k) => tr.classList.toggle('selected', st.forecast.days[st.day].hourStart + k === sel.i));
      detailDay = st.day;
      if (what !== 'moment') { signature.update(st); portraits.update({ forecast: st.forecast, units: st.units, day: st.day }); }
    },
    open() { instrument.open(); },
    destroy() {
      instrument.destroy();
      chart.destroy();
      thermal.destroy();
      wind.destroy();
    },
  };
}
