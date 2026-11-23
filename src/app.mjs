// The MCP server: Pinroute's tools and the planner screen. Claude, on each traveller's own plan, does the thinking;
// this server keeps each person's trips and new-trip draft, ranks countries for the dates they are free, finds
// airports, searches airline fares, keeps the flight deals found and stores the local picks Claude found.
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { airport, findAirports, resolvePlace, km } from './geo.mjs';
import * as store from './store.mjs';
import { schedule, legs, endDate, legRoute } from './trips.mjs';
import {
  REGIONS, INTERESTS, MONTHS, findDest, destById, rankDests, fitLabel, windowMonths, addDays, diffDays, monthOf,
  dealPP, dealRatio, dealLabel, dealsFor, budgetFit, bestMonthsText,
} from './discover.mjs';
import { tripMap } from './map.mjs';
import { flightProvider } from './providers/index.mjs';

export const VERSION = '0.4.0';
export const PLANNER_URI = 'ui://pinroute/planner';

const realDate = (s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD').refine(realDate, 'not a calendar date');
const IATA = z.string().regex(/^[A-Za-z]{3}$/, 'a 3-letter airport or city code');
const CURRENCY = z.string().regex(/^[A-Za-z]{3}$/, 'a 3-letter currency code');

const text = (t) => ({ type: 'text', text: t });
const fail = (msg) => ({ isError: true, content: [text(msg)] });
// The earliest date anyone on Earth can still be on: today in UTC minus one day
const earliest = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);

function plannerHtml() {
  try { return readFileSync(new URL('../dist/planner.html', import.meta.url), 'utf8'); }
  catch { return '<!doctype html><meta charset="utf-8"><p style="font:14px system-ui">The planner is not built yet: run <code>npm run build</code> on the server.</p>'; }
}

function summary(v) {
  const route = v.stops.map((s) => `${s.place} (${s.nights}n)`).join(' → ');
  return `${v.trip.name}: ${v.trip.start} to ${v.trip.end}, ${v.trip.adults} traveller${v.trip.adults === 1 ? '' : 's'}. ${route}. Trip id ${v.trip.id}.`;
}

const eur = (n) => `€${Math.round(n).toLocaleString('en-GB')}`;
const shortDate = (iso) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const cityOf = (a) => String(a?.city || a?.code || '').replace(/\s*\(.*\)\s*$/, '');      // "Hanoi (Soc Son)" → "Hanoi"
const hhmm = (iso) => String(iso || '').slice(11, 16);
const flightNos = (b) => b.flights.map((x) => x.number).filter((n) => !/^XX/.test(n)).join(', ');

function fareLine(f) {
  const b = f.bounds[0];
  const hm = (m) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  return `${f.currency} ${Math.round(f.total)} · ${f.airline} · ${b.departs?.slice(11, 16)} ${b.from} → ${b.arrives?.slice(11, 16)} ${b.to} · ${hm(b.minutes)} · ${b.stops ? `${b.stops} stop${b.stops > 1 ? 's' : ''}` : 'direct'}${b.bags ? ' · bag included' : ''}`;
}

export function buildServer({ owner = store.LOCAL, env = process.env } = {}) {
  const server = new McpServer({ name: 'pinroute', version: VERSION });
  const limits = {
    searchesPerDay: Number(env.SEARCH_LIMIT_PER_DAY) || 50,
    trips: Number(env.TRIP_LIMIT) || 200,
    picksPerPlace: 60,
  };
  if (owner && owner !== store.LOCAL && env.ADOPT_LOCAL_DATA === 'true') store.adoptLocal(owner);

  // Every tool except find_airports works on one person's data. With sign-in on, the HTTP layer already refuses
  // these calls without a valid token (401, so Claude can show its Connect card); this is the second lock.
  const provider = flightProvider(env);
  const mine = (fn) => async (args) => (owner ? fn(args) : fail('Sign in to Pinroute to use this.'));
  const noTrip = (id) => fail(`No trip with id ${id} in your Pinroute account. list_trips shows the trips you have.`);

  // Everything the planner needs for one trip, kept small: this also goes to the model. Each leg carries its state:
  // the flight chosen, whether it's booked (with a note), or a flight chosen before its date moved ("stale").
  function tripView(trip) {
    const rows = schedule(trip);
    const picks = Object.fromEntries(rows.map((s) => [s.place, store.getPicks(owner, s.place)]));
    const choices = trip.choices || {}, marks = trip.marks || {};
    const legList = legs(trip).map((l) => {
      const chosen = choices[l.key] || null;
      const old = chosen ? null : Object.entries(choices).find(([k]) => k !== l.key && legRoute(k) === legRoute(l.key));
      return { ...l, chosen, stale: old ? { ...old[1], date: old[0].split('|')[3] } : null, booked: !!marks[l.key]?.booked, note: marks[l.key]?.note || null };
    });
    const d = trip.country ? destById(trip.country) : null;
    return {
      screen: 'trip',
      trip: { id: trip.id, name: trip.name, start: trip.start, end: endDate(trip), adults: trip.adults, home: trip.home || null, choices, country: d ? d.name : null, ticket: trip.ticket || null },
      stops: rows.map((s, i) => ({ index: i, place: s.place, nights: s.nights, arrive: s.arrive, depart: s.depart, iata: s.iata, region: s.region, island: !!s.island })),
      legs: legList,
      picks,
      flights: { provider: provider.name, live: provider.name !== 'Demo data' },
    };
  }
  // The map goes in _meta: the planner draws it, the model never needs the coastline
  const viewResult = (trip, line) => {
    const v = tripView(trip);
    return { content: [text(line ?? summary(v))], structuredContent: v, _meta: { map: tripMap(trip.stops), mini: tripMap(trip.stops, { w: 320, h: 200, pad: 20 }) } };
  };

  // The start screen: the trips (the one under way first, then what's ahead, then the rest) and the new-trip draft
  function homeResult() {
    const today = new Date().toISOString().slice(0, 10);
    const trips = store.listTrips(owner).map((t) => {
      const end = endDate(t);
      const rows = schedule(t);
      const here = rows.find((x) => x.arrive <= today && today < x.depart);
      return { id: t.id, name: t.name, start: t.start, end, adults: t.adults, stops: t.stops.length, places: [...new Set(t.stops.map((x) => x.place))].slice(0, 5), country: t.country ? destById(t.country)?.name || null : null,
        state: t.start <= today && today < end ? 'now' : t.start > today ? 'ahead' : 'done', here: here ? here.place : null };
    });
    const order = { now: 0, ahead: 1, done: 2 };
    trips.sort((a, b) => order[a.state] - order[b.state] || (a.state === 'done' ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)));
    const dr = store.getDraft(owner);
    const draft = dr ? { way: dr.way, step: dr.step, from: dr.from, until: dr.until, minNights: dr.minNights, maxNights: dr.maxNights, adults: dr.adults,
      country: dr.country ? destById(dr.country)?.name || null : null, compare: (dr.compare || []).map((id) => destById(id)?.name).filter(Boolean),
      deals: Object.values(dr.deals || {}).reduce((n, l) => n + l.length, 0), updated: dr.updated } : null;
    const lines = [`Pinroute: ${trips.length} trip${trips.length === 1 ? '' : 's'}.`,
      ...trips.slice(0, 8).map((t) => `${t.name} (${t.start} to ${t.end}${t.state === 'now' ? `, under way${t.here ? `, today in ${t.here}` : ''}` : t.state === 'done' ? ', done' : ''}): ${t.id}`),
      draft ? `New-trip draft: free ${draft.from} to ${draft.until}, ${draft.minNights}–${draft.maxNights} nights${draft.country ? `, ${draft.country}` : draft.compare.length ? `, comparing ${draft.compare.join(', ')}` : ''}.` : 'No new-trip draft yet.'];
    return { content: [text(lines.join('\n'))], structuredContent: { screen: 'home', trips, draft } };
  }

  // ---- the planner screen
  registerAppTool(server, 'open_planner', {
    title: 'Open the Pinroute planner',
    description: 'Shows the interactive Pinroute planner. With trip_id it opens that saved trip: the route with dates, the flight or road and ferry leg between stops, flights chosen so far and saved local picks. Without trip_id it opens the start screen: the traveller\'s trips, the one under way first, and the two ways to plan a new trip.',
    inputSchema: { trip_id: z.string().max(40).optional().describe('Trip id from create_trip or list_trips') },
    annotations: { title: 'Open the Pinroute planner', readOnlyHint: true },
    _meta: { ui: { resourceUri: PLANNER_URI } },
  }, mine(async ({ trip_id }) => {
    if (!trip_id) return homeResult();
    const trip = store.getTrip(owner, trip_id);
    return trip ? viewResult(trip) : noTrip(trip_id);
  }));

  registerAppResource(server, 'Pinroute planner', PLANNER_URI, { description: 'Interactive trip planner: route, flights and local picks' }, async () => ({
    contents: [{ uri: PLANNER_URI, mimeType: RESOURCE_MIME_TYPE, text: plannerHtml() }],
  }));

  // ---- trips
  const stopSchema = z.object({
    place: z.string().min(1).max(80).describe('Place name as the traveller says it, e.g. "Koh Lanta" or "Hoi An"'),
    nights: z.number().int().min(0).max(60),
    airport: IATA.optional().describe('Nearest airport with scheduled flights, for places outside Pinroute\'s Thailand list'),
    lat: z.number().min(-90).max(90).optional().describe('The place\'s own latitude, for places outside Pinroute\'s Thailand list'),
    lon: z.number().min(-180).max(180).optional(),
    island: z.boolean().optional().describe('True for an island, so the trip there is shown as a ferry'),
  });
  const resolveStops = (stops) => stops.map((s) => ({ ...resolvePlace(s.place, s.airport, s), nights: s.nights }));

  server.registerTool('create_trip', {
    title: 'Create a trip',
    description: 'Saves a new multi-stop trip to the traveller\'s Pinroute account. Stops are in travel order with the nights spent at each; a last stop with 0 nights is where the trip ends. Places in Thailand are recognised by name; elsewhere, give each place\'s coordinates and nearest airport code. Returns the trip with its dates and legs.',
    inputSchema: {
      name: z.string().min(1).max(80),
      start: DATE.describe('Date of the first night'),
      adults: z.number().int().min(1).max(9),
      home_airport: IATA.optional().describe('Where the traveller flies from and back to'),
      stops: z.array(stopSchema).min(1).max(20),
    },
    annotations: { title: 'Create a trip', readOnlyHint: false, destructiveHint: false },
  }, mine(async ({ name, start, adults, home_airport, stops }) => {
    if (store.countTrips(owner) >= limits.trips) return fail(`Your Pinroute account already has ${limits.trips} trips, the most it keeps. Delete one with delete_trip first.`);
    const resolved = resolveStops(stops);
    const trip = store.putTrip(owner, { id: store.newId('trp'), name, start, adults, home: home_airport?.toUpperCase() || null, stops: resolved, choices: {}, created: new Date().toISOString() });
    const missing = resolved.filter((s) => !s.iata).map((s) => s.place);
    const r = viewResult(trip);
    if (missing.length) r.content[0].text += ` No airport found for: ${missing.join(', ')}; give "airport" for those stops to get flight legs.`;
    return r;
  }));

  server.registerTool('update_trip', {
    title: 'Change a trip',
    description: 'Changes a saved trip. Fields left out stay as they are; "stops", when given, replaces the whole route. Flights chosen for legs that no longer exist stay saved but are not shown.',
    inputSchema: {
      trip_id: z.string().max(40),
      name: z.string().min(1).max(80).optional(),
      start: DATE.optional(),
      adults: z.number().int().min(1).max(9).optional(),
      home_airport: IATA.optional(),
      stops: z.array(stopSchema).min(1).max(20).optional(),
    },
    annotations: { title: 'Change a trip', readOnlyHint: false, destructiveHint: true },
  }, mine(async ({ trip_id, name, start, adults, home_airport, stops }) => {
    const t = store.getTrip(owner, trip_id);
    if (!t) return noTrip(trip_id);
    const next = { ...t, ...(name && { name }), ...(start && { start }), ...(adults && { adults }), ...(home_airport && { home: home_airport.toUpperCase() }) };
    if (stops) next.stops = resolveStops(stops);
    return viewResult(store.putTrip(owner, next));
  }));

  server.registerTool('set_nights', {
    title: 'Change nights at a stop',
    description: 'Changes how many nights the traveller spends at one stop of a saved trip. The stop is counted from 0 in travel order; the dates of every later stop move with it.',
    inputSchema: { trip_id: z.string().max(40), stop: z.number().int().min(0).max(19).describe('Position of the stop, 0 for the first'), nights: z.number().int().min(0).max(60) },
    annotations: { title: 'Change nights at a stop', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, mine(async ({ trip_id, stop, nights }) => {
    const t = store.getTrip(owner, trip_id);
    if (!t) return noTrip(trip_id);
    if (!t.stops[stop]) return fail(`Trip ${trip_id} has ${t.stops.length} stops, numbered 0 to ${t.stops.length - 1}.`);
    const stops = t.stops.map((s, i) => (i === stop ? { ...s, nights } : s));
    return viewResult(store.putTrip(owner, { ...t, stops }), `${t.stops[stop].place}: ${nights} night${nights === 1 ? '' : 's'}. ${summary(tripView({ ...t, stops }))}`);
  }));

  server.registerTool('delete_trip', {
    title: 'Delete a trip',
    description: 'Deletes one saved trip, with the flights chosen for it, from the traveller\'s Pinroute account. This cannot be undone.',
    inputSchema: { trip_id: z.string().max(40) },
    annotations: { title: 'Delete a trip', readOnlyHint: false, destructiveHint: true },
  }, mine(async ({ trip_id }) => {
    const t = store.getTrip(owner, trip_id);
    if (!t) return noTrip(trip_id);
    store.deleteTrip(owner, trip_id);
    return { content: [text(`Deleted the trip "${t.name}" (${trip_id}).`)], structuredContent: { deleted: trip_id } };
  }));

  server.registerTool('list_trips', {
    title: 'List trips',
    description: 'Lists the trips saved in the traveller\'s Pinroute account, most recently changed first.',
    inputSchema: {},
    annotations: { title: 'List trips', readOnlyHint: true },
  }, mine(async () => {
    const trips = store.listTrips(owner).map((t) => ({ id: t.id, name: t.name, start: t.start, end: endDate(t), stops: t.stops.length }));
    return { content: [text(trips.length ? trips.map((t) => `${t.name} (${t.start} to ${t.end}, ${t.stops} stops): ${t.id}`).join('\n') : 'No trips saved yet.')], structuredContent: { trips } };
  }));

  server.registerTool('choose_flight', {
    title: 'Choose a flight for a leg',
    description: 'Saves the flight the traveller picked for one leg of a trip, identified by leg_key from the trip\'s legs, with its summary, price and booking link. The offer can come from any flight search. Booking itself happens on the airline\'s or booking site.',
    inputSchema: {
      trip_id: z.string().max(40),
      leg_key: z.string().max(80),
      summary: z.string().min(1).max(200).describe('One line: airline, flight numbers, times'),
      price: z.number().nonnegative().max(1e6).describe('Total for all travellers'),
      currency: z.string().regex(/^[A-Za-z]{3}$/, 'a 3-letter currency code'),
      link: z.string().url().max(2000).optional(),
      source: z.string().max(40).optional().describe('Where the offer was found, e.g. the airline or booking site'),
    },
    annotations: { title: 'Choose a flight for a leg', readOnlyHint: false, destructiveHint: false },
  }, mine(async ({ trip_id, leg_key, summary: line, price, currency, link, source }) => {
    const t = store.getTrip(owner, trip_id);
    if (!t) return noTrip(trip_id);
    const keys = legs(t).map((l) => l.key);
    if (!keys.includes(leg_key)) return fail(`Trip ${trip_id} has no leg ${leg_key}. Its legs are: ${keys.join(', ')}.`);
    const cur = currency.toUpperCase();
    // A choice for the same hop on an earlier date gives way to this one
    const choices = Object.fromEntries(Object.entries(t.choices || {}).filter(([k]) => legRoute(k) !== legRoute(leg_key)));
    choices[leg_key] = { summary: line, price, currency: cur, link: link || null, source: source || null, at: new Date().toISOString() };
    return viewResult(store.putTrip(owner, { ...t, choices }), `Saved for ${leg_key}: ${line} (${cur} ${price}).`);
  }));

  server.registerTool('clear_flight', {
    title: 'Remove a chosen flight',
    description: 'Removes the flight saved for one leg of a trip, so the leg shows as not chosen again. It does not cancel any booking.',
    inputSchema: { trip_id: z.string().max(40), leg_key: z.string().max(80) },
    annotations: { title: 'Remove a chosen flight', readOnlyHint: false, destructiveHint: true },
  }, mine(async ({ trip_id, leg_key }) => {
    const t = store.getTrip(owner, trip_id);
    if (!t) return noTrip(trip_id);
    const choices = Object.fromEntries(Object.entries(t.choices || {}).filter(([k]) => legRoute(k) !== legRoute(leg_key)));
    if (Object.keys(choices).length === Object.keys(t.choices || {}).length) return fail(`No flight is saved for ${leg_key}.`);
    return viewResult(store.putTrip(owner, { ...t, choices }), `Removed the flight saved for ${leg_key}.`);
  }));

  server.registerTool('mark_leg', {
    title: 'Mark a leg booked',
    description: 'Marks one leg of a trip (a flight, ferry or drive) as booked or not booked yet, with an optional short note such as a departure time or booking reference.',
    inputSchema: { trip_id: z.string().max(40), leg_key: z.string().max(80), booked: z.boolean(), note: z.string().max(120).optional() },
    annotations: { title: 'Mark a leg booked', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, mine(async ({ trip_id, leg_key, booked, note }) => {
    const t = store.getTrip(owner, trip_id);
    if (!t) return noTrip(trip_id);
    const keys = legs(t).map((l) => l.key);
    if (!keys.includes(leg_key)) return fail(`Trip ${trip_id} has no leg ${leg_key}. Its legs are: ${keys.join(', ')}.`);
    const marks = { ...(t.marks || {}), [leg_key]: { booked, note: note ?? t.marks?.[leg_key]?.note ?? null, at: new Date().toISOString() } };
    return viewResult(store.putTrip(owner, { ...t, marks }), `${leg_key} is ${booked ? 'booked' : 'not booked yet'}${note ? ` (${note})` : ''}.`);
  }));

  // ---- airports and flights
  server.registerTool('find_airports', {
    title: 'Find airports',
    description: 'Finds airports matching a city, an airport name or an IATA code, busiest first. Works without signing in.',
    inputSchema: { query: z.string().min(2).max(80), limit: z.number().int().min(1).max(20).optional() },
    annotations: { title: 'Find airports', readOnlyHint: true },
  }, async ({ query, limit }) => {
    const airports = findAirports(query, limit || 8);
    return { content: [text(airports.length ? airports.map((a) => `${a.code} ${a.city} – ${a.name}, ${a.country}`).join('\n') : `No airport matches "${query}".`)], structuredContent: { airports } };
  });

  server.registerTool('search_flights', {
    title: 'Search flights',
    description: provider.name === 'Demo data'
      ? 'Shows sample fares (demo data, not real prices) for one day, or a return trip, between two airport or city codes, cheapest first. Prices are for all travellers together. Each person has a daily search limit.'
      : `Searches live airline fares through ${provider.name} for one day, or a return trip, between two airport or city codes, cheapest first. Prices are for all travellers together and each offer links to the airline's own site. ${provider.name} covers a set of mostly full-service airlines; many regional low-cost airlines are not included, so some routes return no offers. Each person has a daily search limit.`,
    inputSchema: {
      origin: IATA, destination: IATA, date: DATE,
      return_date: DATE.optional(),
      adults: z.number().int().min(1).max(9).default(1),
      cabin: z.enum(['economy', 'premium', 'business', 'first']).optional(),
      nonstop: z.boolean().optional(),
    },
    annotations: { title: 'Search flights', readOnlyHint: true, openWorldHint: true },
  }, mine(async ({ origin, destination, date, return_date, adults, cabin, nonstop }) => {
    if (origin.toUpperCase() === destination.toUpperCase()) return fail('Origin and destination are the same airport.');
    if (date < earliest()) return fail(`${date} has already passed; search today or a later date.`);
    if (return_date && return_date < date) return fail('The return date is before the departure date.');
    if (store.usage(owner, 'search') >= limits.searchesPerDay) return fail(`You have used today's ${limits.searchesPerDay} flight searches in Pinroute. The count starts again at 00:00 UTC.`);
    store.bumpUsage(owner, 'search');
    try {
      const r = await provider.searchFlights({ origin, destination, date, returnDate: return_date, adults, cabin, nonstop, currency: 'EUR' }, { env });
      const fares = r.fares.slice(0, 15);
      const head = `${provider.name}: ${r.fares.length} offers ${origin.toUpperCase()} → ${destination.toUpperCase()} on ${date}${return_date ? `, back ${return_date}` : ''}, ${adults} adult${adults > 1 ? 's' : ''}.`;
      return {
        content: [text([head, ...fares.slice(0, 5).map(fareLine), r.note].filter(Boolean).join('\n'))],
        structuredContent: { provider: provider.name, live: provider.name !== 'Demo data', query: { origin, destination, date, return_date: return_date || null, adults }, fares, note: r.note || '' },
      };
    } catch (e) {
      return fail(e.message || 'The flight search failed. Try again in a minute.');
    }
  }));

  // ---- a new trip: from the days off to a country and a flight, or from a country to the best time and a flight.
  // The draft keeps what the traveller said and the fares found for each country, so the planner and Claude share it.
  const MAX_DEALS = 12;
  function freshDraft() {
    const today = new Date().toISOString().slice(0, 10);
    const last = store.listTrips(owner).find((t) => t.home);
    const from = addDays(today, 30);
    return { way: 'when', step: 'when', from, until: addDays(from, 20), minNights: 9, maxNights: 12, adults: last?.adults || 2, budget: 0,
      homes: last ? [last.home] : [], regions: [], interests: [], compare: [], country: null, deals: {} };
  }
  const draftOf = () => store.getDraft(owner) || { ...freshDraft(), updated: null };
  const homesOf = (dr) => dr.homes.map((c) => airport(c)).filter(Boolean).map((a) => ({ code: a.code, city: cityOf(a), country: a.country, lat: a.lat, lon: a.lon }));
  const dealLine = (x) => {
    const dl = dealLabel(dealRatio(x));
    return `${eur(dealPP(x))} pp${x.adults > 1 ? ` (${eur(x.price)} for ${x.adults})` : ''}, ${x.from} → ${x.to} ${shortDate(x.depart)}, back ${shortDate(x.return)} (${diffDays(x.depart, x.return)} nights), ${x.airline}${x.stops != null ? `, ${x.stops ? `${x.stops} change${x.stops > 1 ? 's' : ''}` : 'direct'}` : ''}, via ${x.source}${dl ? `, ${dl[1].toLowerCase()}` : ''}; deal id ${x.id}`;
  };

  function draftResult(dr, line) {
    const homes = homesOf(dr);
    const ranked = rankDests(dr, homes[0]);
    const months = windowMonths(dr.from, dr.until);
    const warnings = [];
    if (diffDays(dr.from, dr.until) < dr.minNights) warnings.push(`The window is ${diffDays(dr.from, dr.until)} days, shorter than the ${dr.minNights} nights wanted.`);
    if (!homes.length) warnings.push('No departure airport yet.');
    const deals = Object.fromEntries(Object.entries(dr.deals || {}).map(([id, l]) => [id, l.slice(0, MAX_DEALS)]));
    const view = {
      screen: 'new',
      draft: { way: dr.way, step: dr.step, from: dr.from, until: dr.until, minNights: dr.minNights, maxNights: dr.maxNights, adults: dr.adults, budget: dr.budget,
        homes: dr.homes, regions: dr.regions, interests: dr.interests, compare: dr.compare, country: dr.country, updated: dr.updated },
      homes,
      top: ranked.slice(0, 8).map((r) => ({ id: r.d.id, name: r.d.name, fit: fitLabel(r.fit)[1], hours: r.hours, cost: r.cost.total, budget: budgetFit(r.cost, dr.budget)?.[1] || null })),
      deals,
      flights: { provider: provider.name, live: provider.name !== 'Demo data' },
      warnings,
    };
    const name = (id) => destById(id)?.name;
    const best = Object.entries(deals).map(([id, l]) => [id, dealsFor(l, dr)[0]]).filter(([, x]) => x);
    const target = dr.country ? destById(dr.country) : null;
    const lines = [
      line,
      `New-trip draft (${dr.way === 'where' ? 'I know where' : 'I know when'}, at ${dr.step}): free ${dr.from} to ${dr.until}, ${dr.minNights}–${dr.maxNights} nights, ${dr.adults} adult${dr.adults === 1 ? '' : 's'}${dr.budget ? `, budget ${eur(dr.budget)}` : ''}, from ${dr.homes.join(', ') || 'no airport yet'}.`,
      target ? `Country: ${target.name}, best ${bestMonthsText(target)}.` : `Best matches for ${months.map((m) => MONTHS[m]).join(' and ')}: ${view.top.slice(0, 6).map((t) => `${t.name} (${t.fit.toLowerCase()}${t.hours ? `, about ${t.hours} h` : ''})`).join(', ')}.`,
      dr.compare.length ? `Comparing: ${dr.compare.map(name).join(', ')}.` : null,
      ...best.map(([id, x]) => `Best fare for ${name(id)}: ${dealLine(x)}.`),
      ...warnings,
    ].filter(Boolean);
    return { content: [text(lines.join('\n'))], structuredContent: view };
  }

  // Country names to ids; the first one Pinroute doesn't know is the error
  function destIds(names) {
    const out = [];
    for (const n of names) {
      const d = findDest(n);
      if (!d) return { error: `Pinroute has weather and prices for 60 countries and "${n}" isn't one of them yet. Regions: ${REGIONS.join(', ')}.` };
      if (!out.includes(d.id)) out.push(d.id);
    }
    return { ids: out };
  }

  registerAppTool(server, 'plan_new_trip', {
    title: 'Plan a new trip',
    description: 'Shows Pinroute\'s new-trip planner and saves what the traveller said to their draft: when they are free, how many nights, how many travel, a budget, the airports they can fly from, regions, interests and countries to compare. The planner ranks 60 countries by the weather in those months, the flight time and the budget, and shows the flight deals saved for each. With country set it shows that country\'s best months and the fares found in each. Fields left out stay as they were.',
    inputSchema: {
      way: z.enum(['when', 'where']).optional().describe('"when": the traveller knows their free dates; "where": they know the country'),
      step: z.enum(['when', 'where', 'flights', 'country', 'season']).optional().describe('Screen to show: when, where, flights; or country, season for the "where" way'),
      free_from: DATE.optional().describe('First day the traveller could leave'),
      free_until: DATE.optional().describe('Last day they could be back'),
      min_nights: z.number().int().min(1).max(60).optional(),
      max_nights: z.number().int().min(1).max(60).optional(),
      adults: z.number().int().min(1).max(9).optional(),
      budget: z.number().min(0).max(1e6).optional().describe('Budget for the whole trip in euros, all travellers, flights included; 0 for none'),
      home_airports: z.array(IATA).max(6).optional().describe('Airports the traveller can fly from, the main one first'),
      regions: z.array(z.enum(REGIONS)).max(12).optional(),
      interests: z.array(z.enum(INTERESTS)).max(4).optional(),
      compare: z.array(z.string().min(2).max(60)).max(8).optional().describe('Countries to compare flights for'),
      country: z.string().min(2).max(60).optional().describe('The country, when the traveller knows where to go'),
      reset: z.boolean().optional().describe('Start a new draft, keeping only the departure airports and travellers'),
    },
    annotations: { title: 'Plan a new trip', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    _meta: { ui: { resourceUri: PLANNER_URI } },
  }, mine(async (a) => {
    const changes = Object.keys(a).filter((k) => a[k] !== undefined);
    if (!changes.length) return draftResult(draftOf());
    if (a.free_from && a.free_from < earliest()) return fail(`${a.free_from} has already passed; the window has to start today or later.`);
    const homes = a.home_airports?.map((c) => c.toUpperCase());
    const unknown = homes?.find((c) => !airport(c));
    if (unknown) return fail(`No airport with the code ${unknown}. find_airports looks codes up.`);
    const cmp = a.compare ? destIds(a.compare) : { ids: null };
    if (cmp.error) return fail(cmp.error);
    const target = a.country ? findDest(a.country) : null;
    if (a.country && !target) return fail(destIds([a.country]).error);
    let bad = null;
    const dr = store.updateDraft(owner, (cur) => {
      let d = a.reset ? { ...freshDraft(), homes: cur.homes?.length ? cur.homes : freshDraft().homes, adults: cur.adults || 2 } : { ...freshDraft(), ...cur };
      if (a.free_from) { d.from = a.free_from; if (!a.free_until && d.until <= d.from) d.until = addDays(d.from, Math.max(d.maxNights, 7)); }
      if (a.free_until) d.until = a.free_until;
      if (d.until <= d.from) bad = `The last day (${d.until}) has to come after the first (${d.from}).`;
      if (a.min_nights) { d.minNights = a.min_nights; if (d.maxNights < d.minNights) d.maxNights = d.minNights; }
      if (a.max_nights) { d.maxNights = a.max_nights; if (d.minNights > d.maxNights) d.minNights = d.maxNights; }
      if (a.adults) d.adults = a.adults;
      if (a.budget !== undefined) d.budget = Math.round(a.budget);
      if (homes) d.homes = [...new Set(homes)];
      if (a.regions) d.regions = a.regions;
      if (a.interests) d.interests = a.interests;
      if (cmp.ids) d.compare = cmp.ids;
      if (target) { d.country = target.id; d.way = 'where'; }
      if (a.way) { d.way = a.way; if (!a.step && !target) d.step = a.way === 'where' ? 'country' : 'when'; }
      if (target && !a.step) d.step = 'season';
      if (a.step) d.step = a.step;
      if (bad) return cur;
      // Comparing starts with the four best matches, so the flights step always has countries to price
      if (a.step && !cmp.ids && (d.step === 'where' || d.step === 'flights') && !d.compare.length) d.compare = rankDests(d, homesOf(d)[0]).slice(0, 4).map((r) => r.d.id);
      return d;
    }, freshDraft);
    if (bad) return fail(bad);
    return draftResult(dr);
  }));

  // Fares for one window: departures spread over it, each with the trip length in the middle of the range
  function datePairs(from, until, minN, maxN, count) {
    const n = Math.round((minN + maxN) / 2);
    const lastOut = addDays(until, -Math.min(n, Math.max(1, diffDays(from, until))));
    const span = Math.max(0, diffDays(from, lastOut));
    const outs = [...new Set(Array.from({ length: count }, (_, i) => addDays(from, count === 1 ? 0 : Math.round((i * span) / (count - 1)))))];
    return outs.map((d) => [d, addDays(d, Math.max(1, Math.min(n, diffDays(d, until))))]);
  }
  // New fares replace the ones from the same source for the same country that leave in the same months
  function keepDeals(cur, id, source, fresh) {
    const months = new Set(fresh.map((x) => x.depart.slice(0, 7)));
    const today = new Date().toISOString().slice(0, 10);
    const kept = (cur[id] || []).filter((x) => x.depart >= today && !(x.source === source && months.has(x.depart.slice(0, 7))));
    return { ...cur, [id]: [...fresh, ...kept].sort((a, b) => dealPP(a) - dealPP(b)).slice(0, 30) };
  }
  const distOf = (from, to) => km(airport(from), airport(to));

  server.registerTool('scan_flight_deals', {
    title: 'Scan for flight deals',
    description: provider.name === 'Demo data'
      ? 'Looks up sample return fares (demo data, not real prices) from the traveller\'s main departure airport to a country\'s main airport on a few dates spread over the draft\'s window, or the dates given, and saves the cheapest to the new-trip draft. Each date counts as one search toward the daily limit.'
      : `Searches ${provider.name} for return fares from the traveller's main departure airport to a country's main airport on a few dates spread over the draft's window, or the dates given, and saves the cheapest to the new-trip draft. Each date counts as one search toward the daily limit. ${provider.name} covers mostly full-service airlines, so low-cost fares are often missing.`,
    inputSchema: {
      country: z.string().min(2).max(60),
      origin: IATA.optional().describe('Departure airport; the draft\'s main one if left out'),
      earliest: DATE.optional().describe('First departure day; the draft\'s window if left out'),
      latest: DATE.optional().describe('Last day to be back'),
      dates: z.number().int().min(1).max(4).optional().describe('How many departure dates to try, 3 if left out'),
    },
    annotations: { title: 'Scan for flight deals', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, mine(async ({ country, origin, earliest: e, latest, dates }) => {
    const d = findDest(country);
    if (!d) return fail(destIds([country]).error);
    const dr = draftOf();
    const from = (origin || dr.homes[0] || '').toUpperCase();
    if (!from) return fail('The draft has no departure airport; set home_airports with plan_new_trip, or give origin.');
    if (!airport(from)) return fail(`No airport with the code ${from}.`);
    const tomorrow = addDays(new Date().toISOString().slice(0, 10), 1);
    const lo = [e || dr.from, tomorrow].sort()[1], hi = latest || dr.until;
    if (hi <= lo) return fail(`Nothing to search between ${lo} and ${hi}.`);
    const left = limits.searchesPerDay - store.usage(owner, 'search');
    if (left <= 0) return fail(`You have used today's ${limits.searchesPerDay} flight searches in Pinroute. The count starts again at 00:00 UTC.`);
    const pairs = datePairs(lo, hi, dr.minNights, dr.maxNights, Math.min(dates || 3, left));
    const now = new Date().toISOString();
    const runs = await Promise.allSettled(pairs.map(async ([out, back]) => {
      store.bumpUsage(owner, 'search');
      const r = await provider.searchFlights({ origin: from, destination: d.gw, date: out, returnDate: back, adults: dr.adults, currency: 'EUR' }, { env });
      return r.fares.slice(0, 2).map((f) => {
        const [o, b] = f.bounds;
        return {
          id: store.newId('dl'), country: d.id, from: o?.from || from, to: o?.to || d.gw, back_from: b?.from || o?.to || d.gw, depart: out,
          arrive: String(o?.arrives || out).slice(0, 10), return: back, price: f.total, currency: f.currency, adults: dr.adults, airline: f.airline,
          out: o ? `${f.airline}${flightNos(o) ? ` ${flightNos(o)}` : ''}, ${hhmm(o.departs)} ${o.from} → ${hhmm(o.arrives)} ${o.to}` : null,
          back: b ? `${f.airline}${flightNos(b) ? ` ${flightNos(b)}` : ''}, ${hhmm(b.departs)} ${b.from} → ${hhmm(b.arrives)} ${b.to}` : null,
          stops: Math.max(...f.bounds.map((x) => x.stops)), minutes: o?.minutes ?? null, link: f.link, source: provider.name, at: now,
          km: distOf(o?.from || from, o?.to || d.gw),
        };
      });
    }));
    const found = runs.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
    const failed = runs.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || 'search failed');
    if (!found.length && failed.length === runs.length) return fail(failed[0]);
    const next = store.updateDraft(owner, (cur) => ({ ...cur, deals: found.length ? keepDeals(cur.deals || {}, d.id, provider.name, found) : cur.deals || {} }), freshDraft);
    const shown = dealsFor(next.deals[d.id], { ...next, from: lo, until: hi });
    const head = found.length
      ? `${provider.name}: ${found.length} fare${found.length === 1 ? '' : 's'} saved for ${d.name}, from ${from} on ${pairs.map(([o]) => shortDate(o)).join(', ')}.`
      : `${provider.name} had no return fares from ${from} to ${d.gw} on ${pairs.map(([o]) => shortDate(o)).join(', ')}.`;
    return {
      content: [text([head, ...shown.slice(0, 3).map(dealLine), failed.length ? `${failed.length} of the searches failed: ${failed[0]}` : null].filter(Boolean).join('\n'))],
      structuredContent: { country: d.id, searched: pairs.map(([o, b]) => ({ depart: o, return: b })), deals: shown.slice(0, MAX_DEALS), failed },
    };
  }));

  const dealIn = z.object({
    from: IATA, to: IATA,
    back_from: IATA.optional().describe('Where the flight home leaves from, when that isn\'t the arrival airport'),
    depart: DATE, return: DATE,
    arrive: DATE.optional().describe('Day the outbound flight lands, when that is a day or more after departure'),
    price: z.number().positive().max(1e6).describe('Total for all travellers, both ways'),
    currency: CURRENCY,
    adults: z.number().int().min(1).max(9).optional(),
    airline: z.string().min(1).max(80),
    out: z.string().max(160).optional().describe('Outbound flight: numbers and times, e.g. "QR 70, 21:10 FRA → 13:40 SGN"'),
    back: z.string().max(160).optional().describe('Flight home: numbers and times'),
    stops: z.number().int().min(0).max(6).optional().describe('Most changes in either direction'),
    link: z.string().url().max(2000).optional(),
    source: z.string().min(1).max(40).describe('Where the fare was found, e.g. the flight search tool or site'),
  });

  server.registerTool('save_flight_deals', {
    title: 'Save flight deals',
    description: 'Saves return fares found with any flight search to the traveller\'s new-trip draft, for one country, so the planner can compare them and start a trip from one. Fares from the same source for the same country that leave in the same months are replaced.',
    inputSchema: { country: z.string().min(2).max(60), deals: z.array(dealIn).min(1).max(10) },
    annotations: { title: 'Save flight deals', readOnlyHint: false, destructiveHint: false },
  }, mine(async ({ country, deals }) => {
    const d = findDest(country);
    if (!d) return fail(destIds([country]).error);
    const dr = draftOf();
    for (const x of deals) {
      if (x.return <= x.depart) return fail(`A fare comes back on ${x.return}, not after it leaves on ${x.depart}.`);
      if (x.depart < earliest()) return fail(`A fare leaves on ${x.depart}, which has passed.`);
      if (!airport(x.from) || !airport(x.to)) return fail(`Unknown airport code in ${x.from} → ${x.to}.`);
    }
    const now = new Date().toISOString();
    const bySource = new Map();
    for (const x of deals) {
      const item = { ...x, id: store.newId('dl'), country: d.id, from: x.from.toUpperCase(), to: x.to.toUpperCase(), back_from: (x.back_from || x.to).toUpperCase(),
        arrive: x.arrive && x.arrive >= x.depart ? x.arrive : x.depart, currency: x.currency.toUpperCase(), adults: x.adults || dr.adults, at: now, km: distOf(x.from, x.to) };
      bySource.set(item.source, [...(bySource.get(item.source) || []), item]);
    }
    const next = store.updateDraft(owner, (cur) => {
      let all = cur.deals || {};
      for (const [src, list] of bySource) all = keepDeals(all, d.id, src, list);
      return { ...cur, deals: all };
    }, freshDraft);
    const saved = next.deals[d.id].filter((x) => x.at === now);
    return { content: [text([`Saved ${saved.length} fare${saved.length === 1 ? '' : 's'} for ${d.name} to the Pinroute draft.`, ...saved.slice(0, 5).map(dealLine)].join('\n'))], structuredContent: { country: d.id, deals: saved } };
  }));

  registerAppTool(server, 'start_trip_from_flight', {
    title: 'Start a trip from a flight',
    description: 'Creates a trip from a return fare saved in the new-trip draft: it starts the day the flight lands at its airport and ends the day the flight home leaves, and keeps the fare as the trip\'s outbound and home flights. The route between can then be planned with update_trip. Shows the trip in the planner.',
    inputSchema: { deal_id: z.string().max(40).describe('Deal id from the draft'), name: z.string().min(1).max(80).optional() },
    annotations: { title: 'Start a trip from a flight', readOnlyHint: false, destructiveHint: false },
    _meta: { ui: { resourceUri: PLANNER_URI } },
  }, mine(async ({ deal_id, name }) => {
    if (store.countTrips(owner) >= limits.trips) return fail(`Your Pinroute account already has ${limits.trips} trips, the most it keeps. Delete one with delete_trip first.`);
    const dr = draftOf();
    const x = Object.values(dr.deals || {}).flat().find((y) => y.id === deal_id);
    if (!x) return fail(`No fare with id ${deal_id} in the draft. plan_new_trip lists the fares saved for each country.`);
    const d = destById(x.country);
    const start = x.arrive || x.depart;
    const nights = diffDays(start, x.return);
    if (nights < 1) return fail('This fare leaves no night at the destination.');
    const a = airport(x.to), b = airport(x.back_from || x.to);
    const stops = [{ ...resolvePlace(cityOf(a), a.code), nights }];
    if (b && b.code !== a.code) stops.push({ ...resolvePlace(cityOf(b), b.code), nights: 0 });
    const trip = { id: store.newId('trp'), name: name || `${d?.name || cityOf(a)} · ${MONTHS[monthOf(start)]} ${start.slice(0, 4)}`, start, adults: x.adults || dr.adults, home: x.from,
      stops, country: d?.id || null, choices: {}, created: new Date().toISOString(),
      ticket: { from: x.from, to: x.to, back_from: x.back_from || x.to, depart: x.depart, arrive: start, return: x.return, price: x.price, currency: x.currency, airline: x.airline, out: x.out || null, back: x.back || null, link: x.link || null, source: x.source } };
    const ls = legs(trip);
    const out = ls.find((l) => l.kind === 'out'), home = ls.find((l) => l.kind === 'home');
    const base = { currency: x.currency, link: x.link || null, source: x.source, at: new Date().toISOString() };
    if (out) trip.choices[out.key] = { ...base, summary: x.out || `${x.airline}, ${x.from} → ${x.to}`, price: x.price, part: 'out' };
    if (home) trip.choices[home.key] = { ...base, summary: x.back || `${x.airline}, ${x.back_from || x.to} → ${x.from}`, price: 0, part: 'return' };
    const saved = store.putTrip(owner, trip);
    return viewResult(saved, `Created "${saved.name}" (${saved.id}): ${start} to ${x.return}, ${nights} nights, landing at ${a.code} and flying home from ${(b || a).code}. The return fare is saved on both flights. The route is still one stop; update_trip with the stops in travel order plans it.`);
  }));

  // ---- local picks: Claude researches on the traveller's own plan, this server keeps the result
  const pick = z.object({
    name: z.string().min(1).max(80),
    kind: z.enum(['food', 'drink', 'beach', 'view', 'activity', 'stay', 'shop', 'other']),
    why: z.string().min(1).max(300).describe('What locals or recent visitors say, in one or two sentences'),
    area: z.string().max(80).optional(),
    source_url: z.string().url().max(2000).describe('The post, thread or article the pick comes from'),
  });

  server.registerTool('save_local_picks', {
    title: 'Save local picks',
    description: 'Saves local favourites for a place (restaurants, bars, beaches, viewpoints, activities and so on) to the traveller\'s Pinroute account, each with a short note and the link to the post, thread or article it comes from. Adds to the saved list; a pick with the same name is updated.',
    inputSchema: { place: z.string().min(1).max(80), picks: z.array(pick).min(1).max(15) },
    annotations: { title: 'Save local picks', readOnlyHint: false, destructiveHint: false },
  }, mine(async ({ place, picks }) => {
    const have = store.getPicks(owner, place);
    const names = new Set([...have, ...picks].map((p) => p.name.toLowerCase()));
    if (names.size > limits.picksPerPlace) return fail(`${place} would have ${names.size} saved picks; Pinroute keeps up to ${limits.picksPerPlace} per place.`);
    const saved = store.mergePicks(owner, place, picks);
    return { content: [text(`${saved.length} local picks saved for ${place}.`)], structuredContent: { place, picks: saved } };
  }));

  server.registerTool('get_local_picks', {
    title: 'Get local picks',
    description: 'Returns the local picks saved in the traveller\'s Pinroute account for a place.',
    inputSchema: { place: z.string().min(1).max(80) },
    annotations: { title: 'Get local picks', readOnlyHint: true },
  }, mine(async ({ place }) => {
    const picks = store.getPicks(owner, place);
    return { content: [text(picks.length ? picks.map((p) => `${p.name} (${p.kind}): ${p.why}`).join('\n') : `No local picks saved for ${place} yet.`)], structuredContent: { place, picks } };
  }));

  // ---- the traveller's own data
  server.registerTool('delete_my_data', {
    title: 'Delete my Pinroute data',
    description: 'Deletes everything the traveller has saved in Pinroute: all trips, chosen flights, the new-trip draft with its fares, local picks and search counts. This cannot be undone. Requires confirm set to true.',
    inputSchema: { confirm: z.literal(true).describe('Must be true') },
    annotations: { title: 'Delete my Pinroute data', readOnlyHint: false, destructiveHint: true },
  }, mine(async () => {
    const n = store.deleteOwner(owner);
    return { content: [text(`Deleted ${n.trips} trip${n.trips === 1 ? '' : 's'}${n.drafts ? ', the new-trip draft' : ''} and the local picks for ${n.picks} place${n.picks === 1 ? '' : 's'}. Nothing else is kept for your account.`)], structuredContent: { deleted: n } };
  }));

  return server;
}
