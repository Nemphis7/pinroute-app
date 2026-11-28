// Getting between stops on the ground: ferries, buses, minivans, trains and transfers. No booking site offers its
// timetable to partners like Pinroute (12Go, Bookaway and Omio give Travelpayouts partners links and search forms,
// not a data API), so each ground leg gets:
// - searches on the sites that sell those tickets for that part of the world, for the leg's own day: 12Go in Asia,
//   Omio in Europe, and Rome2Rio everywhere, which shows each operator and how to get between two places.
//   They are plain links until a program accepts Pinroute: TRANSPORT_PARTNER_LINKS names the programs that did
//   (e.g. "12go" or "12go,omio"), and only those become Travelpayouts partner links.
// - the options Claude works out from what it knows (operator, usual times, journey length, usual price), saved with
//   save_transport_options and shown in the planner next to the search, each with the booking search for its day.
// - the one the traveller picks (choose_transport), saved like a chosen flight, so the calendar gets its times.
import { z } from 'zod';
import { schedule, legs, legRoute } from './trips.mjs';
import { airport } from './geo.mjs';
import * as tp from './providers/travelpayouts.mjs';

const realDate = (s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD').refine(realDate, 'not a calendar date');
const TIME = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'a time as HH:MM');
const text = (t) => ({ type: 'text', text: t });
const fail = (msg) => ({ isError: true, content: [text(msg)] });

// Where 12Go sells ferries, buses, minivans and trains, and where Omio sells trains and buses
const ASIA = new Set(['Thailand', 'Vietnam', 'Viet Nam', 'Cambodia', 'Laos', "Lao People's Democratic Republic", 'Malaysia', 'Singapore', 'Indonesia', 'Philippines',
  'Myanmar', 'India', 'Sri Lanka', 'Nepal', 'Japan', 'South Korea', 'Korea', 'Republic of Korea', 'Korea, Republic of', 'China', 'Taiwan', 'Hong Kong', 'Macau', 'Macao', 'Bangladesh']);
const EUROPE = new Set(['Germany', 'France', 'Italy', 'Spain', 'Portugal', 'Netherlands', 'Belgium', 'Luxembourg', 'Austria', 'Switzerland', 'Czechia', 'Czech Republic',
  'Poland', 'Hungary', 'Slovakia', 'Slovenia', 'Croatia', 'Denmark', 'Sweden', 'Norway', 'Finland', 'United Kingdom', 'Ireland', 'Greece', 'Romania', 'Bulgaria']);

export const MODES = ['ferry', 'speedboat', 'bus', 'minivan', 'train', 'taxi', 'combined', 'drive'];
const MODE_WORD = { ferry: 'Ferry', speedboat: 'Speedboat', bus: 'Bus', minivan: 'Minivan', train: 'Train', taxi: 'Private transfer', combined: 'Bus and ferry', drive: 'Drive' };
export const modeWord = (m) => MODE_WORD[m] || 'Transfer';

// Which country a stop is in, as the airport data names it
export function countryOf(stop) {
  if (!stop) return null;
  if (stop.placeId) return 'Thailand';
  return (stop.iata && airport(stop.iata)?.country) || stop.region || null;
}

// "Koh Phi Phi (Tonsai)" → "koh-phi-phi"
export const slug = (place) => String(place || '').replace(/\(.*?\)/g, ' ').split(',')[0].normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// Rome2Rio names places with capitals and dashes: Chiang-Mai, Koh-Lanta
const r2r = (place) => slug(place).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-');

export const twelveGoSearch = ({ from, to, date, adults = 1 }) => `https://12go.asia/en/travel/${slug(from)}/${slug(to)}?date=${date}&people=${Math.max(1, Math.min(9, adults))}`;
export const omioSearch = ({ from, to }) => `https://www.omio.com/trains/${slug(from)}/${slug(to)}`;
export const rome2rioSearch = ({ from, to }) => `https://www.rome2rio.com/map/${r2r(from)}/${r2r(to)}`;

// The booking searches for one leg, best first. Rome2Rio is a guide, not a shop, so it is always last.
export function searchSites({ from, to, date, adults, country }) {
  const out = [];
  if (!country || ASIA.has(country)) out.push({ site: '12Go', what: 'Ferries, buses, minivans and trains, with times and prices for the day', url: twelveGoSearch({ from, to, date, adults }), sells: true });
  if (country && EUROPE.has(country)) out.push({ site: 'Omio', what: 'Trains and buses, with times and prices', url: omioSearch({ from, to }), sells: true });
  out.push({ site: 'Rome2Rio', what: 'Every way to get there, with operators and journey times', url: rome2rioSearch({ from, to }), sells: false });
  return out;
}

// The booking sites whose Travelpayouts program accepted Pinroute, from TRANSPORT_PARTNER_LINKS ("12go,omio");
// it needs TRAVELPAYOUTS_MARKER too. Every other site keeps a plain link and no Links API call is made for it.
export function trackedSites(env = process.env) {
  if (!tp.linksOn(env)) return new Set();
  return new Set(String(env.TRANSPORT_PARTNER_LINKS || '').toLowerCase().split(/[\s,;]+/).filter(Boolean));
}
export const linksOn = (env = process.env) => trackedSites(env).size > 0;

// Partner links for the tracked sites; a link Travelpayouts can't convert stays a plain link. Each site says
// whether its link is a partner link, so the planner names only those.
export async function withPartnerLinks(sites, ctx = {}) {
  const env = ctx.env || process.env;
  const on = trackedSites(env);
  const todo = sites.filter((x) => x.sells && on.has(x.site.toLowerCase()));
  const made = todo.length ? await tp.partnerLinks(todo.map((x) => x.url), { ...ctx, env, fallback: 'plain' }) : [];
  return sites.map((x) => {
    const i = todo.indexOf(x);
    return { ...x, url: i < 0 ? x.url : made[i], partner: i >= 0 && made[i] !== x.url };
  });
}

// The ground legs of a trip, each with the country it is in and the options saved for it
export function groundLeg(trip, key) {
  const l = legs(trip).find((x) => x.key === key);
  if (!l) return null;
  const rows = schedule(trip);
  return { ...l, country: countryOf(rows[l.after]) || countryOf(rows[l.after + 1]) };
}

// The saved options of a leg, on its current date only: options for an earlier date of the same hop are not shown
export const ridesFor = (trip, key) => trip.rides?.[key]?.options || null;

// One line for the chosen ride, with its times where calendar.mjs finds them: "Ferry, Opal Marine, 08:00–10:30, Ao Nang → Koh Lanta"
export function rideLine(o, l) {
  const times = o.depart ? `${o.depart}${o.arrive ? `–${o.arrive}` : ''}` : null;
  return [o.operator ? `${modeWord(o.mode)}, ${o.operator}` : modeWord(o.mode), times, `${o.from_point || l.fromName} → ${o.to_point || l.toName}`].filter(Boolean).join(', ');
}

const dur = (m) => (m == null ? null : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
const money = (n, c) => `${c} ${Number.isInteger(n) ? n : n.toFixed(2)}`;
export function optionText(o, i) {
  return `${i + 1}. ${[o.operator ? `${modeWord(o.mode)} with ${o.operator}` : modeWord(o.mode),
    o.depart ? `${o.depart}${o.arrive ? `–${o.arrive}` : ''}` : null, dur(o.minutes),
    o.price != null ? `${money(o.price, o.currency)}${o.per_person ? ' each' : ''}` : null,
    o.from_point ? `from ${o.from_point}` : null].filter(Boolean).join(', ')}`;
}

export function registerTransportTools(server, { env, owner, store, mine, noTrip, viewResult }) {
  const partner = () => linksOn(env);
  const named = [...trackedSites(env)].map((k) => ({ '12go': '12Go', omio: 'Omio' })[k] || k);
  const commission = named.length ? ` ${named.join(' and ')} links carry Pinroute's Travelpayouts partner ID, so Pinroute may earn a commission on a booking; the price is the same either way.` : '';
  const legOf = (t, leg_key) => {
    const l = groundLeg(t, leg_key);
    if (!l) return { error: fail(`Trip ${t.id} has no leg ${leg_key}. Its legs are: ${legs(t).map((x) => x.key).join(', ')}.`) };
    if (l.mode === 'flight') return { error: fail(`${leg_key} is a flight; search_flights finds fares for it.`) };
    return { l };
  };

  server.registerTool('find_transport', {
    title: 'Find ferries, buses and trains',
    description: `Finds where to book a ferry, bus, minivan or train between two places on a day: a 12Go search in Asia, an Omio search in Europe and the Rome2Rio route, each for the leg's own route and date, with the ride options saved for the leg. Give trip_id and leg_key for a ground leg of a saved trip, or from, to and date. Pinroute has no timetable feed: times and prices are on the booking sites, and options worked out for a leg are saved with save_transport_options.${commission}`,
    inputSchema: {
      trip_id: z.string().max(40).optional(),
      leg_key: z.string().max(80).optional(),
      from: z.string().min(1).max(80).optional().describe('Town, island or pier, e.g. "Krabi"'),
      to: z.string().min(1).max(80).optional(),
      date: DATE.optional(),
      country: z.string().max(60).optional().describe('Country of the two places, e.g. "Thailand"'),
      adults: z.number().int().min(1).max(9).optional(),
    },
    annotations: { title: 'Find ferries, buses and trains', readOnlyHint: true, openWorldHint: true },
  }, mine(async ({ trip_id, leg_key, from, to, date, country, adults }) => {
    let leg, rides = null;
    if (trip_id) {
      const t = store.getTrip(owner, trip_id);
      if (!t) return noTrip(trip_id);
      const ground = legs(t).filter((x) => x.mode !== 'flight');
      if (!leg_key) return fail(ground.length ? `Give leg_key, one of: ${ground.map((x) => x.key).join(', ')}.` : `"${t.name}" has no ferry or road legs.`);
      const { l, error } = legOf(t, leg_key);
      if (error) return error;
      leg = { key: l.key, from: l.fromName, to: l.toName, date: l.date, mode: l.mode, km: l.km ?? null, country: l.country, adults: adults || t.adults };
      rides = ridesFor(t, l.key);
    } else {
      if (!from || !to || !date) return fail('Give trip_id and leg_key, or from, to and date.');
      leg = { key: null, from, to, date, mode: null, km: null, country: country || null, adults: adults || 1 };
    }
    const sites = await withPartnerLinks(searchSites(leg), { env });
    const lines = [`${leg.from} → ${leg.to}, ${leg.date}${leg.km ? `, about ${leg.km} km` : ''}${leg.country ? `, ${leg.country}` : ''}.`,
      ...sites.map((x) => `${x.site} (${x.what.charAt(0).toLowerCase()}${x.what.slice(1)}): ${x.url}`),
      rides?.length ? `Options saved for this leg:\n${rides.map(optionText).join('\n')}` : leg.key ? 'No ride options saved for this leg yet.' : null].filter(Boolean);
    return { content: [text(lines.join('\n'))], structuredContent: { leg, sites, options: rides || [], partner: partner() } };
  }));

  const optionIn = z.object({
    mode: z.enum(MODES),
    operator: z.string().max(60).optional().describe('e.g. "Opal Marine", "Lomprayah", "Green Bus"'),
    depart: TIME.optional().describe('Usual departure, local time'),
    arrive: TIME.optional().describe('Usual arrival, local time'),
    minutes: z.number().int().min(5).max(4320).optional().describe('Journey length'),
    price: z.number().nonnegative().max(1e5).optional(),
    currency: z.string().regex(/^[A-Za-z]{3}$/, 'a 3-letter currency code').optional(),
    per_person: z.boolean().optional().describe('True when the price is per person, false for the whole group or vehicle'),
    from_point: z.string().max(80).optional().describe('Pier, station or pick-up, e.g. "Nopparat Thara pier"'),
    to_point: z.string().max(80).optional(),
    note: z.string().max(160).optional().describe('e.g. "hotel pick-up included", "only Nov to Apr", "change at Krabi"'),
  });

  server.registerTool('save_transport_options', {
    title: 'Save ferry, bus or train options',
    description: 'Saves the ways to make one ferry or road leg of a trip, identified by leg_key from the trip\'s legs, so the planner shows them with a booking search for the leg\'s day: each with its kind (ferry, speedboat, bus, minivan, train, taxi, combined, drive), operator, usual departure and arrival times, journey length, usual price and where it leaves from. They replace the options saved for the leg before. Times and prices are shown as usual ones, to check on the booking site.',
    inputSchema: { trip_id: z.string().max(40), leg_key: z.string().max(80), options: z.array(optionIn).min(1).max(8) },
    annotations: { title: 'Save ferry, bus or train options', readOnlyHint: false, destructiveHint: false },
  }, mine(async ({ trip_id, leg_key, options }) => {
    const t = store.getTrip(owner, trip_id);
    if (!t) return noTrip(trip_id);
    const { l, error } = legOf(t, leg_key);
    if (error) return error;
    if (options.some((o) => o.price != null && !o.currency)) return fail('Give the currency with each price.');
    const [book] = await withPartnerLinks(searchSites({ from: l.fromName, to: l.toName, date: l.date, adults: t.adults, country: l.country }).slice(0, 1), { env });
    const clean = options.map((o) => ({ ...o, currency: o.currency ? o.currency.toUpperCase() : null, book: { site: book.site, url: book.url, partner: book.partner } }));
    // Options for this hop on another date give way to these
    const rides = Object.fromEntries(Object.entries(t.rides || {}).filter(([k]) => legRoute(k) !== legRoute(leg_key)));
    rides[leg_key] = { options: clean, at: new Date().toISOString() };
    return viewResult(store.putTrip(owner, { ...t, rides }), `Saved ${clean.length} way${clean.length === 1 ? '' : 's'} to get from ${l.fromName} to ${l.toName} on ${l.date}:\n${clean.map(optionText).join('\n')}`);
  }));

  server.registerTool('choose_transport', {
    title: 'Choose a ferry, bus or train for a leg',
    description: 'Saves the ride the traveller picked for one ferry or road leg of a trip: option is its position in the options saved for the leg, counted from 0. Booking itself happens on the booking site; mark_leg marks it booked. clear_flight removes the choice again.',
    inputSchema: { trip_id: z.string().max(40), leg_key: z.string().max(80), option: z.number().int().min(0).max(7) },
    annotations: { title: 'Choose a ferry, bus or train for a leg', readOnlyHint: false, destructiveHint: false },
  }, mine(async ({ trip_id, leg_key, option }) => {
    const t = store.getTrip(owner, trip_id);
    if (!t) return noTrip(trip_id);
    const { l, error } = legOf(t, leg_key);
    if (error) return error;
    const list = ridesFor(t, leg_key) || [];
    const o = list[option];
    if (!o) return fail(list.length ? `Leg ${leg_key} has ${list.length} options, numbered 0 to ${list.length - 1}.` : `No options are saved for ${leg_key} yet: save_transport_options saves them.`);
    const total = o.price == null ? null : o.per_person === false ? o.price : o.price * (t.adults || 1);
    const choices = Object.fromEntries(Object.entries(t.choices || {}).filter(([k]) => legRoute(k) !== legRoute(leg_key)));
    const line = rideLine(o, l);
    choices[leg_key] = { summary: line, price: total, currency: o.currency || null, link: o.book?.url || null, source: o.book?.site || null, ride: o.mode, at: new Date().toISOString() };
    return viewResult(store.putTrip(owner, { ...t, choices }), `Saved for ${l.fromName} → ${l.toName} on ${l.date}: ${line}${total != null ? ` (${money(total, o.currency)} for ${t.adults})` : ''}.`);
  }));
}
