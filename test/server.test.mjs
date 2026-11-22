// Every tool, called the way Claude calls it: over HTTP through an MCP client (sign-in off: one local owner).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, THAILAND_TRIP, START, LAST_DAY, KBV_BKK } from './helpers.mjs';

let srv, client, trip;
before(async () => { srv = await startServer(null, { SEARCH_LIMIT_PER_DAY: '6' }); client = await connect(srv.url); });
after(async () => { await client.close(); srv.server.close(); });

const TOOLS = ['choose_flight', 'create_trip', 'delete_my_data', 'delete_trip', 'find_airports', 'get_local_picks', 'list_trips', 'open_planner', 'save_local_picks', 'search_flights', 'update_trip'];

test('lists eleven tools, each with a title and the right read or write annotation', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS);
  for (const t of tools) {
    assert.ok(t.title && t.annotations?.title, `${t.name} has a title`);
    assert.ok(t.name.length <= 64);
    const read = t.annotations.readOnlyHint === true;
    assert.ok(read || 'destructiveHint' in t.annotations, `${t.name} declares read-only or destructive`);
    if (/^delete_|^update_/.test(t.name)) assert.equal(t.annotations.destructiveHint, true, `${t.name} is destructive`);
    if (/^(get|list|find|open|search)_/.test(t.name)) assert.equal(read, true, `${t.name} is read-only`);
  }
  assert.equal(tools.find((t) => t.name === 'open_planner')._meta.ui.resourceUri, 'ui://pinroute/planner');
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

test('opens the planner on the newest trip', async () => {
  const r = await client.callTool({ name: 'open_planner', arguments: {} });
  assert.equal(r.structuredContent.trip.id, trip.id);
  assert.equal(r.structuredContent.flights.live, false);
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
