// The MCP server: Pinroute's tools and the planner screen. Claude, on each traveller's own plan, does the thinking;
// this server keeps each person's trips, finds airports, searches airline fares and stores the local picks Claude found.
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { findAirports, resolvePlace } from './geo.mjs';
import * as store from './store.mjs';
import { schedule, legs, endDate } from './trips.mjs';
import { flightProvider } from './providers/index.mjs';

export const VERSION = '0.2.0';
export const PLANNER_URI = 'ui://pinroute/planner';

const realDate = (s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD').refine(realDate, 'not a calendar date');
const IATA = z.string().regex(/^[A-Za-z]{3}$/, 'a 3-letter airport or city code');

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
  const mine = (fn) => async (args) => (owner ? fn(args) : fail('Sign in to Pinroute to use this.'));
  const noTrip = (id) => fail(`No trip with id ${id} in your Pinroute account. list_trips shows the trips you have.`);

  // Everything the planner needs for one trip, kept small: this also goes to the model
  function tripView(trip) {
    const rows = schedule(trip);
    const picks = Object.fromEntries(rows.map((s) => [s.place, store.getPicks(owner, s.place)]));
    const provider = flightProvider(env);
    return {
      trip: { id: trip.id, name: trip.name, start: trip.start, end: endDate(trip), adults: trip.adults, home: trip.home || null, choices: trip.choices || {} },
      stops: rows.map((s) => ({ place: s.place, nights: s.nights, arrive: s.arrive, depart: s.depart, iata: s.iata, region: s.region })),
      legs: legs(trip),
      picks,
      flights: { provider: provider.name, live: provider.name !== 'Demo data' },
    };
  }

  // ---- the planner screen
  registerAppTool(server, 'open_planner', {
    title: 'Open the Pinroute planner',
    description: 'Shows the interactive Pinroute planner for one of the traveller\'s saved trips: the route with dates, the flight or road and ferry leg between stops, flights chosen so far and saved local picks. Without trip_id it shows the most recently changed trip.',
    inputSchema: { trip_id: z.string().max(40).optional().describe('Trip id from create_trip or list_trips') },
    annotations: { title: 'Open the Pinroute planner', readOnlyHint: true },
    _meta: { ui: { resourceUri: PLANNER_URI } },
  }, mine(async ({ trip_id }) => {
    const trip = trip_id ? store.getTrip(owner, trip_id) : store.listTrips(owner)[0];
    if (!trip) return trip_id ? noTrip(trip_id) : fail('Your Pinroute account has no saved trips yet; create_trip saves one.');
    const v = tripView(trip);
    return { content: [text(summary(v))], structuredContent: v };
  }));

  registerAppResource(server, 'Pinroute planner', PLANNER_URI, { description: 'Interactive trip planner: route, flights and local picks' }, async () => ({
    contents: [{ uri: PLANNER_URI, mimeType: RESOURCE_MIME_TYPE, text: plannerHtml() }],
  }));

  // ---- trips
  const stopSchema = z.object({
    place: z.string().min(1).max(80).describe('Place name as the traveller says it, e.g. "Koh Lanta"'),
    nights: z.number().int().min(0).max(60),
    airport: IATA.optional().describe('Nearest airport code, for places outside Pinroute\'s Thailand list'),
  });
  const resolveStops = (stops) => stops.map((s) => ({ ...resolvePlace(s.place, s.airport), nights: s.nights }));

  server.registerTool('create_trip', {
    title: 'Create a trip',
    description: 'Saves a new multi-stop trip to the traveller\'s Pinroute account. Stops are in travel order with the nights spent at each; a last stop with 0 nights is where the trip ends. Places in Thailand are recognised by name; elsewhere, give the nearest airport code. Returns the trip with its dates and legs.',
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
    const v = tripView(trip);
    return { content: [text(summary(v) + (missing.length ? ` No airport found for: ${missing.join(', ')}; give "airport" for those stops to get flight legs.` : ''))], structuredContent: v };
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
    const v = tripView(store.putTrip(owner, next));
    return { content: [text(summary(v))], structuredContent: v };
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
    const choices = { ...(t.choices || {}), [leg_key]: { summary: line, price, currency: cur, link: link || null, source: source || null, at: new Date().toISOString() } };
    const v = tripView(store.putTrip(owner, { ...t, choices }));
    return { content: [text(`Saved for ${leg_key}: ${line} (${cur} ${price}).`)], structuredContent: v };
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

  const provider = flightProvider(env);
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
    description: 'Deletes everything the traveller has saved in Pinroute: all trips, chosen flights, local picks and search counts. This cannot be undone. Requires confirm set to true.',
    inputSchema: { confirm: z.literal(true).describe('Must be true') },
    annotations: { title: 'Delete my Pinroute data', readOnlyHint: false, destructiveHint: true },
  }, mine(async () => {
    const n = store.deleteOwner(owner);
    return { content: [text(`Deleted ${n.trips} trip${n.trips === 1 ? '' : 's'} and the local picks for ${n.picks} place${n.picks === 1 ? '' : 's'}. Nothing else is kept for your account.`)], structuredContent: { deleted: n } };
  }));

  return server;
}
