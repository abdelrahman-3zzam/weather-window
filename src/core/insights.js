// Weekly insights. Each insight states which quantity it is about (daily
// maximum, daily minimum, maximum hourly probability, daily total) and is
// only produced when the data it needs is present.

import { isNum } from './num.js';
import { mean, stdDev, argMax, argMin, maxStep } from './stats.js';
import { weekdayLong, weekdayShort } from './time.js';
import { uvCategory } from './weathercodes.js';

/**
 * @param days normalized forecast days
 * @param f formatting helpers { temp, delta, precip, pct } bound to the unit system
 */
export function weeklyInsights(days, f) {
  const out = [];
  const highs = days.map((d) => d.high);
  const lows = days.map((d) => d.low);
  const allHighs = highs.every(isNum);

  // The central idea: what the mean of daily maxima hides.
  if (allHighs && days.length >= 3) {
    const m = mean(highs);
    const near = highs.filter((h) => Math.abs(h - m) <= 1.5).length;
    const lo = Math.min(...highs);
    const hi = Math.max(...highs);
    out.push({
      id: 'average',
      kind: 'average',
      title: 'What the average hides',
      value: `${f.temp(m)} mean`,
      detail: `The mean daily maximum is ${f.temp(m)}, but individual days peak anywhere from ${f.temp(lo)} to ${f.temp(hi)}. ${near} of ${days.length} days come within ±${f.deltaPlain(1.5)} of the mean.`,
      day: null,
    });
  }

  const iw = argMax(highs);
  if (iw !== null) {
    out.push({ id: 'warmest', kind: 'heat', title: 'Warmest afternoon', value: f.temp(highs[iw]), detail: `${weekdayLong(days[iw].date)} has the highest daily maximum. That is a peak, not an all-day temperature.`, day: iw });
  }

  const ic = argMin(lows);
  if (ic !== null) {
    out.push({ id: 'coolest', kind: 'cool', title: 'Coolest night', value: f.temp(lows[ic]), detail: `${weekdayLong(days[ic].date)} has the lowest daily minimum, usually reached around dawn.`, day: ic });
  }

  if (allHighs) {
    const step = maxStep(highs);
    if (step && step.size >= 2) {
      const a = days[step.from].date;
      const b = days[step.to].date;
      out.push({ id: 'swing', kind: 'swing', title: 'Biggest day-to-day swing', value: f.delta(step.delta, true), detail: `Daily maximum changes from ${f.temp(highs[step.from])} on ${weekdayShort(a)} to ${f.temp(highs[step.to])} on ${weekdayShort(b)}.`, day: step.to });
    }
  }

  const ranges = days.map((d) => (isNum(d.high) && isNum(d.low) ? d.high - d.low : null));
  const ir = argMax(ranges);
  if (ir !== null && ranges[ir] >= 6) {
    out.push({ id: 'range', kind: 'range', title: 'Widest daily range', value: f.deltaPlain(ranges[ir]), detail: `${weekdayLong(days[ir].date)} runs from ${f.temp(lows[ir])} to ${f.temp(highs[ir])}. Dress for both ends.`, day: ir });
  }

  const pops = days.map((d) => d.popMax);
  const ip = argMax(pops);
  if (ip !== null && pops[ip] >= 20) {
    const sum = days[ip].precipSum;
    const amount = isNum(sum) ? ` The model's expected total for the day is ${f.precip(sum)}, a separate quantity from the probability.` : '';
    out.push({ id: 'wet', kind: 'wet', title: 'Best chance of precipitation', value: f.pct(pops[ip]), detail: `${weekdayLong(days[ip].date)} has the highest hourly probability of more than 0.1 mm.${amount}`, day: ip });
  }

  const uvs = days.map((d) => d.uvMax);
  const iu = argMax(uvs);
  if (iu !== null && uvs[iu] >= 3) {
    const cat = uvCategory(uvs[iu]);
    out.push({ id: 'uv', kind: 'uv', title: 'Strongest sun', value: `UV ${Math.round(uvs[iu] * 10) / 10}`, detail: `${weekdayLong(days[iu].date)} peaks at ${cat.label.toLowerCase()} UV around midday.`, day: iu });
  }

  // A standout: the day whose maximum differs most from the other days.
  if (allHighs && days.length >= 5) {
    let best = null;
    highs.forEach((h, i) => {
      const others = highs.filter((_, j) => j !== i);
      const dev = h - mean(others);
      const sd = stdDev(others);
      if (Math.abs(dev) >= Math.max(3, 1.5 * sd) && (!best || Math.abs(dev) > Math.abs(best.dev))) best = { i, dev };
    });
    if (best) {
      out.push({ id: 'standout', kind: 'standout', title: 'The odd day out', value: f.delta(best.dev, true), detail: `${weekdayLong(days[best.i].date)}'s maximum is ${f.deltaPlain(Math.abs(best.dev))} ${best.dev > 0 ? 'warmer' : 'cooler'} than the average of the other days.`, day: best.i });
    }
  }

  return out;
}

/** A two-sentence story of the week, assembled from the same facts. */
export function weekStory(days, f) {
  const highs = days.map((d) => d.high);
  if (!highs.every(isNum) || days.length < 3) return 'Some daily values are missing, so Weather Window will not summarise this week.';
  const first = mean(highs.slice(0, 3));
  const last = mean(highs.slice(-3));
  const trend = last - first > 2 ? 'warms toward the weekend' : first - last > 2 ? 'cools as it goes on' : 'holds fairly steady';
  const iw = argMax(highs);
  const step = maxStep(highs);
  const wet = days.filter((d) => isNum(d.popMax) && d.popMax >= 40).map((d) => weekdayShort(d.date));
  let s = `The week ${trend}, with daily maxima peaking on ${weekdayLong(days[iw].date)} at ${f.temp(highs[iw])}.`;
  if (step && step.size >= 4) s += ` Watch the ${f.deltaPlain(step.size)} jump between ${weekdayShort(days[step.from].date)} and ${weekdayShort(days[step.to].date)}.`;
  if (wet.length > 3) s += ` ${wet.length} of ${days.length} days carry at least a 40% chance of precipitation.`;
  else if (wet.length) s += ` ${wet.length > 1 ? `${wet.slice(0, -1).join(', ')} and ${wet[wet.length - 1]}` : wet[0]} ${wet.length > 1 ? 'carry' : 'carries'} at least a 40% chance of precipitation.`;
  else s += ' No day reaches a 40% chance of precipitation.';
  return s;
}
