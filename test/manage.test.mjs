// What the traveller has in mind (wishes, a focus on part of a country) and looking after trips (other flights).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, addDays, START } from './helpers.mjs';

let srv, client;
before(async () => { srv = await startServer(); client = await connect(srv.url); });
after(async () => { await client.close(); srv.server.close(); });
const call = async (name, args = {}) => client.callTool({ name, arguments: args });
const FROM = addDays(START, 10), UNTIL = addDays(FROM, 21);

test('keeps the wishes and a focus on part of a country, with that area\'s airports', async () => {
  const r = await call('plan_new_trip', { free_from: FROM, free_until: UNTIL, home_airports: ['FRA'], country: 'Indonesia',
    wishes: 'Indonesia, but only Sulawesi; diving', focus: [{ country: 'Indonesia', area: 'Sulawesi', airports: ['upg', 'MDC'] }] });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const v = r.structuredContent;
  assert.equal(v.draft.wishes, 'Indonesia, but only Sulawesi; diving');
  assert.deepEqual(v.draft.focus['360'], { area: 'Sulawesi', airports: ['UPG', 'MDC'] });
  assert.deepEqual(v.arrivals['360'].map((a) => a.code), ['UPG', 'MDC'], 'arrivals are the focus airports only');
  assert.match(r.content[0].text, /The traveller's wishes: "Indonesia, but only Sulawesi; diving"\nFocus for Indonesia: Sulawesi \(fares to UPG, MDC\)\./);
  assert.match((await call('plan_new_trip', { focus: [{ country: 'Indonesia', area: 'Sulawesi', airports: [] }] })).content[0].text, /Give Sulawesi's airports/);
  assert.match((await call('plan_new_trip', { focus: [{ country: 'Indonesia', area: 'Sulawesi', airports: ['QQQ'] }] })).content[0].text, /No airport with the code QQQ/);
});

test('fares are looked up to the focus airports', async () => {
  const r = await call('scan_flight_deals', { country: 'Indonesia', dates: 1 });
  assert.ok(!r.isError, JSON.stringify(r.content));
  assert.deepEqual(r.structuredContent.searched.map((x) => `${x.from}>${x.to}`), ['FRA>UPG']);
});

let tripId;
test('a trip from a fare carries the wishes and the area, and is named after the area', async () => {
  const deal = (await call('plan_new_trip')).structuredContent.deals['360'][0];
  const r = await call('start_trip_from_flight', { deal_id: deal.id });
  const t = r.structuredContent.trip;
  tripId = t.id;
  assert.match(t.name, /^Sulawesi · /);
  assert.equal(t.wishes, 'Indonesia, but only Sulawesi; diving');
  assert.equal(t.area, 'Sulawesi');
  assert.match(r.content[0].text, /The traveller's wishes: "Indonesia, but only Sulawesi; diving"\./);
});

test('changing a trip\'s flights moves it to the fare: nights to the longest stay, airports fitted in', async () => {
  const t0 = (await call('open_planner', { trip_id: tripId })).structuredContent;
  const total = (Date.parse(t0.trip.end) - Date.parse(t0.trip.start)) / 864e5;
  await call('update_trip', { trip_id: tripId, stops: [
    { place: 'Makassar', nights: 2, airport: 'UPG' }, { place: 'Rantepao', nights: total - 4, lat: -2.97, lon: 119.9 },
    { place: 'Makassar', nights: 2, airport: 'UPG' }, { place: 'Makassar', nights: 0, airport: 'UPG' }] });
  const longer = { from: 'FRA', to: 'UPG', depart: addDays(FROM, 2), arrive: addDays(FROM, 3), return: addDays(FROM, 3 + total + 2), price: 1500, currency: 'EUR', adults: 2, airline: 'Garuda Indonesia', source: 'LetsFG' };
  const elsewhere = { ...longer, to: 'MDC', back_from: 'MDC', price: 1650, airline: 'Batik Air' };
  const tooShort = { ...longer, return: addDays(FROM, 5), price: 900 };
  await call('save_flight_deals', { country: 'Indonesia', deals: [longer, elsewhere, tooShort] });
  const saved = (await call('plan_new_trip')).structuredContent.deals['360'];
  const id = (price) => saved.find((x) => x.price === price).id;

  const r = await call('set_trip_fare', { trip_id: tripId, deal_id: id(1500) });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const v = r.structuredContent;
  assert.equal(v.trip.start, longer.arrive);
  assert.equal(v.trip.end, longer.return);
  assert.deepEqual(v.stops.map((x) => [x.place, x.nights]), [['Makassar', 2], ['Rantepao', total - 2], ['Makassar', 2], ['Makassar', 0]], 'two more nights in the longest stay');
  assert.equal(v.trip.ticket.airline, 'Garuda Indonesia');
  const parts = v.legs.filter((l) => l.chosen?.part).map((l) => [l.kind, l.chosen.part]);
  assert.deepEqual(parts, [['out', 'out'], ['home', 'return']]);
  assert.match(r.content[0].text, /now flies FRA → UPG .* The trip now runs /);

  const m = (await call('set_trip_fare', { trip_id: tripId, deal_id: id(1650) })).structuredContent;
  assert.deepEqual([m.stops[0].iata, m.stops[0].nights, m.stops.at(-1).iata, m.stops.at(-1).nights], ['MDC', 0, 'MDC', 0], 'Manado joins the route at both ends');
  assert.equal(m.legs.filter((l) => l.chosen?.part).length, 2);

  assert.match((await call('set_trip_fare', { trip_id: tripId, deal_id: id(900) })).content[0].text, /This fare gives 2 nights; the route needs at least 3/);
  assert.match((await call('set_trip_fare', { trip_id: tripId, deal_id: 'dl_nope' })).content[0].text, /No fare with id dl_nope/);
});

test('starting over keeps the airports and travellers, and drops the wishes and focus', async () => {
  const d = (await call('plan_new_trip', { reset: true })).structuredContent.draft;
  assert.deepEqual([d.homes, d.wishes, d.focus, d.country], [['FRA'], '', {}, null]);
});
