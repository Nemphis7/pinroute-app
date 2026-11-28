// Flight search options: filters, the cheapest-date calendar, and the Aviasales quote next to the airline fares.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, addDays, START } from './helpers.mjs';
import { fakeTravelpayouts } from './fake-travelpayouts.mjs';
import { applyFilters, sortFares, dedupe, facets, carriersOf } from '../src/flightfilter.mjs';
import { buildUrl } from '../src/providers/amadeus.mjs';

const fl = (carrier, num, from, to, departs, arrives) => ({ carrier, number: `${carrier}${num}`, from, to, departs, arrives });
const fare = (id, total, merchant, airline, bounds) => ({ id, total, merchant, airline, currency: 'EUR', bounds });
const bound = (flights, bags = null) => ({
  from: flights[0].from, to: flights.at(-1).to, departs: flights[0].departs, arrives: flights.at(-1).arrives,
  minutes: Math.round((Date.parse(flights.at(-1).arrives) - Date.parse(flights[0].departs)) / 60000), stops: flights.length - 1, flights, bags,
});
const FARES = [
  fare('a', 500, 'QR', 'Qatar Airways', [bound([fl('QR', 70, 'FRA', 'DOH', '2027-03-01T21:10:00+01:00', '2027-03-02T05:40:00+03:00'), fl('QR', 830, 'DOH', 'BKK', '2027-03-02T07:30:00+03:00', '2027-03-02T18:20:00+07:00')], '2 checked bags included')]),
  fare('b', 640, 'TG', 'Thai Airways', [bound([fl('TG', 921, 'FRA', 'BKK', '2027-03-01T13:30:00+01:00', '2027-03-02T05:45:00+07:00')], '1 checked bag included')]),
  fare('c', 455, 'EK', 'Emirates', [bound([fl('EK', 46, 'FRA', 'DXB', '2027-03-01T06:00:00+01:00', '2027-03-01T14:00:00+04:00'), fl('EK', 384, 'DXB', 'BKK', '2027-03-01T22:00:00+04:00', '2027-03-02T07:30:00+07:00')])]),
];

test('filters: direct only, times, airlines by code or name, bags, hours and price', () => {
  const ids = (q) => applyFilters(FARES, q).map((f) => f.id).sort().join('');
  assert.equal(ids({}), 'abc');
  assert.equal(ids({ max_stops: 0 }), 'b');
  assert.equal(ids({ max_stops: 1 }), 'abc');
  assert.equal(ids({ depart_after: '09:00' }), 'ab');
  assert.equal(ids({ depart_before: '14:00' }), 'bc');
  assert.equal(ids({ arrive_before: '07:00' }), 'b');
  assert.equal(ids({ airlines: ['QR'] }), 'a');
  assert.equal(ids({ airlines: ['thai'] }), 'b');
  assert.equal(ids({ exclude_airlines: ['EK', 'Qatar'] }), 'b');
  assert.equal(ids({ bag_included: true }), 'ab', 'a fare with no bag stated is not one with a bag');
  assert.equal(ids({ max_hours: 15 }), 'b');
  assert.equal(ids({ max_hours: 16 }), 'ab');
  assert.equal(ids({ max_price: 500 }), 'ac');
  assert.deepEqual(carriersOf(FARES[0]), ['QR']);
});

test('sorting, duplicates and facets', () => {
  assert.deepEqual(sortFares(FARES).map((f) => f.id), ['c', 'a', 'b']);
  assert.deepEqual(sortFares(FARES, 'duration').map((f) => f.id), ['b', 'a', 'c']);
  assert.deepEqual(sortFares(FARES, 'departure').map((f) => f.id), ['c', 'b', 'a']);
  assert.equal(sortFares(FARES, 'best')[0].id, 'a', 'a 15-hour trip beats a cheaper 19-hour one on best');
  assert.equal(dedupe([...FARES, { ...FARES[0], id: 'a2', total: 480 }]).find((f) => f.bounds[0].flights[0].number === 'QR70').total, 480);
  const fc = facets(FARES);
  assert.deepEqual(fc.stops, { 0: 640, 1: 455 });
  assert.deepEqual(fc.price, { min: 455, max: 640, currency: 'EUR' });
  assert.deepEqual(fc.airlines.map((a) => a.code), ['EK', 'QR', 'TG']);
  assert.equal(fc.bagIncluded, 2);
});

test('the Amadeus request carries children, infants and the nonstop hint', () => {
  const u = new URL(buildUrl({ origin: 'FRA', destination: 'BKK', date: '2027-03-01', adults: 2, children: 1, infants: 1, nonstop: true }, 'https://api.amadeus.com'));
  assert.deepEqual(['adults', 'children', 'infants', 'nonstop', 'number_of_results'].map((k) => u.searchParams.get(k)), ['2', '1', '1', 'true', '20']);
});

let fake, srv, client;
before(async () => {
  fake = await fakeTravelpayouts();
  srv = await startServer(null, { TRAVELPAYOUTS_API_URL: fake.url, TRAVELPAYOUTS_TOKEN: 'tp-test', AVIASALES_PRICES: 'on', TRAVELPAYOUTS_MARKER: '123456', TRAVELPAYOUTS_TRS: '987', SEARCH_LIMIT_PER_DAY: '30' });
  client = await connect(srv.url);
});
after(async () => { await client.close(); srv.server.close(); fake.close(); });
const call = async (name, args = {}) => client.callTool({ name, arguments: args });

test('a search applies the filters and says which', async () => {
  const all = await call('search_flights', { origin: 'FRA', destination: 'BKK', date: START });
  const direct = await call('search_flights', { origin: 'FRA', destination: 'BKK', date: START, max_stops: 0 });
  assert.ok(!direct.isError, JSON.stringify(direct.content));
  assert.ok(direct.structuredContent.fares.every((f) => f.bounds.every((b) => b.stops === 0)));
  assert.ok(direct.structuredContent.fares.length < all.structuredContent.fares.length);
  assert.match(direct.content[0].text, /direct only/);
  assert.equal(direct.structuredContent.facets.count, all.structuredContent.facets.count, 'facets describe every offer, so a filter bar can undo a filter');
  const morning = await call('search_flights', { origin: 'FRA', destination: 'BKK', date: START, depart_before: '12:00', sort: 'departure' });
  const times = morning.structuredContent.fares.map((f) => f.bounds[0].departs.slice(11, 16));
  assert.ok(times.every((t) => t <= '12:00'));
  assert.deepEqual(times, times.slice().sort());
  const bad = await call('search_flights', { origin: 'FRA', destination: 'BKK', date: START, adults: 1, infants: 2 });
  assert.match(bad.content[0].text, /one infant per adult/);
});

test('both quotes: the airline fare next to the Aviasales price, with a partner link', async () => {
  const back = addDays(START, 12);
  const r = await call('search_flights', { origin: 'FRA', destination: 'BKK', date: START, return_date: back, adults: 2 });
  const { compare } = r.structuredContent;
  assert.equal(compare.aviasales.total, 666, '333 per adult from the stand-in, times 2');
  assert.equal(compare.aviasales.airline, 'VietJet Air');
  assert.match(compare.aviasales.link, /^https:\/\/aviasales\.tp\.st\//);
  assert.ok(compare.amadeus.total > 0);
  assert.equal(compare.cheaper, compare.amadeus.total < 666 ? 'amadeus' : 'aviasales');
  assert.match(r.content[0].text, /Aviasales: EUR 666/);
  const q = fake.calls.filter((c) => c.path === '/aviasales/v3/prices_for_dates').at(-1).query;
  assert.deepEqual([q.departure_at, q.return_at, q.one_way], [START, back, 'false']);
  const direct = await call('search_flights', { origin: 'FRA', destination: 'BKK', date: START, return_date: back, max_stops: 0 });
  assert.equal(direct.structuredContent.compare.aviasales, null, 'the Aviasales fare has a change, so a direct-only search leaves it out');
  assert.ok(direct.structuredContent.compare.aviasales_link, 'the Aviasales search link stays, to compare there');
});

test('flex_days searches the days around and finds the cheapest date', async () => {
  const r = await call('search_flights', { origin: 'FRA', destination: 'BKK', date: START, return_date: addDays(START, 10), flex_days: 2 });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const { calendar, cheapest, fares } = r.structuredContent;
  assert.deepEqual(calendar.map((c) => c.date), [-2, -1, 0, 1, 2].map((n) => addDays(START, n)));
  assert.ok(calendar.every((c) => c.return_date === addDays(c.date, 10)), 'the trip keeps its length');
  assert.equal(cheapest.best, Math.min(...calendar.map((c) => c.best)));
  assert.ok(calendar.every((c) => c.aviasales === 333), 'an Aviasales quote for each date');
  assert.ok(fares.some((f) => f.date !== START), 'cheaper offers from nearby days are listed too');
  assert.match(r.content[0].text, /Cheapest date: /);
  assert.equal(r.structuredContent.searches_left, 30 - 5 - 4, 'the date asked for was searched just before, so it comes from the cache');
});
