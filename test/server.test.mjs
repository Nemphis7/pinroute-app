// Every tool, called the way Claude calls it: over HTTP through an MCP client (sign-in off: one local owner).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, THAILAND_TRIP, START, LAST_DAY, KBV_BKK, addDays } from './helpers.mjs';

let srv, client, trip;
before(async () => { srv = await startServer(null, { SEARCH_LIMIT_PER_DAY: '6' }); client = await connect(srv.url); });
after(async () => { await client.close(); srv.server.close(); });

const TOOLS = ['choose_flight', 'clear_flight', 'create_trip', 'delete_my_data', 'delete_trip', 'find_airports', 'flight_link', 'get_local_picks', 'list_trips', 'mark_leg', 'open_planner',
  'plan_new_trip', 'save_flight_deals', 'save_local_picks', 'scan_flight_deals', 'search_flights', 'set_nights', 'start_trip_from_flight', 'update_trip'];

test('lists nineteen tools, each with a title and the right read or write annotation', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS);
  for (const t of tools) {
    assert.ok(t.title && t.annotations?.title, `${t.name} has a title`);
    assert.ok(t.name.length <= 64);
    const read = t.annotations.readOnlyHint === true;
    assert.ok(read || 'destructiveHint' in t.annotations, `${t.name} declares read-only or destructive`);
    if (/^(delete|update|clear)_/.test(t.name)) assert.equal(t.annotations.destructiveHint, true, `${t.name} is destructive`);
    if (/^(set_nights|mark_leg)$/.test(t.name)) assert.deepEqual([t.annotations.readOnlyHint, t.annotations.destructiveHint], [false, false], `${t.name} writes but takes nothing away`);
    if (/^(get|list|find|open|search)_/.test(t.name)) assert.equal(read, true, `${t.name} is read-only`);
  }
  for (const name of ['open_planner', 'plan_new_trip', 'start_trip_from_flight']) assert.equal(tools.find((t) => t.name === name)._meta.ui.resourceUri, 'ui://pinroute/planner', `${name} shows the planner`);
});

test('tool descriptions describe what a tool does, without steering Claude', async () => {
  const { tools } = await client.listTools();
  for (const t of tools) {
    assert.doesNotMatch(t.description, /\b(you should|you must|always|never|first use|after you have|reddit|tiktok|instagram|ignore)\b/i, `${t.name}: ${t.description}`);
  }
});

test('serves the planner as one self-contained MCP App page', async () => {
  const r = await client.readResource({ uri: 'ui://pinroute/planner' });
  const c = r.contents[0];
  assert.equal(c.mimeType, 'text/html;profile=mcp-app');
  assert.match(c.text, /<title>Pinroute planner<\/title>/);
  assert.doesNotMatch(c.text, /<script[^>]+src=/i, 'no outside scripts: the sandbox would block them');
});

test('creates the Thailand trip with airports, dates and flight legs', async () => {
  const r = await client.callTool({ name: 'create_trip', arguments: THAILAND_TRIP });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const v = r.structuredContent;
  trip = v.trip;
  assert.match(trip.id, /^trp_/);
  assert.equal(v.trip.end, LAST_DAY);
  assert.deepEqual(v.stops.map((s) => s.iata), ['BKK', 'URT', 'HKT', 'HKT', 'KBV', 'KBV', 'KBV', 'BKK']);
  assert.deepEqual(v.stops.map((s) => s.place), THAILAND_TRIP.stops.map((s) => s.place), 'stops keep the traveller\'s own names');
  const aoNang = v.legs.find((l) => l.fromName === 'Ao Nang' && l.toName === 'Bangkok');
  assert.deepEqual([aoNang.kind, aoNang.from, aoNang.to, aoNang.date, aoNang.key], ['flight', 'KBV', 'BKK', LAST_DAY, KBV_BKK]);
  assert.equal(v.legs[0].kind, 'out');
  assert.equal(v.legs.at(-1).kind, 'home');
  assert.equal(v.legs.at(-1).date, LAST_DAY);
  const ferry = v.legs.find((l) => l.fromName === 'Koh Phi Phi' && l.toName === 'Koh Lanta');
  assert.equal(ferry.kind, 'ground', 'island hops stay on the water');
});

test('refuses impossible input with a message that says what to fix', async () => {
  const bad = await client.callTool({ name: 'create_trip', arguments: { ...THAILAND_TRIP, start: '2026-02-30' } });
  assert.equal(bad.isError, true);
  assert.match(JSON.stringify(bad.content), /calendar date/);
});

test('opens the planner on a trip, with its map for the view only', async () => {
  const r = await client.callTool({ name: 'open_planner', arguments: { trip_id: trip.id } });
  assert.equal(r.structuredContent.trip.id, trip.id);
  assert.equal(r.structuredContent.flights.live, false);
  const { map, mini } = r._meta;
  assert.ok(map.h > map.w, 'a trip down a coast gets a tall map');
  assert.deepEqual([mini.w, mini.h], [320, 200]);
  assert.match(map.land, /^M[\d.,-]+/);
  assert.equal(map.points.length, THAILAND_TRIP.stops.length);
  for (const [x, y] of map.points) assert.ok(x >= 0 && x <= map.w && y >= 0 && y <= map.h, 'every stop inside the frame');
  assert.deepEqual(map.points[0], map.points.at(-1), 'the trip ends where it began');
  assert.doesNotMatch(JSON.stringify(r.structuredContent), /"land"/, 'the coastline stays out of what the model reads');
  assert.equal(r.structuredContent.legs.find((l) => l.fromName === 'Koh Phi Phi').mode, 'ferry');
  assert.equal(r.structuredContent.legs.find((l) => l.fromName === 'Khao Sok').mode, 'road');
  const bad = await client.callTool({ name: 'open_planner', arguments: { trip_id: 'trp_nope' } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /list_trips/);
});

test('searches flights (demo) cheapest first, with real door-to-door times', async () => {
  const r = await client.callTool({ name: 'search_flights', arguments: { origin: 'KBV', destination: 'BKK', date: START, adults: 2 } });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const { fares } = r.structuredContent;
  assert.ok(fares.length >= 5);
  for (let i = 1; i < fares.length; i++) assert.ok(fares[i - 1].total <= fares[i].total);
  for (const f of fares) {
    const b = f.bounds[0];
    assert.equal(b.minutes, Math.round((Date.parse(b.arrives) - Date.parse(b.departs)) / 60000));
    assert.equal(f.total, f.perAdult * 2);
  }
  const same = await client.callTool({ name: 'search_flights', arguments: { origin: 'BKK', destination: 'bkk', date: START } });
  assert.equal(same.isError, true);
  const past = await client.callTool({ name: 'search_flights', arguments: { origin: 'KBV', destination: 'BKK', date: '2020-01-10' } });
  assert.match(past.content[0].text, /already passed/);
});

test('stops flight searches at the daily limit', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await client.callTool({ name: 'search_flights', arguments: { origin: 'HKT', destination: 'BKK', date: START } });
  assert.equal(last.isError, true, 'the limit is 6 here, and one search ran before');
  assert.match(last.content[0].text, /today's 6 flight searches/);
});

test('saves a chosen flight on an existing leg only', async () => {
  const r = await client.callTool({ name: 'choose_flight', arguments: { trip_id: trip.id, leg_key: KBV_BKK, summary: 'Thai AirAsia FD4403, 08:55 KBV → 10:30 DMK', price: 186, currency: 'eur', source: 'LetsFG' } });
  assert.ok(!r.isError, JSON.stringify(r.content));
  assert.deepEqual([r.structuredContent.trip.choices[KBV_BKK].price, r.structuredContent.trip.choices[KBV_BKK].currency, r.structuredContent.trip.choices[KBV_BKK].source], [186, 'EUR', 'LetsFG']);
  const wrong = await client.callTool({ name: 'choose_flight', arguments: { trip_id: trip.id, leg_key: 'leg|XXX|YYY|2026-01-01', summary: 'x', price: 1, currency: 'EUR' } });
  assert.equal(wrong.isError, true);
  assert.match(wrong.content[0].text, /Its legs are: .*leg\|KBV\|BKK/);
});

test('keeps local picks per place and merges by name', async () => {
  const pick = { name: 'Time for Lime', kind: 'food', why: 'Cooking school and dinner on Klong Dao beach, praised in recent threads.', source_url: 'https://www.reddit.com/r/Thailand/' };
  await client.callTool({ name: 'save_local_picks', arguments: { place: 'Koh Lanta', picks: [pick] } });
  await client.callTool({ name: 'save_local_picks', arguments: { place: 'koh lanta', picks: [{ ...pick, why: 'Updated note.' }, { ...pick, name: 'Mu Ko Lanta National Park', kind: 'view' }] } });
  const r = await client.callTool({ name: 'get_local_picks', arguments: { place: 'Koh Lanta' } });
  assert.equal(r.structuredContent.picks.length, 2);
  assert.equal(r.structuredContent.picks.find((p) => p.name === 'Time for Lime').why, 'Updated note.');
  const bad = await client.callTool({ name: 'save_local_picks', arguments: { place: 'Koh Lanta', picks: [{ name: 'No source', kind: 'food', why: 'x' }] } });
  assert.equal(bad.isError, true, 'a pick without a source link is refused');
});

test('finds airports by city or code', async () => {
  const r = await client.callTool({ name: 'find_airports', arguments: { query: 'krabi' } });
  assert.equal(r.structuredContent.airports[0].code, 'KBV');
  const c = await client.callTool({ name: 'find_airports', arguments: { query: 'bangkok' } });
  assert.ok(c.structuredContent.airports.map((a) => a.code).includes('DMK'));
});

test('changes a trip and lists trips', async () => {
  const r = await client.callTool({ name: 'update_trip', arguments: { trip_id: trip.id, adults: 3 } });
  assert.equal(r.structuredContent.trip.adults, 3);
  assert.equal(r.structuredContent.trip.choices[KBV_BKK].price, 186, 'the chosen flight stays');
  const l = await client.callTool({ name: 'list_trips', arguments: {} });
  assert.equal(l.structuredContent.trips[0].id, trip.id);
});

test('changes nights at one stop, and flags a flight whose date moved', async () => {
  const lanta = THAILAND_TRIP.stops.findIndex((x) => x.place === 'Koh Lanta');
  const r = await client.callTool({ name: 'set_nights', arguments: { trip_id: trip.id, stop: lanta, nights: 4 } });
  assert.ok(!r.isError, JSON.stringify(r.content));
  assert.equal(r.structuredContent.stops[lanta].nights, 4);
  assert.equal(r.structuredContent.trip.end, addDays(LAST_DAY, 1), 'the end moves a day');
  const leg = r.structuredContent.legs.find((l) => l.from === 'KBV' && l.to === 'BKK');
  assert.equal(leg.chosen, null);
  assert.deepEqual([leg.stale.date, leg.stale.price], [LAST_DAY, 186], 'the flight chosen for the old date is kept and flagged');
  const back = await client.callTool({ name: 'set_nights', arguments: { trip_id: trip.id, stop: lanta, nights: 3 } });
  assert.equal(back.structuredContent.legs.find((l) => l.key === KBV_BKK).chosen.price, 186, 'and it fits again once the date is back');
  const bad = await client.callTool({ name: 'set_nights', arguments: { trip_id: trip.id, stop: 19, nights: 1 } });
  assert.match(bad.content[0].text, /has 8 stops/);
});

test('marks a ferry booked with a note, and removes a chosen flight', async () => {
  const ferry = (await client.callTool({ name: 'open_planner', arguments: { trip_id: trip.id } })).structuredContent.legs.find((l) => l.mode === 'ferry');
  const m = await client.callTool({ name: 'mark_leg', arguments: { trip_id: trip.id, leg_key: ferry.key, booked: true, note: 'Ferry 11:30 from Tonsai pier' } });
  const marked = m.structuredContent.legs.find((l) => l.key === ferry.key);
  assert.deepEqual([marked.booked, marked.note], [true, 'Ferry 11:30 from Tonsai pier']);
  const c = await client.callTool({ name: 'clear_flight', arguments: { trip_id: trip.id, leg_key: KBV_BKK } });
  assert.equal(c.structuredContent.legs.find((l) => l.key === KBV_BKK).chosen, null);
  assert.equal((await client.callTool({ name: 'clear_flight', arguments: { trip_id: trip.id, leg_key: KBV_BKK } })).isError, true, 'nothing left to remove');
  await client.callTool({ name: 'choose_flight', arguments: { trip_id: trip.id, leg_key: KBV_BKK, summary: 'Thai AirAsia FD4403, 08:55 KBV → 10:30 DMK', price: 186, currency: 'EUR' } });
});

test('deletes one trip, then everything', async () => {
  const other = (await client.callTool({ name: 'create_trip', arguments: { name: 'Short', start: START, adults: 1, stops: [{ place: 'Ao Nang', nights: 2 }] } })).structuredContent.trip;
  const d = await client.callTool({ name: 'delete_trip', arguments: { trip_id: other.id } });
  assert.match(d.content[0].text, /Deleted the trip "Short"/);
  assert.equal((await client.callTool({ name: 'delete_trip', arguments: { trip_id: other.id } })).isError, true);
  const refused = await client.callTool({ name: 'delete_my_data', arguments: {} });
  assert.equal(refused.isError, true, 'needs confirm: true');
  const all = await client.callTool({ name: 'delete_my_data', arguments: { confirm: true } });
  assert.match(all.content[0].text, /Deleted 1 trip and the local picks for 1 place/);
  assert.equal((await client.callTool({ name: 'list_trips', arguments: {} })).structuredContent.trips.length, 0);
});
