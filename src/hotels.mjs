// Hotels per stop through Booking.com. Pinroute has no hotel API: Booking.com keeps its Demand API for Managed
// Affiliate Partners with a contract, so each stop gets a Booking.com search for its place and dates, where the
// traveller compares and books. Claude can search hotels with whatever tools the traveller has connected (the
// Booking.com connector, for one) and saves the stay picked with choose_stay, the way flights work.
//
// Partner links, when set up on the server:
// - BOOKING_AID: a Booking.com affiliate ID, added as aid= (partners of the direct programme)
// - BOOKING_LINK_TEMPLATE: a tracking link from an affiliate network (CJ, CityAds, ...) with {url} where the
//   Booking.com address goes, e.g. https://www.anrdoezrs.net/click-<PID>-<AID>?url={url}
import { z } from 'zod';
import { schedule } from './trips.mjs';
import { airport } from './geo.mjs';

const realDate = (s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD').refine(realDate, 'not a calendar date');
const text = (t) => ({ type: 'text', text: t });
const fail = (msg) => ({ isError: true, content: [text(msg)] });
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

const template = (env) => {
  const t = String(env.BOOKING_LINK_TEMPLATE || '').trim();
  return /^https:\/\/[^\s]+$/.test(t) && t.includes('{url}') ? t : null;
};
export const linksOn = (env = process.env) => !!(template(env) || /^\d+$/.test(String(env.BOOKING_AID || '').trim()));

// Where a stop is, in words Booking.com's search understands: "Khao Sok, Thailand", "Hoi An, Vietnam"
export function placeQuery(stop) {
  const country = stop.placeId ? 'Thailand' : (stop.iata && airport(stop.iata)?.country) || stop.region || '';
  const place = String(stop.place || '').trim();
  return country && !place.toLowerCase().includes(country.toLowerCase()) ? `${place}, ${country}` : place;
}

// What the traveller wants from a place to stay, set once per trip with set_hotel_prefs or the chips in the planner.
// Each choice narrows the stop's Booking.com search where Booking.com has a filter for it (nflt, its filter list, and
// order, its sort), and every choice goes into what Claude is asked to look for. Location and quiet have no Booking.com
// filter that works everywhere (a "near the centre" filter empties an island search), so they shape Claude's search only.
export const PRICE_LEVELS = {
  budget: { label: 'Budget', ask: 'a low price, good value for money', nflt: ['pri=1', 'pri=2'], order: 'price' },
  mid: { label: 'Mid-range', ask: 'a mid-range price, 3 to 4 stars', nflt: ['class=3', 'class=4'] },
  luxury: { label: 'Luxury', ask: 'a luxury place, 4 or 5 stars', nflt: ['class=4', 'class=5'] },
};
export const HOTEL_WANTS = {
  clean: { label: 'Very clean', ask: 'spotless rooms, with high cleanliness scores in reviews', nflt: ['review_score=80'] },
  location: { label: 'Great location', ask: 'a central spot, close to the sights, beach or restaurants on foot' },
  breakfast: { label: 'Breakfast', ask: 'breakfast included', nflt: ['mealplan=1'] },
  pool: { label: 'Pool', ask: 'a swimming pool', nflt: ['hotelfacility=433'] },
  family: { label: 'Family-friendly', ask: 'family rooms and good for children', nflt: ['hotelfacility=28'] },
  quiet: { label: 'Quiet', ask: 'a quiet place away from nightlife and road noise' },
  cancel: { label: 'Free cancellation', ask: 'free cancellation', nflt: ['fc=2'] },
};
export const cleanPrefs = (p) => {
  const price = p?.price && PRICE_LEVELS[p.price] ? p.price : null;
  const wants = Object.keys(HOTEL_WANTS).filter((k) => (p?.wants || []).includes(k));
  return price || wants.length ? { price, wants } : null;
};
// "a mid-range price, 3 to 4 stars; breakfast included; a swimming pool", or '' with nothing set
export function prefsAsk(p) {
  const c = cleanPrefs(p);
  if (!c) return '';
  return [c.price && PRICE_LEVELS[c.price].ask, ...c.wants.map((k) => HOTEL_WANTS[k].ask)].filter(Boolean).join('; ');
}
// The Booking.com filters the choices map to: { nflt: 'class=3;class=4;mealplan=1', order: 'price' }
export function bookingFilters(p) {
  const c = cleanPrefs(p);
  if (!c) return {};
  const parts = [...(c.price ? PRICE_LEVELS[c.price].nflt : []), ...c.wants.flatMap((k) => HOTEL_WANTS[k].nflt || [])];
  return { ...(parts.length && { nflt: [...new Set(parts)].join(';') }), ...(c.price && PRICE_LEVELS[c.price].order && { order: PRICE_LEVELS[c.price].order }) };
}

export function searchUrl({ place, checkin, checkout, adults = 2, rooms = 1, prefs = null }) {
  const q = new URLSearchParams({
    ss: place, checkin, checkout, group_adults: String(Math.max(1, Math.min(30, adults))), no_rooms: String(Math.max(1, Math.min(30, rooms))), group_children: '0',
    ...bookingFilters(prefs),
  });
  return `https://www.booking.com/searchresults.html?${q}`;
}

export function partnerUrl(url, env = process.env) {
  const t = template(env);
  if (t) return t.replace('{url}', encodeURIComponent(url));
  const aid = String(env.BOOKING_AID || '').trim();
  return /^\d+$/.test(aid) ? `${url}&aid=${aid}&label=pinroute` : url;
}

export const stayKey = (s) => `stay|${s.place}|${s.arrive}|${s.depart}`;
const stayPlace = (key) => String(key).split('|')[1];

// The nights to book: every stop with at least one night, with its dates, a Booking.com link and the stay saved for it.
// A stay saved before the dates moved shows as "stale" until it is chosen again or cleared.
export function stays(trip, env = process.env) {
  const saved = trip.stays || {};
  const rows = schedule(trip).filter((s) => s.nights > 0);
  const current = new Set(rows.map(stayKey));
  return rows.map((s) => {
    const key = stayKey(s);
    const chosen = saved[key] || null;
    const old = chosen ? null : Object.entries(saved).find(([k]) => !current.has(k) && stayPlace(k) === s.place);
    const link = partnerUrl(searchUrl({ place: placeQuery(s), checkin: s.arrive, checkout: s.depart, adults: trip.adults, rooms: trip.rooms || 1, prefs: trip.hotelPrefs }), env);
    return { key, stop: s.i, place: s.place, checkin: s.arrive, checkout: s.depart, nights: s.nights, link, chosen,
      stale: old ? { ...old[1], checkin: old[0].split('|')[2], checkout: old[0].split('|')[3] } : null };
  });
}

const PRICE = z.enum(Object.keys(PRICE_LEVELS));
const WANTS = z.array(z.enum(Object.keys(HOTEL_WANTS))).max(Object.keys(HOTEL_WANTS).length);
const wantsLine = (prefs) => (prefs ? `\nThe traveller wants: ${prefsAsk(prefs)}. The Booking.com link is already filtered for what Booking.com can filter; weigh the rest (and reviews) when suggesting where to stay.` : '');

export function registerHotelTools(server, { env, owner, store, mine, noTrip, viewResult }) {
  const commission = linksOn(env) ? ' The link carries Pinroute\'s Booking.com partner ID, so Pinroute may earn a commission on a booking; the price is the same either way.' : '';

  server.registerTool('hotel_link', {
    title: 'Hotel link on Booking.com',
    description: `Makes a link to a Booking.com search for hotels at a place and dates, where the traveller can compare and book. Give trip_id to get one link per stop of a saved trip, with each stop's check-in and check-out dates; add stop for one stop only. Or give place, checkin and checkout.${commission}`,
    inputSchema: {
      trip_id: z.string().max(40).optional(),
      stop: z.number().int().min(0).max(19).optional().describe('Position of the stop, 0 for the first'),
      place: z.string().min(1).max(120).optional().describe('Town or area and country, e.g. "Hoi An, Vietnam"'),
      checkin: DATE.optional(),
      checkout: DATE.optional(),
      adults: z.number().int().min(1).max(30).optional(),
      rooms: z.number().int().min(1).max(30).optional(),
      price: PRICE.optional().describe('Price level for a search by place; a trip uses its saved hotel preferences'),
      wants: WANTS.optional().describe('What matters for a search by place; a trip uses its saved hotel preferences'),
    },
    annotations: { title: 'Hotel link on Booking.com', readOnlyHint: true, openWorldHint: true },
  }, mine(async ({ trip_id, stop, place, checkin, checkout, adults, rooms, price, wants }) => {
    const partner = linksOn(env);
    if (trip_id) {
      const t = store.getTrip(owner, trip_id);
      if (!t) return noTrip(trip_id);
      let list = stays({ ...t, ...(adults && { adults }), ...(rooms && { rooms }) }, env);
      if (stop != null) {
        if (!t.stops[stop]) return fail(`Trip ${trip_id} has ${t.stops.length} stops, numbered 0 to ${t.stops.length - 1}.`);
        list = list.filter((s) => s.stop === stop);
        if (!list.length) return fail(`${t.stops[stop].place} has no nights in this trip, so there is no hotel to book there.`);
      }
      if (!list.length) return fail(`"${t.name}" has no nights at any stop yet.`);
      const lines = list.map((s) => `${s.place}, ${s.checkin} to ${s.checkout} (${s.nights} night${s.nights === 1 ? '' : 's'})${s.chosen ? `, saved: ${s.chosen.name}` : ''}: ${s.link}`);
      const prefs = cleanPrefs(t.hotelPrefs);
      return { content: [text(lines.join('\n') + wantsLine(prefs))], structuredContent: { trip_id, stays: list.map(({ key, stop: i, place: p, checkin: a, checkout: b, nights, link, chosen }) => ({ key, stop: i, place: p, checkin: a, checkout: b, nights, url: link, chosen })), prefs, partner } };
    }
    if (!place || !checkin || !checkout) return fail('Give trip_id, or place with checkin and checkout.');
    if (checkout <= checkin) return fail('The check-out date must be after the check-in date.');
    const prefs = cleanPrefs({ price, wants });
    const url = partnerUrl(searchUrl({ place, checkin, checkout, adults: adults || 2, rooms: rooms || 1, prefs }), env);
    return { content: [text(url + wantsLine(prefs))], structuredContent: { url, prefs, partner } };
  }));

  server.registerTool('set_hotel_prefs', {
    title: 'Set what matters in a hotel',
    description: `Saves what the traveller wants from the places they stay on a trip, for every stop: a price level (${Object.entries(PRICE_LEVELS).map(([k, v]) => `${k}: ${v.label}`).join(', ')}) and what matters (${Object.entries(HOTEL_WANTS).map(([k, v]) => `${k}: ${v.label}`).join(', ')}). `
      + 'The stops\' Booking.com searches from hotel_link are filtered by them where Booking.com can, and hotel searches should look for all of them. The planner shows them as chips the traveller taps. Both fields replace what was saved; give price null and wants [] to clear.',
    inputSchema: {
      trip_id: z.string().max(40),
      price: PRICE.nullable().optional(),
      wants: WANTS.optional(),
    },
    annotations: { title: 'Set what matters in a hotel', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, mine(async ({ trip_id, price, wants }) => {
    const t = store.getTrip(owner, trip_id);
    if (!t) return noTrip(trip_id);
    const was = t.hotelPrefs || {};
    const prefs = cleanPrefs({ price: price === undefined ? was.price : price, wants: wants === undefined ? was.wants : wants });
    const { hotelPrefs: _, ...rest } = t;
    const saved = store.putTrip(owner, prefs ? { ...rest, hotelPrefs: prefs } : rest);
    return viewResult(saved, prefs ? `Hotels for "${t.name}" will look for ${prefsAsk(prefs)}. The Booking.com searches are filtered to match.` : `Cleared the hotel preferences for "${t.name}".`);
  }));

  server.registerTool('choose_stay', {
    title: 'Choose a hotel for a stop',
    description: 'Saves the hotel or other place to stay the traveller picked for one stop of a trip, identified by stay_key from the trip\'s stays, with its name, price and booking link, such as a place the traveller found through the stop\'s Booking.com search from hotel_link. Booking itself happens on Booking.com or the hotel\'s own site; set booked when the traveller says it is booked.',
    inputSchema: {
      trip_id: z.string().max(40),
      stay_key: z.string().max(160),
      name: z.string().min(1).max(120),
      price: z.number().nonnegative().max(1e6).optional().describe('Total for all nights and rooms'),
      currency: z.string().regex(/^[A-Za-z]{3}$/, 'a 3-letter currency code').optional(),
      link: z.string().url().max(2000).optional(),
      source: z.string().max(40).optional().describe('Where the offer was found, e.g. Booking.com'),
      booked: z.boolean().optional(),
      note: z.string().max(120).optional().describe('e.g. a booking reference, free cancellation until, breakfast included'),
    },
    annotations: { title: 'Choose a hotel for a stop', readOnlyHint: false, destructiveHint: false },
  }, mine(async ({ trip_id, stay_key, name, price, currency, link, source, booked, note }) => {
    const t = store.getTrip(owner, trip_id);
    if (!t) return noTrip(trip_id);
    const list = stays(t, env);
    const s = list.find((x) => x.key === stay_key);
    if (!s) return fail(`Trip ${trip_id} has no stay ${stay_key}. Its stays are: ${list.map((x) => x.key).join(', ') || 'none'}.`);
    if (price != null && !currency) return fail('Give the currency with the price.');
    // A stay saved for the same place on other dates gives way to this one
    const kept = Object.fromEntries(Object.entries(t.stays || {}).filter(([k]) => k === stay_key || stayPlace(k) !== s.place || list.some((x) => x.key === k)));
    kept[stay_key] = { name, price: price ?? null, currency: currency ? currency.toUpperCase() : null, link: link || null, source: source || null, booked: !!booked, note: note || null, at: new Date().toISOString() };
    const cost = price != null ? ` (${currency.toUpperCase()} ${price})` : '';
    return viewResult(store.putTrip(owner, { ...t, stays: kept }), `Saved for ${s.place}, ${s.checkin} to ${s.checkout}: ${name}${cost}${booked ? ', booked' : ''}.`);
  }));

  server.registerTool('clear_stay', {
    title: 'Remove a chosen hotel',
    description: 'Removes the hotel saved for one stop of a trip, so the stop shows as not chosen again. It does not cancel any booking.',
    inputSchema: { trip_id: z.string().max(40), stay_key: z.string().max(160) },
    annotations: { title: 'Remove a chosen hotel', readOnlyHint: false, destructiveHint: true },
  }, mine(async ({ trip_id, stay_key }) => {
    const t = store.getTrip(owner, trip_id);
    if (!t) return noTrip(trip_id);
    const have = t.stays || {};
    if (!have[stay_key]) return fail(`No hotel is saved for ${stay_key}.`);
    const { [stay_key]: _, ...rest } = have;
    return viewResult(store.putTrip(owner, { ...t, stays: rest }), `Removed the hotel saved for ${stayPlace(stay_key)}.`);
  }));
}
