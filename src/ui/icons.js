// Weather Window's icon set: 24×24 line glyphs drawn with currentColor.

import { s } from './dom.js';
import { markContour } from './signature.js';

const P = {
  sun: ['M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z', 'M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4'],
  moon: ['M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z'],
  cloud: ['M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 10a4.25 4.25 0 0 0 0 8.5Z'],
  partly: ['M8.5 3.5v1.3M3.7 5.7l.9.9M2.5 10h1.3M12.4 5.7l-.9.9', 'M5.6 12.3A3.6 3.6 0 1 1 11.6 8', 'M9 20h8.5a3.5 3.5 0 0 0 .5-6.96A4.8 4.8 0 0 0 9 12.5a3.75 3.75 0 0 0 0 7.5Z'],
  fog: ['M4 9h16M3 13h18M5 17h14'],
  drizzle: ['M7 15.5h10a3.75 3.75 0 0 0 .5-7.46A5.2 5.2 0 0 0 7 7.7a3.9 3.9 0 0 0 0 7.8Z', 'M9 18.5l-.5 1.5M13 18.5l-.5 1.5M17 18.5l-.5 1.5'],
  rain: ['M7 14.5h10a3.75 3.75 0 0 0 .5-7.46A5.2 5.2 0 0 0 7 6.7a3.9 3.9 0 0 0 0 7.8Z', 'M8.5 17l-1.2 3M12.5 17l-1.2 3M16.5 17l-1.2 3'],
  snow: ['M7 14h10a3.75 3.75 0 0 0 .5-7.46A5.2 5.2 0 0 0 7 6.2a3.9 3.9 0 0 0 0 7.8Z', 'M8 18h.01M12 17.5h.01M16 18h.01M10 21h.01M14 21h.01'],
  storm: ['M7 14h10a3.75 3.75 0 0 0 .5-7.46A5.2 5.2 0 0 0 7 6.2a3.9 3.9 0 0 0 0 7.8Z', 'M12.5 15.5 10 19h3l-2 3.5'],
  unknown: ['M12 17h.01M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6'],
  search: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM15.5 15.5 20 20'],
  locate: ['M12 3v3M12 18v3M3 12h3M18 12h3', 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z', 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z'],
  star: ['M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9Z'],
  refresh: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4'],
  download: ['M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14'],
  copy: ['M9 9h10v10H9zM5 15V5h10'],
  close: ['M6 6l12 12M18 6 6 18'],
  chevron: ['M9 6l6 6-6 6'],
  pin: ['M12 21s6-5.4 6-11a6 6 0 1 0-12 0c0 5.6 6 11 6 11Z', 'M12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z'],
  sliders: ['M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1', 'M16 4v4M10 10v4M18 16v4'],
  flask: ['M9.5 3.5h5M10.5 3.5v5.5L5 18.5a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2L13.5 9V3.5', 'M7.5 14.5h9'],
  grid: ['M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
  info: ['M12 8h.01M11 11.5h1v5h1', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'],
  trash: ['M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13'],
  wind: ['M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7'],
  drop: ['M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5Z'],
  sunrise: ['M4 18h16M7.5 14.5a4.5 4.5 0 0 1 9 0M12 4v5M9.5 6.5 12 4l2.5 2.5M3.5 14.5h1.5M19 14.5h1.5'],
  sunset: ['M4 18h16M7.5 14.5a4.5 4.5 0 0 1 9 0M12 4v5M9.5 6.5 12 9l2.5-2.5M3.5 14.5h1.5M19 14.5h1.5'],
  play: ['M8 5.5v13l10-6.5Z'],
  share: ['M12 4v11M8 8l4-4 4 4M6 13v6h12v-6'],
  soundOn: ['M4 9.5h3.5L12 6v12l-4.5-3.5H4z', 'M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11'],
  soundOff: ['M4 9.5h3.5L12 6v12l-4.5-3.5H4z', 'M16 10l4 4M20 10l-4 4'],
  image: ['M4 5h16v14H4z', 'M4 15l4.5-4 3.5 3 3-2.5L20 15', 'M15 8.5h.01'],
  now: ['M12 3a9 9 0 1 0 9 9', 'M12 7v5l3 2', 'M17 3h4v4'],
  turn: ['M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3', 'M18 3v4h-4M6 21v-4h4'],
};

export function icon(name, { size = 20, label = null, cls = '' } = {}) {
  const paths = P[name] || P.unknown;
  return s('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    class: `icon ${cls}`.trim(),
    'aria-hidden': label ? null : 'true',
    role: label ? 'img' : null,
    'aria-label': label,
  }, label ? s('title', { text: label }) : null, ...paths.map((d) => s('path', { d })));
}

// ---------- Weather glyphs: the aperture set ----------
//
// Every condition is drawn inside the same window circle, using the lens's
// own vocabulary: a solar disc, horizontal cloud strata, and marks falling
// below the strata. The circle keeps them a family; the inside says what
// kind of weather it is. Fills use the solar token so the sun reads at 16 px.

const R = 9;
const chord = (y, inset = 1.6) => {
  const d = Math.abs(y - 12);
  const half = Math.max(0, Math.sqrt(R * R - d * d) - inset);
  return `M${(12 - half).toFixed(2)} ${y}h${(half * 2).toFixed(2)}`;
};
const dashed = (y, flip, inset = 1.6) => {
  const d = Math.abs(y - 12);
  const half = Math.max(0, Math.sqrt(R * R - d * d) - inset);
  const x0 = 12 - half;
  const L = half * 2;
  const [a, b] = flip ? [0.3, 0.55] : [0.55, 0.3];
  return `M${x0.toFixed(2)} ${y}h${(L * a).toFixed(2)}M${(x0 + L * (a + 0.15)).toFixed(2)} ${y}h${(L * b).toFixed(2)}`;
};

const GLYPHS = {
  clear: { sun: [12, 12, 4.4] },
  'clear-night': { moon: true },
  partly: { sun: [14.6, 9.4, 2.9], strata: [chord(14), chord(17.4, 2.2)] },
  'partly-night': { moonSmall: true, strata: [chord(14), chord(17.4, 2.2)] },
  cloudy: { strata: [chord(8.6), chord(12), chord(15.4)] },
  fog: { strata: [dashed(8, false), dashed(11, true), dashed(14, false), dashed(17, true)] },
  drizzle: { strata: [chord(8.2), chord(11)], marks: ['M9 14.2v1.4M12 15.6v1.4M15 14.2v1.4'] },
  rain: { strata: [chord(8.2)], marks: ['M9.4 11.2 8.2 15.4M13 11.2l-1.2 4.2M16.4 11.6l-.9 3.2M11 15.8l-.9 3'] },
  snow: { strata: [chord(8.2)], dots: [[9, 12.4], [15, 12.4], [12, 14.8], [9, 17.2], [15, 17.2], [12, 19.2]] },
  storm: { strata: [chord(8.2)], bolt: 'M13.2 10.4 10.2 14.6h3.4l-2.6 4.6' },
  unknown: { marks: ['M12 16.4h.01M10 10.2a2 2 0 1 1 2.8 1.84c-.5.24-.8.72-.8 1.28v.48'], dashedFrame: true },
};

/** Weather glyph for a code group, with night variants for clear skies. */
export function weatherIcon(group, { night = false, size = 24, label = null } = {}) {
  const key = night && (group === 'clear' || group === 'partly') ? `${group}-night` : (GLYPHS[group] ? group : 'unknown');
  const g = GLYPHS[key];
  const kids = [s('circle', { cx: 12, cy: 12, r: R, class: 'wx-frame', 'stroke-dasharray': g.dashedFrame ? '2 2.4' : null })];
  if (g.sun) kids.push(s('circle', { cx: g.sun[0], cy: g.sun[1], r: g.sun[2], class: 'wx-sun' }));
  if (g.moon) kids.push(s('path', { d: 'M14.6 6.6a5.6 5.6 0 1 0 2.8 9.6 4.6 4.6 0 0 1-2.8-9.6Z', class: 'wx-moon' }));
  if (g.moonSmall) kids.push(s('path', { d: 'M15.4 6.2a3.4 3.4 0 1 0 1.8 5.9 2.8 2.8 0 0 1-1.8-5.9Z', class: 'wx-moon' }));
  for (const d of g.strata || []) kids.push(s('path', { d, class: 'wx-strata' }));
  for (const d of g.marks || []) kids.push(s('path', { d, class: 'wx-fall' }));
  for (const [cx, cy] of g.dots || []) kids.push(s('circle', { cx, cy, r: 0.95, class: 'wx-dot' }));
  if (g.bolt) kids.push(s('path', { d: g.bolt, class: 'wx-bolt' }));
  return s('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': size <= 20 ? 1.7 : 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    class: `icon wx wx-${group}`,
    'aria-hidden': label ? null : 'true',
    role: label ? 'img' : null,
    'aria-label': label,
  }, label ? s('title', { text: label }) : null, ...kids);
}

/**
 * The brand mark, "the Aperture": a circle (the window, and the average)
 * holding one contour that wanders off it (the real week), with the solar
 * index on the rim. It is the week signature reduced to a symbol.
 */
export function brandMark(size = 30) {
  return s('svg', { viewBox: '-16 -16 32 32', width: size, height: size, class: 'brand-mark', 'aria-hidden': 'true' },
    s('circle', { r: 13, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }),
    s('path', { d: markContour(13), fill: 'none', 'stroke-width': 1.7, 'stroke-linejoin': 'round', class: 'brand-contour' }),
    s('circle', { cx: 9.19, cy: -9.19, r: 2.3, class: 'brand-sun' }));
}
