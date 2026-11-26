// Airlines by name, not by code: the lookup itself, the fare sources that send codes, and every tool result that
// shows a fare: deals saved by Claude, recent prices, a trip's return fare and a flight chosen for a leg, also when
// they were saved with a bare code before names were added.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, addDays, START } from './helpers.mjs';
import { AIRLINES, airlineName, withAirlineName, namedFare } from '../src/airlines.mjs';
import { mapEntry } from '../src/providers/travelpayouts.mjs';
import { mapResult } from '../src/providers/amadeus.mjs';
import * as store from '../src/store.mjs';

let srv, client;
before(async () => { srv = await startServer(); client = await connect(srv.url); });
after(async () => { await client.close(); srv.server.close(); });
const call = async (name, args = {}) => client.callTool({ name, arguments: args });
const FROM = addDays(START, 10);

test('a code becomes the airline\'s name; names and codes not listed stay as they are', () => {
  assert.equal(airlineName('VJ'), 'VietJet Air');
  assert.equal(airlineName('tg'), 'Thai Airways', 'any case');
  assert.equal(airlineName(' U2 '), 'easyJet', 'codes with a digit');
  assert.equal(airlineName('6E'), 'IndiGo', 'codes starting with a digit');
  assert.equal(airlineName('QR, EK'), 'Qatar Airways, Emirates', 'a fare on two airlines');
  assert.equal(airlineName('FD/FD'), 'Thai AirAsia', 'each airline once');
  assert.equal(airlineName('Qatar Airways'), 'Qatar Airways');
  assert.equal(airlineName('Several airlines'), 'Several airlines');
  assert.equal(airlineName('Q9'), 'Q9', 'an unknown code is better than a wrong name');
  assert.equal(airlineName('VJ, Q9'), 'VietJet Air, Q9');
  assert.equal(airlineName('42'), '42', 'two digits are not an airline code');
  assert.equal(airlineName(''), '');
});

test('every code in the list is two letters or digits, with one name each', () => {
  const codes = Object.keys(AIRLINES);
  assert.ok(codes.length >= 200, `${codes.length} airlines`);
  for (const c of codes) {
    assert.match(c, /^[A-Z0-9]{2}$/, c);
    assert.match(c, /[A-Z]/, c);
    assert.ok(AIRLINES[c].length >= 2 && AIRLINES[c].length <= 40 && !/[|\n]/.test(AIRLINES[c]), `${c}: "${AIRLINES[c]}"`);
  }
  // the airlines most of Pinroute's trips fly
  for (const [c, n] of [['TG', 'Thai Airways'], ['FD', 'Thai AirAsia'], ['PG', 'Bangkok Airways'], ['VN', 'Vietnam Airlines'], ['LH', 'Lufthansa'],
    ['QR', 'Qatar Airways'], ['EK', 'Emirates'], ['TK', 'Turkish Airlines'], ['FR', 'Ryanair'], ['W6', 'Wizz Air'], ['SQ', 'Singapore Airlines'], ['DE', 'Condor']]) {
    assert.equal(AIRLINES[c], n);
  }
});

test('a flight line that starts with a flight number gets the name in front', () => {
  assert.equal(withAirlineName('QR 70, 21:10 FRA → 13:40 SGN'), 'Qatar Airways QR 70, 21:10 FRA → 13:40 SGN');
  assert.equal(withAirlineName('FD3021, 07:00 BKK → 08:20 KBV'), 'Thai AirAsia FD3021, 07:00 BKK → 08:20 KBV');
  assert.equal(withAirlineName('Qatar Airways QR 70, 21:10 FRA → 13:40 SGN'), 'Qatar Airways QR 70, 21:10 FRA → 13:40 SGN', 'named already');
  assert.equal(withAirlineName('21:10 FRA → 13:40 SGN'), '21:10 FRA → 13:40 SGN', 'a time is not a flight number');
  assert.equal(withAirlineName('Q9 123, 10:00 FRA → BKK'), 'Q9 123, 10:00 FRA → BKK', 'unknown code');
  assert.equal(withAirlineName(''), '');
  const x = namedFare({ airline: 'TG', out: 'TG 923, 13:05 FRA → 05:50 BKK', back: null, price: 900 });
  assert.deepEqual(x, { airline: 'Thai Airways', out: 'Thai Airways TG 923, 13:05 FRA → 05:50 BKK', back: null, price: 900 });
});

test('fare sources: recent prices name the airline and keep the flight number; Amadeus falls back to the name', () => {
  const f = mapEntry({ origin: 'FRA', destination: 'SGN', price: 290, airline: 'VJ', flight_number: '58', departure_at: '2027-03-02T10:15:00+01:00', return_at: '2027-03-13T21:40:00+07:00', transfers: 1, return_transfers: 1 });
  assert.equal(f.airline, 'VietJet Air');
  assert.match(f.out, /^VietJet Air VJ 58, 10:15 FRA → SGN, 1 change$/);
  assert.equal(mapEntry({ origin: 'FRA', destination: 'SGN', price: 290, departure_at: '2027-03-02T10:15:00' }).airline, 'Several airlines');
  const r = { merchant: 'TG', fare: { itinerary_price: { total_fare: 900 } }, bounds: [] };
  assert.equal(mapResult(r, 0, {}).airline, 'Thai Airways', 'no carrier list');
  assert.equal(mapResult(r, 0, { TG: { name: 'THAI' } }).airline, 'THAI', 'Amadeus\'s own name wins');
  assert.equal(mapResult(r, 0, {}).merchant, 'TG', 'the code is kept beside the name');
});

test('deals Claude saves with codes come back with names, in the planner and in the text', async () => {
  await call('plan_new_trip', { free_from: FROM, free_until: addDays(FROM, 21), adults: 2, home_airports: ['FRA'], compare: ['Thailand'], step: 'flights' });
  const fare = { from: 'FRA', to: 'BKK', depart: addDays(FROM, 1), return: addDays(FROM, 12), price: 1240, currency: 'EUR', airline: 'TG',
    out: 'TG 923, 13:05 FRA → 05:50 BKK', back: 'TG 922, 23:45 BKK → 06:40 FRA', stops: 0, source: 'Kiwi.com' };
  const r = await call('save_flight_deals', { country: 'Thailand', deals: [fare] });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const [x] = r.structuredContent.deals;
  assert.equal(x.airline, 'Thai Airways');
  assert.equal(x.out, 'Thai Airways TG 923, 13:05 FRA → 05:50 BKK');
  assert.equal(x.back, 'Thai Airways TG 922, 23:45 BKK → 06:40 FRA');
  assert.match(r.content[0].text, /, Thai Airways, direct, via Kiwi\.com/);
  assert.doesNotMatch(r.content[0].text, /, TG,/);
  const view = (await call('plan_new_trip')).structuredContent;
  assert.equal(view.deals['764'][0].airline, 'Thai Airways');
});

test('fares saved with a bare code earlier show by name, and a trip started from one keeps the name', async () => {
  // a draft written before names were added: the code is in the database (countries go by their ISO number)
  store.updateDraft(store.LOCAL, (cur) => ({ ...cur, deals: { ...cur.deals, 704: [{
    id: 'dl_oldcode', country: '704', from: 'FRA', to: 'SGN', back_from: 'SGN', depart: addDays(FROM, 2), arrive: addDays(FROM, 3), return: addDays(FROM, 13),
    price: 1100, currency: 'EUR', adults: 2, airline: 'VN', out: 'VN 30, 22:10 FRA → 16:05 SGN', back: null, stops: 0, source: 'Aviasales', recent: true, at: new Date().toISOString(), km: 9700 }] } }));
  const draft = await call('plan_new_trip', { compare: ['Thailand', 'Vietnam'] });
  const old = draft.structuredContent.deals['704'].find((x) => x.id === 'dl_oldcode');
  assert.equal(old.airline, 'Vietnam Airlines');
  assert.equal(old.out, 'Vietnam Airlines VN 30, 22:10 FRA → 16:05 SGN');
  assert.match(draft.content[0].text, /Best fare for Vietnam: .*Vietnam Airlines, direct/);

  const t = await call('start_trip_from_flight', { deal_id: 'dl_oldcode' });
  assert.ok(!t.isError, JSON.stringify(t.content));
  const v = t.structuredContent;
  assert.equal(v.trip.ticket.airline, 'Vietnam Airlines');
  assert.equal(v.legs.find((l) => l.kind === 'out').chosen.summary, 'Vietnam Airlines VN 30, 22:10 FRA → 16:05 SGN');
  assert.equal(v.legs.find((l) => l.kind === 'home').chosen.summary, 'Vietnam Airlines, SGN → FRA');

  // a leg's flight saved with a bare flight number, then the trip read back
  const trip = (await call('create_trip', { name: 'Hop', start: START, adults: 2, stops: [{ place: 'Krabi', nights: 2 }, { place: 'Bangkok', nights: 1 }] })).structuredContent;
  const leg = trip.legs.find((l) => l.mode === 'flight');
  const c = await call('choose_flight', { trip_id: trip.trip.id, leg_key: leg.key, summary: 'FD 3104, 11:40 KBV → 12:55 DMK', price: 64, currency: 'EUR', source: 'Kiwi.com' });
  assert.match(c.content[0].text, /: Thai AirAsia FD 3104, 11:40 KBV → 12:55 DMK \(EUR 64\)/);
  const t2 = store.getTrip(store.LOCAL, trip.trip.id);
  store.putTrip(store.LOCAL, { ...t2, choices: { [leg.key]: { ...t2.choices[leg.key], summary: 'PG 262, 11:40 KBV → 12:55 BKK' } } });
  const back = (await call('open_planner', { trip_id: trip.trip.id })).structuredContent;
  assert.equal(back.legs.find((l) => l.key === leg.key).chosen.summary, 'Bangkok Airways PG 262, 11:40 KBV → 12:55 BKK');
});
