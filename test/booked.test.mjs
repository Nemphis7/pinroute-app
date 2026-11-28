// Flights the traveller booked themselves: a new trip from them, a trip fitted to them, one leg booked, the calendar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, addDays, START } from './helpers.mjs';

let srv, client;
before(async () => { srv = await startServer(null, { PUBLIC_URL: 'https://pinroute.example' }); client = await connect(srv.url); });
after(async () => { await client.close(); srv.server.close(); });
const call = async (name, args = {}) => client.callTool({ name, arguments: args });

const OUT = addDays(START, 20), BACK = addDays(OUT, 15);
let tripId;

test('a new trip from booked flights: lands the next day, home on the return day, both legs booked', async () => {
  await call('plan_new_trip', { reset: true, wishes: 'beaches and food' });
  const r = await call('add_booked_flight', {
    out: { from: 'FRA', to: 'SGN', date: OUT, departs: '21:10', arrives: '13:40', arrive_date: addDays(OUT, 1), number: 'QR 70' },
    back: { from: 'HAN', to: 'FRA', date: BACK, departs: '23:30', arrives: '6:05', number: 'VN 37' },
    booking_ref: 'XK7P2Q',
  });
  assert.ok(!r.isError, r.content?.[0]?.text);
  const v = r.structuredContent;
  tripId = v.trip.id;
  assert.equal(v.trip.start, addDays(OUT, 1));
  assert.equal(v.trip.end, BACK);
  assert.equal(v.trip.country, 'Vietnam');
  assert.equal(v.trip.wishes, 'beaches and food');
  assert.equal(v.trip.ticket.own, true);
  const out = v.legs.find((l) => l.kind === 'out'), home = v.legs.find((l) => l.kind === 'home');
  assert.equal(out.booked, true);
  assert.equal(home.booked, true);
  assert.equal(out.note, 'Booking reference XK7P2Q');
  assert.equal(out.chosen.summary, 'Qatar Airways QR 70, 21:10 FRA → 13:40 SGN (+1)');
  assert.equal(out.chosen.own, true);
  assert.equal(out.chosen.price, null);
  assert.equal(home.chosen.summary, 'Vietnam Airlines VN 37, 23:30 HAN → 06:05 FRA');
  assert.deepEqual(v.stops.map((s) => s.iata), ['SGN', 'HAN']);
  const dr = (await call('plan_new_trip', {})).structuredContent.draft;
  assert.equal(dr.booked.trip, tripId, 'the draft points to the trip, so an open planner can follow');
});

test('the calendar has the booked flights at their times', async () => {
  const r = await call('calendar_link', { trip_id: tripId });
  assert.ok(!r.isError, r.content?.[0]?.text);
  const ics = (await (await fetch(r.structuredContent.links.ics.replace('https://pinroute.example', srv.base))).text()).replace(/\r\n /g, '');
  assert.match(ics, new RegExp(`DTSTART:${OUT.replace(/-/g, '')}T211000`));
  assert.match(ics, new RegExp(`DTEND:${addDays(OUT, 1).replace(/-/g, '')}T134000`));
});

test('a later flight home moves the end; the flight out stays booked', async () => {
  const later = addDays(BACK, 2);
  const r = await call('add_booked_flight', { trip_id: tripId, back: { from: 'HAN', to: 'FRA', date: later, departs: '23:30', arrives: '06:05', number: 'VN 37' } });
  assert.ok(!r.isError, r.content?.[0]?.text);
  const v = r.structuredContent;
  assert.equal(v.trip.end, later);
  assert.equal(v.legs.find((l) => l.kind === 'out').booked, true);
  assert.equal(v.legs.find((l) => l.kind === 'out').chosen.own, true);
  assert.equal(v.legs.find((l) => l.kind === 'home').chosen.summary, 'Vietnam Airlines VN 37, 23:30 HAN → 06:05 FRA');
});

test('one flight between stops, on the leg\'s day; another day is refused', async () => {
  const t = (await call('update_trip', { trip_id: tripId, stops: [{ place: 'Ho Chi Minh City', nights: 5, airport: 'SGN', lat: 10.8, lon: 106.7 }, { place: 'Hanoi', nights: 12, airport: 'HAN', lat: 21.03, lon: 105.85 }] })).structuredContent;
  const leg = t.legs.find((l) => l.kind === 'flight');
  assert.ok(leg, 'SGN → HAN is a flight');
  const wrong = await call('add_booked_flight', { trip_id: tripId, leg_key: leg.key, out: { from: 'SGN', to: 'HAN', date: addDays(leg.date, 1), departs: '08:00', arrives: '10:10' } });
  assert.ok(wrong.isError);
  assert.match(wrong.content[0].text, /set_nights/);
  const r = await call('add_booked_flight', { trip_id: tripId, leg_key: leg.key, out: { from: 'SGN', to: 'HAN', date: leg.date, departs: '08:00', arrives: '10:10', number: 'VJ 120' }, price: 95, currency: 'EUR' });
  assert.ok(!r.isError, r.content?.[0]?.text);
  const l = r.structuredContent.legs.find((x) => x.key === leg.key);
  assert.equal(l.booked, true);
  assert.equal(l.chosen.price, 95);
  assert.match(l.chosen.summary, /08:00 SGN → 10:10 HAN/);
});

test('a one-way booking with nights; the flight home is still to choose', async () => {
  const r = await call('add_booked_flight', { out: { from: 'MUC', to: 'BKK', date: OUT, departs: '15:00', arrives: '07:00', arrive_date: addDays(OUT, 1) }, nights: 10 });
  assert.ok(!r.isError, r.content?.[0]?.text);
  const v = r.structuredContent;
  assert.equal(v.trip.end, addDays(OUT, 11));
  const home = v.legs.find((l) => l.kind === 'home');
  assert.ok(home && !home.chosen && !home.booked);
  assert.ok((await call('add_booked_flight', { out: { from: 'MUC', to: 'BKK', date: OUT } })).isError, 'no flight home and no nights');
  assert.ok((await call('add_booked_flight', { out: { from: 'MUC', to: 'ZZZ', date: OUT }, nights: 3 })).isError, 'unknown airport');
});
