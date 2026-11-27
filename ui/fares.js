// The flight results for a leg: the two quotes (Amadeus and Aviasales), the cheapest day around the date, and a filter
// bar. Filters run here on the offers already found, with the same rules as the server, so a tap costs no search.
import { ExternalLink, Plane, TrendingDown } from 'lucide';
import { h, icon, day, money } from './dom.js';
import { applyFilters, sortFares } from '../src/flightfilter.mjs';

// Times of day for the departure filter, as local clock ranges
export const SLOTS = { morning: ['05:00', '11:59', 'Morning'], afternoon: ['12:00', '17:59', 'Afternoon'], evening: ['18:00', '23:59', 'Evening'], night: ['00:00', '04:59', 'Night'] };
const SORTS = [['price', 'Cheapest'], ['best', 'Best'], ['duration', 'Fastest'], ['departure', 'Earliest']];

// The filters a leg's state holds, applied to its fares: several departure slots mean any of them
export function filtered(st) {
  const f = st.filter || {};
  let list = applyFilters(st.fares, { max_stops: f.stops ?? undefined, bag_included: f.bag || undefined, airlines: f.airlines?.length ? f.airlines : undefined });
  const slots = Object.keys(f.slots || {}).filter((k) => f.slots[k]);
  if (slots.length) list = list.filter((x) => slots.some((k) => applyFilters([x], { depart_after: SLOTS[k][0], depart_before: SLOTS[k][1] }).length));
  return sortFares(list, st.sort || 'price');
}

const pill = (on, label, click, title) => h('button', { class: 'pill toggle', 'aria-pressed': String(!!on), title: title || null, onclick: click }, label);

export function filterBar(st, render, provider) {
  const f = (st.filter ||= {});
  const fc = st.facets || {};
  const stops = fc.stops || {};
  const set = (k, v) => { f[k] = v; render(); };
  const toggleSlot = (k) => { f.slots = { ...(f.slots || {}), [k]: !f.slots?.[k] }; render(); };
  const toggleAir = (code) => { const a = new Set(f.airlines || []); a.has(code) ? a.delete(code) : a.add(code); f.airlines = [...a]; render(); };
  const shown = filtered(st);
  const from = (k) => (stops[k] != null ? ` · ${money(stops[k], fc.price?.currency)}` : '');
  return h('div', { class: 'ffilters' },
    h('div', { class: 'frow', role: 'group', 'aria-label': 'Changes' },
      pill(f.stops == null, 'Any stops', () => set('stops', null)),
      stops['0'] != null || f.stops === 0 ? pill(f.stops === 0, `Direct${from('0')}`, () => set('stops', f.stops === 0 ? null : 0)) : null,
      pill(f.stops === 1, `Up to 1 stop${from('1')}`, () => set('stops', f.stops === 1 ? null : 1)),
      fc.bagIncluded ? pill(f.bag, `Bag included (${fc.bagIncluded})`, () => set('bag', !f.bag)) : null),
    h('div', { class: 'frow', role: 'group', 'aria-label': 'Departure time' },
      ...Object.entries(SLOTS).map(([k, [, , label]]) => pill(f.slots?.[k], label, () => toggleSlot(k), `Leaves ${SLOTS[k][0]}–${SLOTS[k][1]}`))),
    (fc.airlines || []).length > 1 ? h('div', { class: 'frow airl', role: 'group', 'aria-label': 'Airlines' },
      ...fc.airlines.slice(0, 8).map((a) => pill((f.airlines || []).includes(a.code || a.name), `${a.name} · ${money(a.from, fc.price?.currency)}`, () => toggleAir(a.code || a.name)))) : null,
    h('div', { class: 'frow sort', role: 'group', 'aria-label': 'Sort' },
      ...SORTS.map(([k, label]) => pill((st.sort || 'price') === k, label, () => { st.sort = k; render(); })),
      h('span', { class: 'small fcount', text: `${shown.length} of ${st.fares.length} · ${st.live ? provider : 'demo data'}` })));
}

// Amadeus's cheapest offer next to Aviasales's recent price, the cheaper one marked
export function quotes(st, openLink, openAviasales) {
  const c = st.compare;
  if (!c || (!c.amadeus && !c.aviasales && !c.aviasales_link)) return null;
  const card = (who, q, sub, link, label) => h('div', { class: `quote${c.cheaper === who || (c.cheaper === 'same' && q) ? ' win' : ''}` },
    h('div', { class: 'qsrc', text: who === 'amadeus' ? 'Airlines (Amadeus)' : 'Aviasales' }),
    q ? h('div', { class: 'qprice', text: money(q.total, q.currency) }) : h('div', { class: 'qprice none', text: '–' }),
    h('div', { class: 'small', text: q ? sub(q) : who === 'aviasales' ? 'No recent price for these dates' : 'No offer matches' }),
    c.cheaper === who && c.difference ? h('span', { class: 'pill done' }, icon(TrendingDown), `${money(c.difference, q.currency)} cheaper`) : null,
    link ? h('button', { class: 'link', onclick: link }, icon(ExternalLink), label) : null);
  return h('div', { class: 'quotes' },
    card('amadeus', c.amadeus, (q) => q.airline, c.amadeus?.link ? () => openLink(c.amadeus.link) : null, 'Airline’s site'),
    card('aviasales', c.aviasales, (q) => `${q.airline} · ${q.stops ? `${q.stops} change${q.stops > 1 ? 's' : ''}` : 'direct'} · found recently`,
      c.aviasales_link ? () => openAviasales(c.aviasales_link) : null, c.aviasales ? 'Check on Aviasales' : 'Search Aviasales'));
}

// The cheapest price each day around the leg's date, as bars; the leg's own day is marked
export function dateStrip(st, date) {
  const cal = (st.calendar || []).filter((c) => c.lowest != null || c.best != null);
  if (cal.length < 2) return null;
  const val = (c) => c.lowest ?? c.best;
  const lo = Math.min(...cal.map(val)), hi = Math.max(...cal.map(val));
  const here = cal.find((c) => c.date === date);
  const best = cal.reduce((a, b) => (val(b) < val(a) ? b : a));
  const save = here && best.date !== date ? val(here) - val(best) : 0;
  return h('div', { class: 'dstrip' },
    h('div', { class: 'dbars' }, ...(st.calendar || []).map((c) => {
      const v = val(c);
      const pct = v == null ? 0 : hi === lo ? 60 : 30 + Math.round(((v - lo) / (hi - lo)) * 70);
      return h('div', { class: `dbar${c.date === date ? ' here' : ''}${c === best ? ' low' : ''}`, title: v == null ? 'No offer' : `${day(c.date)}: ${money(v, c.currency)}` },
        h('span', { class: 'dprice', text: v == null ? '–' : money(v, c.currency) }),
        h('span', { class: 'dfill', style: `height:${pct}%` }),
        h('span', { class: 'dday', text: day(c.date) }));
    })),
    save > 0
      ? h('p', { class: 'small' }, icon(Plane), ` Flying ${day(best.date)} costs ${money(save, best.currency)} less. Change the nights at the stops to move the date.`)
      : h('p', { class: 'small', text: `${day(date)} is the cheapest day around it.` }));
}
