// The flight results for a leg, drawn like the rest of the planner: a plane crossing a dotted arc while Pinroute
// searches; then the two quotes (Amadeus and Aviasales) as a price duel, the cheapest day around the date as a row of
// calendar days, a filter bar, and every fare as a boarding pass with a tear-off price stub.
// Filters run here on the offers already found, with the same rules as the server, so a tap costs no search.
import { ExternalLink, Plane, TrendingDown, Sunrise, Sun, Sunset, Moon, Luggage, Zap, Award, Sparkles, X } from 'lucide';
import { h, s, icon, day, money, hm, clock, days, plural } from './dom.js';
import { applyFilters, sortFares, carriersOf } from '../src/flightfilter.mjs';

// Times of day for the departure filter, as local clock ranges
export const SLOTS = { morning: ['05:00', '11:59', 'Morning', Sunrise], afternoon: ['12:00', '17:59', 'Afternoon', Sun], evening: ['18:00', '23:59', 'Evening', Sunset], night: ['00:00', '04:59', 'Night', Moon] };
const SORTS = [['price', 'Cheapest'], ['best', 'Best'], ['duration', 'Fastest'], ['departure', 'Earliest']];
const WK = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const DN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' });
const MN = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const at = (iso) => new Date(`${iso}T00:00:00Z`);

// The filters a leg's state holds, applied to its fares: several departure slots mean any of them
export function filtered(st) {
  const f = st.filter || {};
  let list = applyFilters(st.fares, { max_stops: f.stops ?? undefined, bag_included: f.bag || undefined, airlines: f.airlines?.length ? f.airlines : undefined });
  const slots = Object.keys(f.slots || {}).filter((k) => f.slots[k]);
  if (slots.length) list = list.filter((x) => slots.some((k) => applyFilters([x], { depart_after: SLOTS[k][0], depart_before: SLOTS[k][1] }).length));
  return sortFares(list, st.sort || 'price');
}
const activeFilters = (f = {}) => (f.stops != null ? 1 : 0) + (f.bag ? 1 : 0) + Object.values(f.slots || {}).filter(Boolean).length + (f.airlines?.length || 0);

// ---------------------------------------------------------------- while searching
// A plane flies a dotted arc between the two airports; under it what is being searched, and fare-shaped placeholders
export function searching(from, to, date, refresh) {
  const P = 'M 24 66 Q 150 -6 276 66';
  const inner = s('g', { transform: 'rotate(45) translate(-10 -10)' });
  inner.append(sized(icon(Plane), 20));
  const plane = s('g', { class: 'fs-plane' });
  plane.append(inner);
  const motion = s('animateMotion', { dur: '2.8s', repeatCount: 'indefinite', rotate: 'auto', path: P, keyPoints: '0;1', keyTimes: '0;1', calcMode: 'spline', keySplines: '0.45 0 0.55 1' });
  plane.append(motion);
  const sky = s('svg', { class: 'fs-arc', viewBox: '0 0 300 90', 'aria-hidden': 'true' });
  sky.append(s('path', { class: 'fs-trail', d: P }),
    s('circle', { class: 'fs-dot', cx: 24, cy: 66, r: 5 }), s('circle', { class: 'fs-dot', cx: 276, cy: 66, r: 5 }),
    s('circle', { class: 'fs-ping', cx: 276, cy: 66, r: 5 }),
    s('text', { class: 'fs-code', x: 24, y: 88, 'text-anchor': 'middle' }, from), s('text', { class: 'fs-code', x: 276, y: 88, 'text-anchor': 'middle' }, to),
    plane);
  const step = (text, i) => h('li', { style: `--i:${i}` }, h('span', { class: 'fs-spin' }), text);
  return h('div', { class: 'fsearch', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'fs-card' },
      sky,
      h('p', { class: 'fs-title', text: `Finding flights for ${day(date)}` }),
      h('ul', { class: 'fs-steps' }, step('Airline fares', 0), step('2 days either side', 1), step('Trip.com to compare', 2))),
    h('div', { class: 'fs-ghosts' }, [0, 1, 2].map((i) => h('div', { class: 'fs-ghost', style: `--i:${i}` }, h('i', { class: 'a' }), h('i', { class: 'b' }), h('i', { class: 'c' }), h('i', { class: 'd' })))),
    refresh ? h('button', { class: 'link skel-refresh', text: 'Refresh', onclick: refresh }) : null);
}
function sized(svg, n) { svg.setAttribute('width', n); svg.setAttribute('height', n); return svg; }

// ---------------------------------------------------------------- filters
const pill = (on, label, click, title) => h('button', { class: 'pill toggle', 'aria-pressed': String(!!on), title: title || null, onclick: click }, label);

export function filterBar(st, render, provider) {
  const f = (st.filter ||= {});
  const fc = st.facets || {};
  const stops = fc.stops || {};
  const set = (k, v) => { f[k] = v; render(); };
  const toggleSlot = (k) => { f.slots = { ...(f.slots || {}), [k]: !f.slots?.[k] }; render(); };
  const toggleAir = (code) => { const a = new Set(f.airlines || []); a.has(code) ? a.delete(code) : a.add(code); f.airlines = [...a]; render(); };
  const shown = filtered(st);
  const n = activeFilters(f);
  const from = (k) => (stops[k] != null ? h('span', { class: 'pfrom', text: money(stops[k], fc.price?.currency) }) : null);
  // how many fares leave in each part of the day, so an empty slot reads as one before it is tapped
  const inSlot = (k) => st.fares.filter((x) => applyFilters([x], { depart_after: SLOTS[k][0], depart_before: SLOTS[k][1] }).length).length;
  return h('div', { class: 'ffilters' },
    h('div', { class: 'fsort', role: 'group', 'aria-label': 'Sort' },
      ...SORTS.map(([k, label]) => h('button', { 'aria-pressed': String((st.sort || 'price') === k), onclick: () => { st.sort = k; render(); } }, label))),
    h('div', { class: 'frow chips', role: 'group', 'aria-label': 'Changes and bags' },
      pill(f.stops == null, 'Any stops', () => set('stops', null)),
      stops['0'] != null || f.stops === 0 ? pill(f.stops === 0, ['Direct', from('0')], () => set('stops', f.stops === 0 ? null : 0)) : null,
      stops['1'] != null || f.stops === 1 ? pill(f.stops === 1, ['Up to 1 stop', from('1')], () => set('stops', f.stops === 1 ? null : 1)) : null,
      fc.bagIncluded ? pill(f.bag, [icon(Luggage), `Bag included (${fc.bagIncluded})`], () => set('bag', !f.bag)) : null),
    h('div', { class: 'ftimes', role: 'group', 'aria-label': 'Departure time' },
      ...Object.entries(SLOTS).map(([k, [a, b, label, ic]]) => {
        const c = inSlot(k);
        return h('button', { class: `ftime${c ? '' : ' none'}`, 'aria-pressed': String(!!f.slots?.[k]), title: `Leaves ${a}–${b}: ${plural(c, 'fare')}`, onclick: () => toggleSlot(k) },
          icon(ic), h('span', { class: 'fl', text: label }), h('span', { class: 'fr', text: `${a.slice(0, 2)}–${String(+b.slice(0, 2) + 1).padStart(2, '0')}` }));
      })),
    (fc.airlines || []).length > 1 ? h('div', { class: 'frow airl', role: 'group', 'aria-label': 'Airlines' },
      ...fc.airlines.slice(0, 8).map((a) => pill((f.airlines || []).includes(a.code || a.name), [badge(a.code, a.name, 'sm'), `${a.name}`, h('span', { class: 'pfrom', text: money(a.from, fc.price?.currency) })], () => toggleAir(a.code || a.name)))) : null,
    h('div', { class: 'fcount' },
      h('span', { class: 'small', text: `${shown.length} of ${plural(st.fares.length, 'flight')} · ${st.live ? provider : 'demo data'}` }),
      n ? h('button', { class: 'link', onclick: () => { st.filter = {}; render(); } }, icon(X), `Clear ${plural(n, 'filter')}`) : null));
}
export const clearFilters = (st, render) => h('button', { onclick: () => { st.filter = {}; render(); } }, icon(X), 'Clear filters');

// ---------------------------------------------------------------- the two quotes
// Amadeus's cheapest offer, and Aviasales's recent price when the server has it on: one bar each, as long as the price,
// the cheaper one marked; then Trip.com's search for the same route and dates, to compare live prices there
export function quotes(st, openLink, openAviasales) {
  const c = st.compare;
  if (!c || (!c.amadeus && !c.aviasales && !c.aviasales_link && !c.tripcom_link)) return null;
  const hi = Math.max(c.amadeus?.total || 0, c.aviasales?.total || 0) || 1;
  const row = (who, q, sub, link, label) => {
    const win = c.cheaper === who || (c.cheaper === 'same' && q);
    return h('div', { class: `quote${win ? ' win' : ''}${q ? '' : ' empty'}` },
      h('div', { class: 'qtop' },
        h('div', { class: 'qwho' }, h('span', { class: 'qsrc', text: who === 'amadeus' ? 'Airlines (Amadeus)' : 'Aviasales' }), h('span', { class: 'small', text: q ? sub(q) : who === 'aviasales' ? 'No recent price for these dates' : 'No offer matches' })),
        h('span', { class: `qprice${q ? '' : ' none'}`, text: q ? money(q.total, q.currency) : '–' })),
      h('div', { class: 'qbar' }, h('i', { style: `--w:${q ? Math.max(8, Math.round((q.total / hi) * 100)) : 0}%` })),
      h('div', { class: 'qfoot' },
        c.cheaper === who && c.difference ? h('span', { class: 'pill done' }, icon(TrendingDown), `${money(c.difference, q.currency)} cheaper`) : h('span'),
        link ? h('button', { class: 'link', onclick: link }, icon(ExternalLink), label) : null));
  };
  const aviasales = c.aviasales || c.aviasales_link;
  return h('section', { class: 'quotes', 'aria-label': 'Price from each source' },
    h('p', { class: 'eyebrow', text: aviasales ? 'Two places to book' : 'Where to book' }),
    row('amadeus', c.amadeus, (q) => q.airline, c.amadeus?.link ? () => openLink(c.amadeus.link) : null, 'Airline’s site'),
    aviasales ? row('aviasales', c.aviasales, (q) => `${q.airline} · ${q.stops ? `${q.stops} change${q.stops > 1 ? 's' : ''}` : 'direct'} · found recently`,
      c.aviasales_link ? () => openAviasales(c.aviasales_link) : null, c.aviasales ? 'Check on Aviasales' : 'Search Aviasales') : null,
    c.tripcom_link ? h('div', { class: 'quote empty tripcom' },
      h('div', { class: 'qtop' },
        h('div', { class: 'qwho' }, h('span', { class: 'qsrc', text: 'Trip.com' }), h('span', { class: 'small', text: 'Live prices from airlines and agencies, low-cost airlines included' }))),
      h('div', { class: 'qfoot' }, h('span'), h('button', { class: 'link', onclick: () => openAviasales(c.tripcom_link) }, icon(ExternalLink), 'Compare on Trip.com'))) : null);
}

// ---------------------------------------------------------------- the days around
// The cheapest price each day around the leg's date, as calendar days tinted by price; the leg's own day is raised
export function dateStrip(st, date) {
  const cal = (st.calendar || []).filter((c) => c.lowest != null || c.best != null);
  if (cal.length < 2) return null;
  const val = (c) => c.lowest ?? c.best;
  const lo = Math.min(...cal.map(val)), hi = Math.max(...cal.map(val));
  const here = cal.find((c) => c.date === date);
  const best = cal.reduce((a, b) => (val(b) < val(a) ? b : a));
  const save = here && best.date !== date ? val(here) - val(best) : 0;
  return h('section', { class: 'dstrip', 'aria-label': 'Cheapest fare by day' },
    h('p', { class: 'eyebrow', text: 'Cheapest by day' }),
    h('div', { class: 'dbars' }, ...(st.calendar || []).map((c) => {
      const v = val(c);
      const cheap = v == null ? 0 : hi === lo ? 0.6 : 1 - (v - lo) / (hi - lo);       // 1 = the cheapest day
      return h('div', { class: `dbar${c.date === date ? ' here' : ''}${c === best ? ' low' : ''}${v == null ? ' none' : ''}`, style: `--c:${cheap.toFixed(2)}`, title: v == null ? `${day(c.date)}: no offer` : `${day(c.date)}: ${money(v, c.currency)}` },
        h('span', { class: 'dday', text: WK.format(at(c.date)) }),
        h('b', { class: 'dnum', text: DN.format(at(c.date)) }),
        h('span', { class: 'dmon', text: MN.format(at(c.date)) }),
        h('span', { class: 'dprice', text: v == null ? '–' : money(v, c.currency) }),
        c.date === date ? h('span', { class: 'dtag', text: 'Your day' }) : c === best ? h('span', { class: 'dtag', text: 'Lowest' }) : null);
    })),
    save > 0
      ? h('p', { class: 'dnote' }, icon(TrendingDown), ` Flying ${day(best.date)} costs ${money(save, best.currency)} less. Change the nights at the stops to move the date.`)
      : h('p', { class: 'dnote good' }, icon(Sparkles), ` ${day(date)} is the cheapest day around it.`));
}

// ---------------------------------------------------------------- a fare as a boarding pass
// The airline as a round monogram in its own colour (the same code always gets the same colour)
function badge(code, name, size = '') {
  const words = String(name || '').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  const c = (code && code !== 'XX' ? code : words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
  let hue = 0;
  for (const ch of String(name || c)) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return h('span', { class: `al ${size}`, style: `--hue:${hue}`, 'aria-hidden': 'true', text: c });
}

// What stands out in the results: the cheapest, the fastest and the best trade-off, each on one fare
export function standouts(list) {
  if (!list.length) return new Map();
  const mins = (f) => f.bounds.reduce((n, b) => n + (b.minutes || 0), 0);
  const tags = new Map();
  const add = (f, t) => tags.set(f, [...(tags.get(f) || []), t]);
  const cheapest = sortFares(list, 'price')[0], fastest = sortFares(list, 'duration')[0], best = sortFares(list, 'best')[0];
  add(cheapest, ['cheap', 'Cheapest', TrendingDown]);
  if (mins(fastest) < mins(cheapest)) add(fastest, ['fast', 'Fastest', Zap]);
  if (best !== cheapest && best !== fastest) add(best, ['best', 'Best value', Award]);
  return tags;
}

export function fareCard(f, { adults, tags = [], i = 0, busy, onChoose, onLink }) {
  const b = f.bounds[0];
  const plus = days(String(b.departs).slice(0, 10), String(b.arrives).slice(0, 10));
  const nos = b.flights.map((x) => x.number).filter((n) => !/^XX/.test(n));
  const code = carriersOf(f)[0];
  const hops = b.stops ? b.changes.map((c) => c.at) : [];
  const facts = [
    b.bags ? h('span', { class: 'fact ok' }, icon(Luggage), b.bags) : h('span', { class: 'fact' }, icon(Luggage), 'Bags not stated'),
    nos.length ? h('span', { class: 'fact', text: nos.join(' · ') }) : null,
    f.seatsLeft ? h('span', { class: 'fact warn', text: `${plural(f.seatsLeft, 'seat')} left` }) : null,
  ];
  return h('article', { class: `fare${tags.length ? ' std' : ''}`, style: `--i:${i}` },
    h('div', { class: 'fmain' },
      h('div', { class: 'fhead' }, badge(code, f.airline),
        h('span', { class: 'fair', text: f.airline }),
        h('span', { class: 'ftags' }, tags.map(([k, t, ic]) => h('span', { class: `ftag ${k}` }, icon(ic), t)))),
      h('div', { class: 'times' },
        h('span', { class: 'fend' }, h('b', { class: 'dep', text: clock(b.departs) }), h('span', { class: 'fcode', text: b.from })),
        h('span', { class: 'fpath' },
          h('span', { class: 'fdur', text: hm(b.minutes) }),
          h('span', { class: 'fline' }, hops.map((a) => h('i', { class: 'fstop', title: `Change at ${a}` })), h('span', { class: 'fpl' }, icon(Plane))),
          h('span', { class: `fstops${b.stops ? ' has' : ''}`, text: b.stops ? `${plural(b.stops, 'stop')} · ${b.changes.map((c) => `${c.at} ${hm(c.minutes)}`).join(', ')}` : 'Direct' })),
        h('span', { class: 'fend r' }, h('b', { class: 'arr' }, clock(b.arrives), plus > 0 ? h('sup', { class: 'plus', text: `+${plus}` }) : null), h('span', { class: 'fcode', text: b.to }))),
      h('div', { class: 'facts' }, facts)),
    h('div', { class: 'fstub' },
      h('div', { class: 'fprice' }, h('b', { class: 'price', text: money(f.total, f.currency) }),
        h('span', { class: 'small', text: adults > 1 && f.perAdult ? `for ${adults} · ${money(f.perAdult, f.currency)} each` : `for ${adults}` })),
      h('div', { class: 'fbtns' },
        f.link ? h('button', { class: 'ghost icon-btn', title: f.demo ? 'Check on Google Flights' : 'Book on the airline’s site', 'aria-label': f.demo ? 'Check on Google Flights' : 'Book on the airline’s site', onclick: () => onLink(f.link) }, icon(ExternalLink)) : null,
        h('button', { class: i === 0 ? 'primary' : '', disabled: busy, onclick: onChoose }, 'Choose'))));
}
