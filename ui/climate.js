// The weather by month on the Best time step: a column for each of the next twelve months, in the same order as the
// fares under it. Each column has the day and night temperature as a capsule coloured from cold blue to hot coral,
// the rain as a blue bar with its rainy days, the hours of sunshine as a sun that grows with them and, for a coast,
// the sea temperature. Ten-year averages from Open-Meteo, looked up once by the server (country_weather) and kept.
import { Sun, CloudRain, Waves, Thermometer, RotateCcw } from 'lucide';
import { MONTHS, MON } from '../src/discover.mjs';
import { call, render } from './core.js';
import { h, icon } from './dom.js';

const C = { data: {}, shown: new Set() };

// Temperature to colour: a few fixed stops, blended
const STOPS = [[-10, [94, 129, 214]], [3, [111, 170, 214]], [12, [102, 191, 178]], [20, [236, 196, 84]], [27, [241, 147, 86]], [34, [221, 89, 63]]];
export function tempColor(t) {
  if (t <= STOPS[0][0]) return `rgb(${STOPS[0][1]})`;
  for (let i = 1; i < STOPS.length; i++) {
    const [b, cb] = STOPS[i], [a, ca] = STOPS[i - 1];
    if (t <= b) { const k = (t - a) / (b - a); return `rgb(${ca.map((x, j) => Math.round(x + (cb[j] - x) * k)).join(' ')})`; }
  }
  return `rgb(${STOPS.at(-1)[1].join(' ')})`;
}
const deg = (t) => `${Math.round(t)}°`;

async function load(key, args) {
  C.data[key] = 'loading';
  try { C.data[key] = (await call('country_weather', args)).structuredContent; }
  catch (e) { C.data[key] = { error: e.message || String(e) }; }
  render();
}

// d: the country; ms: the months shown ({ m, year }); airport: a focus area's airport, if any; at: what to call the place
export function climatePanel(d, ms, airport) {
  const key = `${d.id}|${airport || ''}`;
  if (C.data[key] === undefined) queueMicrotask(() => load(key, { country: d.id, ...(airport ? { airport } : {}) }));
  const v = C.data[key];
  if (v === undefined || v === 'loading') return skeleton();
  if (v.error) {
    return h('section', { class: 'clim clim-err', 'aria-label': 'Weather by month' },
      h('p', { class: 'small', text: 'The weather by month could not be loaded just now.' }),
      h('button', { class: 'ghost', onclick: () => { delete C.data[key]; render(); } }, icon(RotateCcw), 'Try again'));
  }
  const c = v.climate, rows = ms.map((mo) => ({ mo, w: c.months[mo.m] })).filter((r) => r.w);
  if (!rows.length) return null;
  const anim = !C.shown.has(key);
  C.shown.add(key);
  const all = c.months.filter(Boolean);
  const tMin = Math.min(...all.map((w) => w.lo)), tMax = Math.max(...all.map((w) => w.hi));
  const span = Math.max(8, tMax - tMin), lo0 = tMin - span * 0.06, range = span * 1.12;
  const rainMax = Math.max(120, ...all.map((w) => w.rain));
  const hasSea = all.some((w) => w.sea != null), hasSun = all.some((w) => w.sun != null);
  const pick = (f, low) => c.months.map((w, i) => (w ? { w, i } : null)).filter(Boolean).sort((a, b) => (low ? f(a.w) - f(b.w) : f(b.w) - f(a.w)))[0];
  const warm = pick((w) => w.hi), dry = pick((w) => w.rain, true), sunny = hasSun ? pick((w) => w.sun ?? 0) : null, sea = hasSea ? pick((w) => w.sea ?? -99) : null;
  const where = v.place ? `around ${v.place}` : `around ${v.airport}`;

  return h('section', { class: `clim${anim ? ' anim' : ''}`, 'aria-label': `Weather by month in ${d.name}` },
    h('div', { class: 'clim-head' },
      h('div', {}, h('h3', { text: 'What the weather is like' }),
        h('p', { class: 'small', text: `Averages for ${c.years} ${where}, from ${c.source.replace(/ \(.*\)$/, '')}.` })),
      h('div', { class: 'clim-facts' },
        fact(Thermometer, 'warm', 'Warmest', MONTHS[warm.i], deg(warm.w.hi)),
        fact(CloudRain, 'rain', 'Driest', MONTHS[dry.i], `${dry.w.rain} mm`),
        sunny ? fact(Sun, 'sun', 'Sunniest', MONTHS[sunny.i], `${sunny.w.sun} h`) : null,
        sea ? fact(Waves, 'sea', 'Warmest sea', MONTHS[sea.i], deg(sea.w.sea)) : null)),
    h('div', { class: 'cgrid', role: 'list' }, rows.map(({ mo, w }, i) => {
      const bottom = ((w.lo - lo0) / range) * 100, top = ((w.hi - lo0) / range) * 100;
      const good = d.months[mo.m] === 'G';
      return h('div', { class: `ccol${good ? ' good' : ''}`, role: 'listitem', style: `--i:${i}`,
        'aria-label': `${MONTHS[mo.m]}: ${deg(w.lo)} to ${deg(w.hi)}C, ${w.rain} mm of rain on ${w.wet} days${w.sun != null ? `, ${w.sun} hours of sun a day` : ''}${w.sea != null ? `, sea ${deg(w.sea)}C` : ''}${good ? ', a good month to go' : ''}` },
        h('span', { class: 'ctrack', 'aria-hidden': 'true' },
          h('span', { class: 'ccap', style: `bottom:${bottom.toFixed(1)}%;height:${Math.max(6, top - bottom).toFixed(1)}%;background:linear-gradient(to top, ${tempColor(w.lo)}, ${tempColor(w.hi)})` },
            h('b', { class: 'chi', text: deg(w.hi) }), h('b', { class: 'clo', text: deg(w.lo) }))),
        h('span', { class: 'crain', 'aria-hidden': 'true', title: `${w.rain} mm on ${w.wet} rainy days` },
          h('span', { class: 'cbar', style: `height:${Math.max(3, (w.rain / rainMax) * 100).toFixed(1)}%` }),
          h('span', { class: 'cval', text: `${w.rain}` })),
        hasSun ? h('span', { class: 'csun', 'aria-hidden': 'true', title: `${w.sun ?? '?'} hours of sun a day` },
          h('span', { class: 'cglyph', style: `--k:${(0.55 + Math.min(1, (w.sun ?? 0) / 11) * 0.6).toFixed(2)}` }, icon(Sun)),
          h('span', { class: 'cval', text: w.sun != null ? `${Math.round(w.sun)}h` : '–' })) : null,
        hasSea ? h('span', { class: 'csea', 'aria-hidden': 'true', title: 'Sea temperature' }, w.sea != null ? deg(w.sea) : '–') : null,
        h('span', { class: 'cmon', text: MON[mo.m] }));
    })),
    h('div', { class: 'clim-key small', 'aria-hidden': 'true' },
      h('span', {}, h('i', { class: 'k-temp' }), 'Day and night °C'),
      h('span', {}, h('i', { class: 'k-rain' }), 'Rain, mm a month'),
      hasSun ? h('span', {}, icon(Sun), 'Sun, hours a day') : null,
      hasSea ? h('span', {}, h('i', { class: 'k-sea' }), 'Sea °C') : null,
      h('span', {}, h('i', { class: 'k-good' }), 'Good season')));
}

function fact(ic, cls, label, month, val) {
  return h('span', { class: `cfact ${cls}` }, icon(ic), h('span', {}, h('span', { class: 'cf-l', text: label }), h('b', { text: `${month} · ${val}` })));
}

function skeleton() {
  return h('section', { class: 'clim loading', 'aria-label': 'Weather by month', 'aria-busy': 'true' },
    h('div', { class: 'clim-head' }, h('div', {}, h('h3', { text: 'What the weather is like' }), h('p', { class: 'small', text: 'Loading ten years of weather…' }))),
    h('div', { class: 'cgrid' }, Array.from({ length: 12 }, (_, i) => h('div', { class: 'ccol sk', style: `--i:${i}` }, h('span', { class: 'ctrack' }), h('span', { class: 'crain' })))));
}
