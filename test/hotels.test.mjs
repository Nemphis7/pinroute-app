// Hotels per stop: Booking.com links for each stop's dates, partner links when set up, and the stay the traveller picked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, THAILAND_TRIP, START, addDays } from './helpers.mjs';
import { searchUrl, partnerUrl, placeQuery, linksOn } from '../src/hotels.mjs';

let srv, client, trip;
const call = async (name, args) => client.callTool({ name, arguments: args });
before(async () => {
  srv = await startServer();
  client = await connect(srv.url);
  trip = (await call('create_trip', THAILAND_TRIP)).structuredContent;
});
after(async () => { await client.close(); srv.server.close(); });

test('a Booking.com search for a place and dates, plain or through a partner link', () => {
  const url = searchUrl({ place: 'Khao Sok, Thailand', checkin: '2027-01-02', checkout: '2027-01-04', adults: 2 });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://www.booking.com/searchresults.html');
  assert.deepEqual([u.searchParams.get('ss'), u.searchParams.get('checkin'), u.searchParams.get('checkout'), u.searchParams.get('group_adults'), u.searchParams.get('no_rooms')],
    ['Khao Sok, Thailand', '2027-01-02', '2027-01-04', '2', '1']);
  assert.equal(partnerUrl(url, {}), url);
  assert.equal(linksOn({}), false);
  assert.match(partnerUrl(url, { BOOKING_AID: '1234567' }), /&aid=1234567&label=pinroute$/);
  const cj = partnerUrl(url, { BOOKING_LINK_TEMPLATE: 'https://www.anrdoezrs.net/click-111-222?url={url}' });
  assert.equal(cj, `https://www.anrdoezrs.net/click-111-222?url=${encodeURIComponent(url)}`);
  assert.equal(linksOn({ BOOKING_LINK_TEMPLATE: 'http://insecure/{url}' }), false, 'only https templates count');
  assert.equal(linksOn({ BOOKING_AID: 'abc' }), false, 'an aid is a number');
  assert.equal(placeQuery({ place: 'Khao Lak', placeId: 'khao-lak', region: 'Andaman' }), 'Khao Lak, Thailand');
  assert.equal(placeQuery({ place: 'Hoi An', iata: 'DAD', region: 'Vietnam' }), 'Hoi An, Vietnam');
});

test('a trip lists one stay per stop with nights, dated and linked', () => {
  assert.equal(trip.stays.length, 7, 'the last Bangkok stop has 0 nights');
  const [bkk, sok] = trip.stays;
  assert.deepEqual([bkk.place, bkk.checkin, bkk.checkout, bkk.nights], ['Bangkok', START, addDays(START, 1), 1]);
  assert.deepEqual([sok.place, sok.checkin, sok.checkout], ['Khao Sok', addDays(START, 1), addDays(START, 2)]);
  assert.equal(new URL(sok.link).searchParams.get('ss'), 'Khao Sok, Thailand');
  assert.equal(new URL(sok.link).searchParams.get('group_adults'), '2');
  assert.equal(trip.hotels.partnerLinks, false);
});

test('hotel_link gives one link per stop, for one stop, or for any place and dates', async () => {
  const all = await call('hotel_link', { trip_id: trip.trip.id });
  assert.ok(!all.isError);
  assert.equal(all.structuredContent.stays.length, 7);
  assert.match(all.content[0].text, /^Bangkok, \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2} \(1 night\): https:\/\/www\.booking\.com\//);
  const one = await call('hotel_link', { trip_id: trip.trip.id, stop: 4, rooms: 2 });
  assert.equal(one.structuredContent.stays.length, 1);
  assert.equal(one.structuredContent.stays[0].place, 'Koh Phi Phi');
  assert.equal(new URL(one.structuredContent.stays[0].url).searchParams.get('no_rooms'), '2');
  assert.match((await call('hotel_link', { trip_id: trip.trip.id, stop: 7 })).content[0].text, /no nights/);
  const free = await call('hotel_link', { place: 'Hoi An, Vietnam', checkin: '2027-03-01', checkout: '2027-03-04' });
  assert.equal(new URL(free.structuredContent.url).searchParams.get('ss'), 'Hoi An, Vietnam');
  assert.match((await call('hotel_link', { place: 'Hoi An', checkin: '2027-03-04', checkout: '2027-03-01' })).content[0].text, /must be after/);
  assert.match((await call('hotel_link', { place: 'Hoi An' })).content[0].text, /Give trip_id/);
  const tools = (await client.listTools()).tools;
  assert.doesNotMatch(tools.find((t) => t.name === 'hotel_link').description, /commission/);
});

test('choose_stay saves a hotel, goes stale when the dates move, and clear_stay removes it', async () => {
  const key = trip.stays[2].key;                                         // Khao Lak, 2 nights
  const bad = await call('choose_stay', { trip_id: trip.trip.id, stay_key: 'stay|Nowhere|2027-01-01|2027-01-02', name: 'x' });
  assert.match(bad.content[0].text, /has no stay/);
  assert.match((await call('choose_stay', { trip_id: trip.trip.id, stay_key: key, name: 'x', price: 10 })).content[0].text, /currency/);
  const r = await call('choose_stay', { trip_id: trip.trip.id, stay_key: key, name: 'Sea Breeze Resort', price: 180, currency: 'eur', source: 'Booking.com', booked: true, note: 'Free cancellation' });
  assert.ok(!r.isError);
  const saved = r.structuredContent.stays[2].chosen;
  assert.deepEqual([saved.name, saved.price, saved.currency, saved.booked, saved.note], ['Sea Breeze Resort', 180, 'EUR', true, 'Free cancellation']);
  // One more night in Bangkok moves Khao Lak a day later: the saved stay shows as stale
  const change = await call('set_nights', { trip_id: trip.trip.id, stop: 0, nights: 2 });
  const moved = change.structuredContent;
  // Claude is told what to pick again, and that the booking for the old dates needs changing with the hotel
  assert.match(change.content[0].text, new RegExp(`need a new pick: Sea Breeze Resort in Khao Lak \\(saved for ${trip.stays[2].checkin} to ${trip.stays[2].checkout}, marked booked\\)`));
  assert.match(change.content[0].text, /changed or cancelled with the airline or hotel/);
  const kl = moved.stays[2];
  assert.equal(kl.chosen, null);
  assert.equal(kl.stale.name, 'Sea Breeze Resort');
  assert.equal(kl.stale.checkin, trip.stays[2].checkin);
  // Choosing again replaces the stale one; clearing removes it
  const again = (await call('choose_stay', { trip_id: trip.trip.id, stay_key: kl.key, name: 'Sea Breeze Resort', price: 180, currency: 'EUR' })).structuredContent;
  assert.equal(again.stays[2].chosen.name, 'Sea Breeze Resort');
  assert.equal(again.stays[2].stale, null);
  const cleared = await call('clear_stay', { trip_id: trip.trip.id, stay_key: kl.key });
  assert.equal(cleared.structuredContent.stays[2].chosen, null);
  assert.equal(cleared.structuredContent.stays[2].stale, null);
  assert.match((await call('clear_stay', { trip_id: trip.trip.id, stay_key: kl.key })).content[0].text, /No hotel is saved/);
});

test('with a partner template, links and the tool description say so; the status page shows it without the IDs', async () => {
  const p = await startServer(null, { BOOKING_LINK_TEMPLATE: 'https://www.anrdoezrs.net/click-111-222?url={url}' });
  const c = await connect(p.url);
  try {
    const t = (await c.callTool({ name: 'create_trip', arguments: THAILAND_TRIP })).structuredContent;
    assert.match(t.stays[0].link, /^https:\/\/www\.anrdoezrs\.net\/click-111-222\?url=https%3A%2F%2Fwww\.booking\.com%2F/);
    assert.equal(t.hotels.partnerLinks, true);
    assert.match((await c.listTools()).tools.find((x) => x.name === 'hotel_link').description, /may earn a commission/);
    const page = await (await fetch(`${p.base}/`)).text();
    assert.match(page, /Hotels \(Booking\.com links\): partner links on\./);
    assert.doesNotMatch(page, /111-222/);
    assert.match(await (await fetch(`${p.base}/help`)).text(), /Booking\.com partner ID/);
  } finally { await c.close(); p.server.close(); }
});
