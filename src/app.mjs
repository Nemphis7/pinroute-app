// The MCP server: Pinroute's tools and the planner screen. Claude (on the traveller's own plan) does the thinking;
// this server only keeps trips, finds airports, searches flights and stores the local picks Claude researched.
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { findAirports, resolvePlace } from './geo.mjs';
import { getTrip, listTrips, putTrip, newId, getPicks, mergePicks } from './store.mjs';
import { schedule, legs, endDate } from './trips.mjs';
import { flightProvider } from './providers/index.mjs';

export const PLANNER_URI = 'ui://pinroute/planner';
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const IATA = z.string().regex(/^[A-Za-z]{3}$/, 'a 3-letter airport or city code');

const text = (t) => ({ type: 'text', text: t });
const fail = (msg) => ({ isError: true, content: [text(msg)] });

function plannerHtml() {
  try { return readFileSync(new URL('../dist/planner.html', import.meta.url), 'utf8'); }
  catch { return '<!doctype html><meta charset="utf-8"><p style="font:14px system-ui">The planner is not built yet: run <code>npm run build</code> on the server.</p>'; }
}

// Everything the planner needs for one trip, kept small: this also goes to the model
function tripView(trip) {
  const rows = schedule(trip);
  const picks = Object.fromEntries(rows.map((s) => [s.place, getPicks(s.place)]));
  const provider = flightProvider();
  return {
    trip: { id: trip.id, name: trip.name, start: trip.start, end: endDate(trip), adults: trip.adults, home: trip.home || null, choices: trip.choices || {} },
    stops: rows.map((s) => ({ place: s.place, nights: s.nights, arrive: s.arrive, depart: s.depart, iata: s.iata, region: s.region })),
    legs: legs(trip),
    picks,
    flights: { provider: provider.name, live: provider.name !== 'Demo data' },
  };
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

export function buildServer() {
  const server = new McpServer({ name: 'pinroute', version: '0.1.0' });

  // ---- the planner screen
  registerAppTool(server, 'open_planner', {
    title: 'Open the Pinroute planner',
    description: 'Show the interactive Pinroute planner for a saved trip: the route with dates, flights between stops, chosen flights and local picks. Without trip_id it opens the most recent trip. Use create_trip first if the traveller has none.',
    inputSchema: { trip_id: z.string().optional().describe('Trip id from create_trip or list_trips') },
    annotations: { title: 'Open the Pinroute planner', readOnlyHint: true },
    _meta: { ui: { resourceUri: PLANNER_URI } },
  }, async ({ trip_id }) => {
    const trip = trip_id ? getTrip(trip_id) : listTrips()[0];
    if (!trip) return fail(trip_id ? `No trip with id ${trip_id}.` : 'No trips saved yet: create one with create_trip.');
    const v = tripView(trip);
    return { content: [text(summary(v))], structuredContent: v };
  });

  registerAppResource(server, 'Pinroute planner', PLANNER_URI, { description: 'Interactive trip planner: route, flights and local picks' }, async () => ({
    contents: [{ uri: PLANNER_URI, mimeType: RESOURCE_MIME_TYPE, text: plannerHtml() }],
  }));

  // ---- trips
  const stopSchema = z.object({
    place: z.string().min(1).describe('Place name as the traveller says it, e.g. "Koh Lanta"'),
    nights: z.number().int().min(0).max(60),
    airport: IATA.optional().describe('Nearest airport code, if the place is outside Pinroute\'s Thailand list'),
  });

  server.registerTool('create_trip', {
    title: 'Create a trip',
    description: 'Save a new multi-stop trip. Stops are in order; nights are spent at each stop. Thailand places are recognised by name; for others give the nearest airport code. Returns the trip id.',
    inputSchema: {
      name: z.string().min(1).max(80),
      start: DATE.describe('Date of the first night'),
      adults: z.number().int().min(1).max(9),
      home_airport: IATA.optional().describe('Where the traveller flies from and back to'),
      stops: z.array(stopSchema).min(1).max(20),
    },
    annotations: { title: 'Create a trip', readOnlyHint: false, destructiveHint: false },
  }, async ({ name, start, adults, home_airport, stops }) => {
    const resolved = stops.map((s) => ({ ...resolvePlace(s.place, s.airport), nights: s.nights }));
    const trip = putTrip({ id: newId('trp'), name, start, adults, home: home_airport?.toUpperCase() || null, stops: resolved, choices: {}, created: new Date().toISOString() });
    const missing = resolved.filter((s) => !s.iata).map((s) => s.place);
    const v = tripView(trip);
    return { content: [text(summary(v) + (missing.length ? ` No airport found for: ${missing.join(', ')} (add "airport").` : ''))], structuredContent: v };
  });

  server.registerTool('update_trip', {
    title: 'Change a trip',
    description: 'Change a saved trip. Any field left out stays as it is; "stops", when given, replaces the whole route.',
    inputSchema: {
      trip_id: z.string(),
      name: z.string().min(1).max(80).optional(),
      start: DATE.optional(),
      adults: z.number().int().min(1).max(9).optional(),
      home_airport: IATA.optional(),
      stops: z.array(stopSchema).min(1).max(20).optional(),
    },
    annotations: { title: 'Change a trip', readOnlyHint: false, destructiveHint: true },
  }, async ({ trip_id, name, start, adults, home_airport, stops }) => {
    const t = getTrip(trip_id);
    if (!t) return fail(`No trip with id ${trip_id}.`);
    const next = { ...t, ...(name && { name }), ...(start && { start }), ...(adults && { adults }), ...(home_airport && { home: home_airport.toUpperCase() }) };
    if (stops) next.stops = stops.map((s) => ({ ...resolvePlace(s.place, s.airport), nights: s.nights }));
    const v = tripView(putTrip(next));
    return { content: [text(summary(v))], structuredContent: v };
  });

  server.registerTool('list_trips', {
    title: 'List trips',
    description: 'The traveller\'s saved trips, newest first.',
    inputSchema: {},
    annotations: { title: 'List trips', readOnlyHint: true },
  }, async () => {
    const trips = listTrips().map((t) => ({ id: t.id, name: t.name, start: t.start, end: endDate(t), stops: t.stops.length }));
    return { content: [text(trips.length ? trips.map((t) => `${t.name} (${t.start} to ${t.end}, ${t.stops} stops): ${t.id}`).join('\n') : 'No trips saved yet.')], structuredContent: { trips } };
  });

  server.registerTool('choose_flight', {
    title: 'Choose a flight for a leg',
    description: 'Save the flight the traveller picked for one leg of a trip (leg_key from the planner). Booking still happens on the airline\'s site.',
    inputSchema: {
      trip_id: z.string(),
      leg_key: z.string(),
      summary: z.string().max(200).describe('One line: airline, flight numbers, times'),
      price: z.number().nonnegative(),
      currency: z.string().length(3),
      link: z.string().url().optional(),
    },
    annotations: { title: 'Choose a flight for a leg', readOnlyHint: false, destructiveHint: false },
  }, async ({ trip_id, leg_key, summary: line, price, currency, link }) => {
    const t = getTrip(trip_id);
    if (!t) return fail(`No trip with id ${trip_id}.`);
    const choices = { ...(t.choices || {}), [leg_key]: { summary: line, price, currency, link: link || null, at: new Date().toISOString() } };
    const v = tripView(putTrip({ ...t, choices }));
    return { content: [text(`Saved for ${leg_key}: ${line} (${currency} ${price}).`)], structuredContent: v };
  });

  // ---- airports and flights
  server.registerTool('find_airports', {
    title: 'Find airports',
    description: 'Airports matching a city, an airport name or a code, busiest first.',
    inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(20).optional() },
    annotations: { title: 'Find airports', readOnlyHint: true },
  }, async ({ query, limit }) => {
    const airports = findAirports(query, limit || 8);
    return { content: [text(airports.length ? airports.map((a) => `${a.code} ${a.city} – ${a.name}, ${a.country}`).join('\n') : `No airport matches "${query}".`)], structuredContent: { airports } };
  });

  server.registerTool('search_flights', {
    title: 'Search flights',
    description: 'Live flight offers for one day (or a return trip) between two airport or city codes, cheapest first. Prices are for all travellers together. Each offer links to the airline\'s own site for booking.',
    inputSchema: {
      origin: IATA, destination: IATA, date: DATE,
      return_date: DATE.optional(),
      adults: z.number().int().min(1).max(9).default(1),
      cabin: z.enum(['economy', 'premium', 'business', 'first']).optional(),
      nonstop: z.boolean().optional(),
    },
    annotations: { title: 'Search flights', readOnlyHint: true, openWorldHint: true },
  }, async ({ origin, destination, date, return_date, adults, cabin, nonstop }) => {
    if (origin.toUpperCase() === destination.toUpperCase()) return fail('Origin and destination are the same.');
    const provider = flightProvider();
    try {
      const r = await provider.searchFlights({ origin, destination, date, returnDate: return_date, adults, cabin, nonstop, currency: 'EUR' });
      const fares = r.fares.slice(0, 15);
      const head = `${provider.name}: ${r.fares.length} offers ${origin.toUpperCase()} → ${destination.toUpperCase()} on ${date}${return_date ? `, back ${return_date}` : ''}, ${adults} adult${adults > 1 ? 's' : ''}.`;
      return {
        content: [text([head, ...fares.slice(0, 5).map(fareLine), r.note].filter(Boolean).join('\n'))],
        structuredContent: { provider: provider.name, live: provider.name !== 'Demo data', query: { origin, destination, date, return_date: return_date || null, adults }, fares, note: r.note || '' },
      };
    } catch (e) {
      return fail(e.message || 'The flight search failed.');
    }
  });

  // ---- local picks: Claude researches on the traveller's own plan, this server only keeps the result
  const pick = z.object({
    name: z.string().min(1).max(80),
    kind: z.enum(['food', 'drink', 'beach', 'view', 'activity', 'stay', 'shop', 'other']),
    why: z.string().min(1).max(300).describe('What locals or recent visitors say, in one or two sentences'),
    area: z.string().max(80).optional(),
    source_url: z.string().url().describe('Where this came from: a Reddit thread, TikTok, Instagram post or blog'),
  });

  server.registerTool('save_local_picks', {
    title: 'Save local picks',
    description: 'Save local favourites for a place after you have researched them yourself with web search: Reddit threads, TikTok, Instagram and food or travel blogs, recent ones first. Every pick needs its source link. Adds to what is saved; a pick with the same name is updated.',
    inputSchema: { place: z.string().min(1), picks: z.array(pick).min(1).max(15) },
    annotations: { title: 'Save local picks', readOnlyHint: false, destructiveHint: false },
  }, async ({ place, picks }) => {
    const saved = mergePicks(place, picks);
    return { content: [text(`${saved.length} local picks saved for ${place}.`)], structuredContent: { place, picks: saved } };
  });

  server.registerTool('get_local_picks', {
    title: 'Get local picks',
    description: 'The local picks saved for a place.',
    inputSchema: { place: z.string().min(1) },
    annotations: { title: 'Get local picks', readOnlyHint: true },
  }, async ({ place }) => {
    const picks = getPicks(place);
    return { content: [text(picks.length ? picks.map((p) => `${p.name} (${p.kind}): ${p.why}`).join('\n') : `No local picks saved for ${place} yet.`)], structuredContent: { place, picks } };
  });

  return server;
}
