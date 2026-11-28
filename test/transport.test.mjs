// Ferries, buses and trains between stops: booking searches for a ground leg's day (12Go in Asia, Omio in Europe,
// Rome2Rio everywhere) as partner links, the options saved for a leg and the one the traveller picks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, THAILAND_TRIP, START } from './helpers.mjs';
import { fakeTravelpayouts } from './fake-travelpayouts.mjs';
import * as transport from '../src/transport.mjs';
import * as cal from '../src/calendar.mjs';

let fake, srv, client, trip, ferry;
before(async () => {
  fake = await fakeTravelpayouts();
  srv = await startServer(null, { TRAVELPAYOUTS_API_URL: fake.url, TRAVELPAYOUTS_TOKEN: 'tp-test', TRAVELPAYOUTS_MARKER: '123456', TRAVELPAYOUTS_TRS: '987' });
  client = await connect(srv.url);
  const r = await client.callTool({ name: 'create_trip', arguments: THAILAND_TRIP });
  trip = r.structuredContent.trip;
  ferry = r.structuredContent.legs.find((l) => l.fromName === 'Koh Phi Phi' && l.toName === 'Koh Lanta');
});
after(async () => { await client.close(); srv.server.close(); fake.close(); });
const call = async (name, args = {}) => client.callTool({ name, arguments: args });

test('booking searches follow the part of the world: 12Go in Asia, Omio in Europe, Rome2Rio everywhere', () => {
  assert.equal(transport.slug('Koh Phi Phi (Tonsai)'), 'koh-phi-phi');
  assert.equal(transport.slug('Hội An, Vietnam'), 'hoi-an');
  const asia = transport.searchSites({ from: 'Krabi', to: 'Koh Lanta', date: '2027-01-10', adults: 2, country: 'Thailand' });
  assert.deepEqual(asia.map((x) => x.site), ['12Go', 'Rome2Rio']);
  assert.equal(asia[0].url, 'https://12go.asia/en/travel/krabi/koh-lanta?date=2027-01-10&people=2');
  assert.equal(asia[1].url, 'https://www.rome2rio.com/map/Krabi/Koh-Lanta');
  const europe = transport.searchSites({ from: 'Florence', to: 'Rome', date: '2027-05-02', adults: 1, country: 'Italy' });
  assert.deepEqual(europe.map((x) => x.site), ['Omio', 'Rome2Rio']);
  assert.equal(europe[0].url, 'https://www.omio.com/trains/florence/rome');
  assert.deepEqual(transport.searchSites({ from: 'Cusco', to: 'Puno', date: '2027-05-02', country: 'Peru' }).map((x) => x.site), ['Rome2Rio']);
});

test('finds where to book a ferry leg of a trip, for its day, as partner links', async () => {
  assert.ok(ferry && ferry.mode === 'ferry', 'the Thailand trip has a ferry from Koh Phi Phi to Koh Lanta');
  const r = await call('find_transport', { trip_id: trip.id, leg_key: ferry.key });
  assert.equal(r.isError, undefined, r.content[0].text);
  const s = r.structuredContent;
  assert.deepEqual([s.leg.from, s.leg.to, s.leg.date, s.leg.country, s.leg.adults], ['Koh Phi Phi', 'Koh Lanta', ferry.date, 'Thailand', 2]);
  assert.deepEqual(s.sites.map((x) => x.site), ['12Go', 'Rome2Rio']);
  assert.ok(s.sites[0].url.startsWith('https://aviasales.tp.st/'), '12Go becomes a partner link');
  assert.equal(s.sites[1].url, 'https://www.rome2rio.com/map/Koh-Phi-Phi/Koh-Lanta', 'Rome2Rio stays plain');
  assert.ok(fake.calls.at(-1).body.links.some((l) => l.url === `https://12go.asia/en/travel/koh-phi-phi/koh-lanta?date=${ferry.date}&people=2`));
  assert.deepEqual(s.options, []);
  assert.match(r.content[0].text, /No ride options saved/);
});

test('any two places and a day work without a trip; a flight leg is refused', async () => {
  const r = await call('find_transport', { from: 'Hanoi', to: 'Ninh Binh', date: START, country: 'Vietnam', adults: 2 });
  assert.deepEqual(r.structuredContent.sites.map((x) => x.site), ['12Go', 'Rome2Rio']);
  assert.equal((await call('find_transport', { from: 'Hanoi' })).isError, true);
  const fl = (await call('open_planner', { trip_id: trip.id })).structuredContent.legs.find((l) => l.mode === 'flight');
  const no = await call('find_transport', { trip_id: trip.id, leg_key: fl.key });
  assert.equal(no.isError, true);
  assert.match(no.content[0].text, /search_flights/);
});

test('saves the options for a leg, shows them with the trip, and the one picked goes in the calendar with its times', async () => {
  const options = [
    { mode: 'ferry', operator: 'Ao Nang Princess', depart: '09:00', arrive: '10:30', minutes: 90, price: 450, currency: 'thb', per_person: true, from_point: 'Tonsai pier', to_point: 'Saladan pier' },
    { mode: 'speedboat', operator: 'Satun Pakbara', depart: '11:30', arrive: '12:15', minutes: 45, price: 900, currency: 'THB', per_person: true, note: 'Nov to Apr' },
  ];
  assert.equal((await call('save_transport_options', { trip_id: trip.id, leg_key: ferry.key, options: [{ mode: 'bus', price: 3 }] })).isError, true, 'a price needs its currency');
  let r = await call('save_transport_options', { trip_id: trip.id, leg_key: ferry.key, options });
  assert.equal(r.isError, undefined, r.content[0].text);
  let leg = r.structuredContent.legs.find((l) => l.key === ferry.key);
  assert.equal(leg.rides.length, 2);
  assert.equal(leg.rides[0].currency, 'THB');
  assert.equal(leg.rides[0].book.site, '12Go');
  assert.ok(leg.rides[0].book.url.startsWith('https://aviasales.tp.st/'));
  assert.match(r.content[0].text, /1\. Ferry with Ao Nang Princess, 09:00–10:30, 1 h 30 min, THB 450 each, from Tonsai pier/);
  assert.equal(r.structuredContent.transport.partnerLinks, true);

  assert.equal((await call('choose_transport', { trip_id: trip.id, leg_key: ferry.key, option: 5 })).isError, true);
  r = await call('choose_transport', { trip_id: trip.id, leg_key: ferry.key, option: 0 });
  leg = r.structuredContent.legs.find((l) => l.key === ferry.key);
  assert.equal(leg.chosen.summary, 'Ferry, Ao Nang Princess, 09:00–10:30, Tonsai pier → Saladan pier');
  assert.deepEqual([leg.chosen.price, leg.chosen.currency, leg.chosen.source, leg.chosen.ride], [900, 'THB', '12Go', 'ferry'], 'the price per person times the travellers');
  assert.deepEqual(cal.timesIn(leg.chosen.summary), { dep: [9, 0], arr: [10, 30], plus: null });

  const found = await call('find_transport', { trip_id: trip.id, leg_key: ferry.key });
  assert.equal(found.structuredContent.options.length, 2);

  // clear_flight takes the ride away again
  r = await call('clear_flight', { trip_id: trip.id, leg_key: ferry.key });
  assert.equal(r.structuredContent.legs.find((l) => l.key === ferry.key).chosen, null);
});
