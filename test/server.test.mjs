// Every tool, called the way Claude calls it: over HTTP through an MCP client.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, THAILAND_TRIP } from './helpers.mjs';

let srv, client, trip;
before(async () => { srv = await startServer(); client = await connect(srv.url); });
after(async () => { await client.close(); srv.server.close(); });

test('lists nine tools, each with a title and a read or write annotation', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['choose_flight', 'create_trip', 'find_airports', 'get_local_picks', 'list_trips', 'open_planner', 'save_local_picks', 'search_flights', 'update_trip']);
  for (const t of tools) {
    assert.ok(t.title, `${t.name} has a title`);
    assert.ok(t.annotations && ('readOnlyHint' in t.annotations || 'destructiveHint' in t.annotations), `${t.name} is annotated`);
  }
  const planner = tools.find((t) => t.name === 'open_planner');
  assert.equal(planner._meta.ui.resourceUri, 'ui://pinroute/planner');
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
  assert.equal(v.trip.end, '2026-11-28');
  assert.deepEqual(v.stops.map((s) => s.iata), ['BKK', 'URT', 'HKT', 'HKT', 'KBV', 'KBV', 'KBV', 'BKK']);
  assert.deepEqual(v.stops.map((s) => s.place), THAILAND_TRIP.stops.map((s) => s.place), 'stops keep the traveller\'s own names');
  const aoNang = v.legs.find((l) => l.fromName === 'Ao Nang' && l.toName === 'Bangkok');
  assert.equal(aoNang.kind, 'flight');
  assert.equal(aoNang.from, 'KBV');
  assert.equal(aoNang.to, 'BKK');
  assert.equal(aoNang.date, '2026-11-28');
  assert.equal(v.legs[0].kind, 'out');
  assert.equal(v.legs.at(-1).kind, 'home');
  assert.equal(v.legs.at(-1).date, '2026-11-28');
  const ferry = v.legs.find((l) => l.fromName === 'Koh Phi Phi' && l.toName === 'Koh Lanta');
  assert.equal(ferry.kind, 'ground', 'island hops stay on the water');
});

test('opens the planner on the newest trip', async () => {
  const r = await client.callTool({ name: 'open_planner', arguments: {} });
  assert.equal(r.structuredContent.trip.id, trip.id);
  assert.equal(r.structuredContent.flights.live, false);
  const bad = await client.callTool({ name: 'open_planner', arguments: { trip_id: 'trp_nope' } });
  assert.equal(bad.isError, true);
});

test('searches flights (demo) cheapest first, with real door-to-door times', async () => {
  const r = await client.callTool({ name: 'search_flights', arguments: { origin: 'KBV', destination: 'BKK', date: '2026-11-28', adults: 2 } });
  assert.ok(!r.isError);
  const { fares } = r.structuredContent;
  assert.ok(fares.length >= 5);
  for (let i = 1; i < fares.length; i++) assert.ok(fares[i - 1].total <= fares[i].total);
  for (const f of fares) {
    const b = f.bounds[0];
    assert.equal(b.minutes, Math.round((Date.parse(b.arrives) - Date.parse(b.departs)) / 60000));
    assert.equal(f.total, f.perAdult * 2);
  }
  const same = await client.callTool({ name: 'search_flights', arguments: { origin: 'BKK', destination: 'bkk', date: '2026-11-28' } });
  assert.equal(same.isError, true);
});

test('saves a chosen flight on the trip', async () => {
  const leg = 'leg|KBV|BKK|2026-11-28';
  const r = await client.callTool({ name: 'choose_flight', arguments: { trip_id: trip.id, leg_key: leg, summary: 'Thai AirAsia FD4403, 08:55 KBV → 10:30 BKK', price: 186, currency: 'EUR' } });
  assert.equal(r.structuredContent.trip.choices[leg].price, 186);
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
  const l = await client.callTool({ name: 'list_trips', arguments: {} });
  assert.equal(l.structuredContent.trips[0].id, trip.id);
});
