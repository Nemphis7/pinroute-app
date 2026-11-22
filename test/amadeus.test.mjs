// The Amadeus adapter against the example response in Amadeus's own guide (London–Paris return, BA).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUrl, mapResult, searchFlights } from '../src/providers/amadeus.mjs';

const SAMPLE = {
  request_id: 'req-1',
  results: [{
    bounds: [
      { duration: '01:15', flights: [{ marketing_airline: 'BA', flight_number: '322', origin: { airport: 'LHR', terminal: '5' }, destination: { airport: 'CDG', terminal: '2C' },
        departs_at: '2027-01-03T21:00:00Z', arrives_at: '2027-01-03T23:15:00+01:00', duration: '01:15',
        booking_infos: [{ ptc: 'ADT', priced_ptc: 'ADT', travel_class: 'ECONOMY', cabin_code: 'M', booking_code: 'N', fare_basis: 'NZ0R', fare_breakpoint: true, seats_remaining: 4 }] }],
        included_checked_bags: [{ applicable_legs: [1], type: 'piece', quantity: 1 }] },
      { duration: '01:10', flights: [{ marketing_airline: 'BA', flight_number: '315', origin: { airport: 'CDG', terminal: '2C' }, destination: { airport: 'LHR', terminal: '5' },
        departs_at: '2027-01-10T18:50:00+01:00', arrives_at: '2027-01-10T19:00:00Z', duration: '01:10',
        booking_infos: [{ ptc: 'ADT', priced_ptc: 'ADT', travel_class: 'ECONOMY', cabin_code: 'M', booking_code: 'N', fare_basis: 'NZ0R', fare_breakpoint: true }] }] },
    ],
    fare: { currency: 'GBP', itinerary_price: { total_fare: 186.51, tax: 93.51 }, price_per_adult: { total_fare: 186.51, tax: 93.51 } },
    merchant: 'BA', deep_link: 'https://example.com/ba-offer',
  }],
  errors: { TU: '120 - No flight found on this route for merchant TU' },
  meta: { carriers: { BA: { name: 'British Airways', debug_info: [] } } },
};

test('builds the positional lists for a return search', () => {
  const u = new URL(buildUrl({ origin: 'lon', destination: 'PAR', date: '2027-01-03', returnDate: '2027-01-10', adults: 2 }, 'https://api.amadeus.com'));
  assert.equal(u.pathname, '/api/v3/search/');
  assert.equal(u.searchParams.get('origins'), 'LON,PAR');
  assert.equal(u.searchParams.get('destinations'), 'PAR,LON');
  assert.equal(u.searchParams.get('dates'), '2027-01-03,2027-01-10');
  assert.equal(u.searchParams.get('flow'), 'NETWORK');
  assert.equal(u.searchParams.get('adults'), '2');
  assert.equal(u.searchParams.get('travel_class'), 'ECONOMY');
  assert.equal(u.searchParams.get('nonstop'), null);
});

test('maps an offer: local times kept, durations from the offsets, bags, link', () => {
  const f = mapResult(SAMPLE.results[0], 0, SAMPLE.meta.carriers);
  assert.equal(f.airline, 'British Airways');
  assert.equal(f.total, 186.51);
  assert.equal(f.currency, 'GBP');
  assert.equal(f.bounds[0].departs, '2027-01-03T21:00:00Z');
  assert.equal(f.bounds[0].arrives, '2027-01-03T23:15:00+01:00');
  assert.equal(f.bounds[0].minutes, 75);
  assert.equal(f.bounds[1].minutes, 70);
  assert.equal(f.bounds[0].bags, '1 checked bag included');
  assert.equal(f.bounds[1].bags, null);
  assert.equal(f.bagsIncluded, null, 'one way without a stated bag is not "included"');
  assert.equal(f.seatsLeft, 4);
  assert.equal(f.link, 'https://example.com/ba-offer');
});

test('searches with the key in a header and reports airlines without offers', async () => {
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return new Response(JSON.stringify(SAMPLE), { status: 200 }); };
  const r = await searchFlights({ origin: 'LON', destination: 'PAR', date: '2027-01-03', returnDate: '2027-01-10' }, { fetchImpl, env: { AMADEUS_API_KEY: 'k' } });
  assert.equal(seen.opts.headers['X-API-Key'], 'k');
  assert.equal(r.fares.length, 1);
  assert.match(r.note, /1 airline had no offer/);
});

test('explains refusals and rate limits', async () => {
  const msg = JSON.stringify({ message: JSON.stringify({ adults: 'must be between 0 and 9' }) });
  await assert.rejects(searchFlights({ origin: 'LON', destination: 'PAR', date: '2027-01-03', adults: 12 }, { fetchImpl: async () => new Response(msg, { status: 400 }), env: { AMADEUS_API_KEY: 'k' } }), /adults: must be between 0 and 9/);
  await assert.rejects(searchFlights({ origin: 'LON', destination: 'PAR', date: '2027-01-03' }, { fetchImpl: async () => new Response('{}', { status: 429 }), env: { AMADEUS_API_KEY: 'k' } }), (e) => e.code === 'rate_limited');
  await assert.rejects(searchFlights({ origin: 'LON', destination: 'PAR', date: '2027-01-03' }, { env: {} }), (e) => e.code === 'no_key');
  const down = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  await assert.rejects(searchFlights({ origin: 'LON', destination: 'PAR', date: '2027-01-03' }, { fetchImpl: down, env: { AMADEUS_API_KEY: 'k' } }), (e) => e.code === 'network' && /ECONNREFUSED/.test(e.message));
});
