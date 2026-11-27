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

export function searchUrl({ place, checkin, checkout, adults = 2, rooms = 1 }) {
  const q = new URLSearchParams({
    ss: place, checkin, checkout, group_adults: String(Math.max(1, Math.min(30, adults))), no_rooms: String(Math.max(1, Math.min(30, rooms))), group_children: '0',
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
    const link = partnerUrl(searchUrl({ place: placeQuery(s), checkin: s.arrive, checkout: s.depart, adults: trip.adults, rooms: trip.rooms || 1 }), env);
    return { key, stop: s.i, place: s.place, checkin: s.arrive, checkout: s.depart, nights: s.nights, link, chosen,
      stale: old ? { ...old[1], checkin: old[0].split('|')[2], checkout: old[0].split('|')[3] } : null };
  });
}

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
    },
    annotations: { title: 'Hotel link on Booking.com', readOnlyHint: true, openWorldHint: true },
  }, mine(async ({ trip_id, stop, place, checkin, checkout, adults, rooms }) => {
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
      return { content: [text(lines.join('\n'))], structuredContent: { trip_id, stays: list.map(({ key, stop: i, place: p, checkin: a, checkout: b, nights, link, chosen }) => ({ key, stop: i, place: p, checkin: a, checkout: b, nights, url: link, chosen })), partner } };
    }
    if (!place || !checkin || !checkout) return fail('Give trip_id, or place with checkin and checkout.');
    if (checkout <= checkin) return fail('The check-out date must be after the check-in date.');
    const url = partnerUrl(searchUrl({ place, checkin, checkout, adults: adults || 2, rooms: rooms || 1 }), env);
    return { content: [text(url)], structuredContent: { url, partner } };
  }));

  server.registerTool('choose_stay', {
    title: 'Choose a hotel for a stop',
    description: 'Saves the hotel or other place to stay the traveller picked for one stop of a trip, identified by stay_key from the trip\'s stays, with its name, price and booking link. The offer can come from any hotel search. Booking itself happens on Booking.com or the hotel\'s own site; set booked when the traveller says it is booked.',
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
