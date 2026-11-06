// The instrument: lens + day dial, composed into one figure. Chooses the
// WebGL lens when it is available and falls back to the 2D sky otherwise
// (no WebGL, shader failure, or a lost GPU context mid-session).

import { h, replace } from './dom.js';
import { icon } from './icons.js';
import { createLens } from './lens.js';
import { createSky } from './sky.js';
import { createDial } from './dial.js';
import { isNum } from '../core/num.js';
import { describeCode } from '../core/weathercodes.js';

export function createInstrument(host, { onScrub }) {
  const stage = h('div', { class: 'instrument-stage' });
  const caption = h('figcaption', { class: 'instrument-caption' });
  const layerBar = h('div', { class: 'layer-bar', role: 'group', 'aria-label': 'Lens layers' });
  const figure = h('figure', { class: 'instrument', 'aria-label': 'The lens: an illustration of the selected forecast hour, with a dial for the hours of that day' }, stage, caption, layerBar);
  host.append(figure);

  let canvas = h('canvas', { class: 'lens-canvas', 'aria-hidden': 'true' });
  stage.append(canvas, h('div', { class: 'lens-shadow', 'aria-hidden': 'true' }));
  const dial = createDial(stage, { onScrub });

  let lens = null;
  let sky = null;
  let last = null;
  const layers = { strata: true, threads: true, veil: true, streaks: true };
  const LAYERS = [
    ['strata', 'Strata', 'temperature'],
    ['threads', 'Threads', 'wind'],
    ['veil', 'Veil', 'cloud'],
    ['streaks', 'Streaks', 'precip.'],
  ];

  // Peel the lens apart: each layer follows one forecast value, so hiding the
  // others shows that value on its own.
  function renderLayers() {
    if (!lens) { replace(layerBar); layerBar.hidden = true; return; }
    layerBar.hidden = false;
    replace(layerBar,
      h('span', { class: 'layer-label' }, 'Layers'),
      ...LAYERS.map(([key, name, data]) => h('button', {
        type: 'button', class: `layer-btn layer-${key}${layers[key] ? ' on' : ''}`, 'aria-pressed': String(layers[key]),
        title: `${layers[key] ? 'Hide' : 'Show'} the ${name.toLowerCase()} (${data})`,
        onclick: () => { layers[key] = !layers[key]; lens?.setLayers(layers); renderLayers(); },
      }, h('i', { 'aria-hidden': 'true' }), name, h('small', null, data))));
  }

  function fallback(reason) {
    lens = null;
    renderLayers();
    const c2 = h('canvas', { class: 'sky', 'aria-hidden': 'true' });
    canvas.replaceWith(c2);
    canvas = c2;
    try { sky = createSky(c2); } catch { sky = null; }
    figure.dataset.renderer = sky ? '2d' : 'none';
    figure.dataset.reason = reason;
    if (last) apply(last);
  }

  try { lens = createLens(canvas, { onFail: (why) => fallback(why) }); } catch { lens = null; }
  if (lens) figure.dataset.renderer = 'webgl';
  else fallback('no-webgl');
  renderLayers();

  function apply(p) {
    const { encoded, moment, synthetic } = p;
    if (lens && encoded) lens.set(encoded.params);
    if (sky && moment) {
      const sunFrac = isNum(moment.sunrise) && isNum(moment.sunset) && moment.t > moment.sunrise && moment.t < moment.sunset
        ? (moment.t - moment.sunrise) / (moment.sunset - moment.sunrise) : 0.5;
      sky.set({ isDay: !encoded?.night, sunFrac, cloud: moment.cloud ?? 50, group: describeCode(moment.code).group });
    }
    const renderer = figure.dataset.renderer;
    replace(caption,
      h('span', null, synthetic ? 'Illustration of synthetic values' : 'Illustration of forecast values, not a simulation'),
      renderer === 'webgl' ? h('span', { class: 'hint-turn' }, icon('turn', { size: 12 }), 'Drag the lens to turn it · drag the ring to change the hour') : null,
      renderer === '2d' ? h('span', null, 'Simplified 2D view (3D needs WebGL)') : null,
      renderer === 'none' ? h('span', null, 'Illustration unavailable in this browser') : null);
  }

  return {
    update(p) {
      last = p;
      dial.update({ forecast: p.forecast, hourIndex: p.hourIndex, units: p.units, now: p.now });
      apply(p);
    },
    open() { lens?.open(); },
    focusDial() { dial.focus(); },
    get renderer() { return figure.dataset.renderer; },
    destroy() { lens?.destroy(); sky?.destroy(); },
  };
}
