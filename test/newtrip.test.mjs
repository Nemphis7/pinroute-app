// A new trip, the two ways Pinroute plans one: from the days off (When → Where → Flights) and from a country
// (Country → Best time → Flights), ending with a trip started from a fare. Fares are demo data here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, addDays, START } from './helpers.mjs';
import { windowMonths, bestMonthsText, dealLabel, findDest, rankDests, monthsToCheck, nextMonths, roughCost, budgetFit } from '../src/discover.mjs';

let srv, client;
before(async () => { srv = await startServer(null, { SEARCH_LIMIT_PER_DAY: '12' }); client = await connect(srv.url); });
after(async () => { await client.close(); srv.server.close(); });

const call = async (name, args = {}) => client.callTool({ name, arguments: args });
const FROM = addDays(START, 10), UNTIL = addDays(FROM, 21);
let dealId;

test('the shared rules: months in a window, best months, deal labels, countries by name', () => {
  assert.deepEqual(windowMonths('2027-02-20', '2027-04-02'), [1, 2, 3]);
  assert.deepEqual(windowMonths('2027-12-20', '2028-01-05'), [11, 0]);
  assert.equal(bestMonthsText(findDest('Thailand')), 'Nov–Mar');
  assert.equal(bestMonthsText(findDest('Japan')), 'Mar–May, Oct–Nov');
  assert.equal(bestMonthsText(findDest('Malaysia')), 'Jan–Aug');
  assert.deepEqual([0.6, 0.8, 0.95, 1.1, 1.4].map((r) => dealLabel(r)[1]), ['Exceptional deal', 'Great deal', 'Good price', 'Typical price', 'Pricey']);
  assert.equal(findDest('UK').name, 'United Kingdom');
  assert.equal(findDest('viet nam').name, 'Vietnam');
  assert.equal(findDest('704').name, 'Vietnam');
  assert.equal(findDest('Atlantis'), null);
  const four = monthsToCheck(findDest('Japan'), '2026-11-23');
  assert.deepEqual(four.map((m) => m.ym), ['2026-11', '2027-03', '2027-04', '2027-05'], 'the good months of the coming year, the rest of this one too, at most four');
  assert.equal(nextMonths('2026-11-30')[0].ym, '2026-12', 'a month with no day left to leave is skipped');
});

test('ranks countries by the weather in the window, interests and distance, within the regions chosen', () => {
  const draft = { from: '2027-03-01', until: '2027-03-22', minNights: 9, maxNights: 12, adults: 2, budget: 0, regions: [], interests: ['beach'] };
  const fra = { lat: 50.03, lon: 8.56 };
  const top = rankDests(draft, fra).slice(0, 10).map((r) => r.d.name);
  assert.ok(top.includes('Sri Lanka') && top.includes('Maldives'), top.join(', '));
  assert.ok(!top.includes('Norway') && !top.includes('Iceland'), 'no winter north in March');
  const europe = rankDests({ ...draft, regions: ['Southern Europe'] }, fra);
  assert.ok(europe.every((r) => r.d.region === 'Southern Europe'));
  const c = roughCost(findDest('Thailand'), { adults: 2, nights: 10, dist: 9000 });
  assert.equal(c.flights, Math.round((120 + 0.07 * 9000) * 2));
  assert.deepEqual(budgetFit(c, c.total - 1)[1], 'Over budget');
  assert.deepEqual(budgetFit(c, c.total * 2)[1], 'Fits budget');
});

test('starts a draft and saves what the traveller said', async () => {
  const r = await call('plan_new_trip', { free_from: FROM, free_until: UNTIL, home_airports: ['fra', 'MUC'], adults: 2, budget: 5000, interests: ['beach', 'nature'] });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const v = r.structuredContent;
  assert.equal(v.screen, 'new');
  assert.deepEqual([v.draft.from, v.draft.until, v.draft.minNights, v.draft.maxNights, v.draft.step, v.draft.way], [FROM, UNTIL, 9, 12, 'where', 'when'], 'free dates in the words: on to where is good then');
  assert.deepEqual(v.homes.map((a) => [a.code, a.city]), [['FRA', 'Frankfurt am Main'], ['MUC', 'Munich']]);
  assert.equal(v.top.length, 8);
  assert.match(r.content[0].text, /free .* 9–12 nights, 2 adults, budget €5,000, from FRA, MUC\.\nBest matches for /);
  const again = await call('plan_new_trip', {});
  assert.equal(again.structuredContent.draft.budget, 5000, 'an empty call reads the draft');
});

test('refuses what it cannot use, saying what to fix', async () => {
  assert.match((await call('plan_new_trip', { compare: ['Narnia'] })).content[0].text, /60 countries and "Narnia" isn't one of them/);
  assert.match((await call('plan_new_trip', { free_from: '2020-01-01' })).content[0].text, /already passed/);
  assert.match((await call('plan_new_trip', { free_until: addDays(FROM, -2) })).content[0].text, /has to come after/);
  assert.match((await call('plan_new_trip', { home_airports: ['QQQ'] })).content[0].text, /No airport with the code QQQ/);
  assert.equal((await call('plan_new_trip', {})).structuredContent.draft.until, UNTIL, 'a refused change leaves the draft as it was');
});

test('moving on to Where compares the four best matches; the traveller can change them', async () => {
  const r = await call('plan_new_trip', { step: 'where' });
  assert.equal(r.structuredContent.draft.compare.length, 4);
  assert.deepEqual(r.structuredContent.draft.compare, r.structuredContent.top.slice(0, 4).map((t) => t.id));
  const c = await call('plan_new_trip', { compare: ['Vietnam', 'sri lanka', 'Mexico'], step: 'flights' });
  assert.deepEqual(c.structuredContent.draft.compare, ['704', '144', '484']);
  assert.match(c.content[0].text, /Comparing: Vietnam, Sri Lanka, Mexico\./);
});

test('scans airline fares for a country on dates spread over the window, and keeps them', async () => {
  const r = await call('scan_flight_deals', { country: 'Vietnam' });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const { searched, deals } = r.structuredContent;
  assert.equal(searched.length, 3);
  assert.equal(searched[0].depart, FROM);
  for (const s of searched) assert.ok(s.return <= UNTIL && s.return > s.depart);
  assert.ok(deals.length >= 3);
  for (const d of deals) {
    assert.deepEqual([d.from, d.to, d.adults, d.source], ['FRA', 'SGN', 2, 'Demo data']);
    assert.ok(d.km > 9000 && d.km < 10000, 'the distance rates the deal');
    assert.ok(d.arrive >= d.depart);
    assert.match(d.out, /FRA → .* SGN/);
  }
  for (let i = 1; i < deals.length; i++) assert.ok(deals[i - 1].price / 2 <= deals[i].price / 2 || !deals[i - 1].fits);
  dealId = deals[0].id;
  const again = await call('scan_flight_deals', { country: 'Vietnam', dates: 1 });
  const kept = (await call('plan_new_trip', {})).structuredContent.deals['704'];
  assert.ok(!kept.some((x) => x.id === dealId), 'a new scan replaces the fares from the same source in the same months');
  dealId = again.structuredContent.deals[0].id;
});

test('stops scanning at the daily search limit', async () => {
  await call('scan_flight_deals', { country: 'Mexico', dates: 4 });              // 3 + 1 + 4 = 8 of 12
  const r = await call('scan_flight_deals', { country: 'Mexico', dates: 4 });     // 12 of 12
  assert.ok(!r.isError);
  const over = await call('scan_flight_deals', { country: 'Mexico' });
  assert.match(over.content[0].text, /today's 12 flight searches/);
});

test('saves fares Claude found with the traveller\'s own flight tools', async () => {
  const fare = { from: 'FRA', to: 'CMB', depart: addDays(FROM, 2), arrive: addDays(FROM, 3), return: addDays(FROM, 14), price: 1180, currency: 'eur', airline: 'Qatar Airways', out: 'QR 68, 16:25 FRA → 08:00 CMB', stops: 1, source: 'LetsFG', link: 'https://letsfg.co/b/1' };
  const r = await call('save_flight_deals', { country: 'Sri Lanka', deals: [fare, { ...fare, price: 1320, airline: 'Emirates' }] });
  assert.ok(!r.isError, JSON.stringify(r.content));
  assert.match(r.content[0].text, /Saved 2 fares for Sri Lanka[\s\S]*€590 pp \(€1,180 for 2\), FRA → CMB/);
  const second = await call('save_flight_deals', { country: 'Sri Lanka', deals: [{ ...fare, price: 1100, source: 'Kiwi.com' }] });
  assert.ok(!second.isError);
  const all = (await call('plan_new_trip', {})).structuredContent.deals['144'];
  assert.deepEqual(all.map((x) => [x.source, x.price]), [['Kiwi.com', 1100], ['LetsFG', 1180], ['LetsFG', 1320]], 'another source keeps the first one\'s fares');
  assert.match((await call('save_flight_deals', { country: 'Sri Lanka', deals: [{ ...fare, return: fare.depart }] })).content[0].text, /not after it leaves/);
  assert.match((await call('save_flight_deals', { country: 'Atlantis', deals: [fare] })).content[0].text, /isn't one of them/);
});

test('starts a trip from a fare: from landing to the flight home, with the fare on both flights', async () => {
  const draft = (await call('plan_new_trip', {})).structuredContent;
  const deal = draft.deals['704'].find((x) => x.id === dealId);
  const r = await call('start_trip_from_flight', { deal_id: dealId });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const v = r.structuredContent;
  assert.equal(v.screen, 'trip');
  assert.deepEqual([v.trip.start, v.trip.end, v.trip.home, v.trip.country], [deal.arrive, deal.return, 'FRA', 'Vietnam']);
  assert.deepEqual(v.stops.map((x) => [x.place, x.iata]), [['Ho Chi Minh City', 'SGN']]);
  const out = v.legs.find((l) => l.kind === 'out'), home = v.legs.find((l) => l.kind === 'home');
  assert.deepEqual([out.chosen.part, out.chosen.price, home.chosen.part, home.chosen.price], ['out', deal.price, 'return', 0]);
  assert.equal(v.trip.ticket.price, deal.price);
  assert.match(v.trip.name, /^Vietnam · \w+ \d{4}$/);
  assert.match(r.content[0].text, /update_trip/);
  assert.match((await call('start_trip_from_flight', { deal_id: 'dl_nope' })).content[0].text, /No fare with id dl_nope/);
});

test('plans the route anywhere: stops by coordinates get their nearest airport, islands their ferries', async () => {
  const trips = (await call('list_trips')).structuredContent.trips;
  const id = trips[0].id;
  const r = await call('update_trip', { trip_id: id, stops: [
    { place: 'Ho Chi Minh City', nights: 2, airport: 'SGN' },
    { place: 'Phu Quoc', nights: 3, lat: 10.22, lon: 103.96, island: true },
    { place: 'Hoi An', nights: 4, lat: 15.88, lon: 108.33 },
    { place: 'Ho Chi Minh City', nights: 0, airport: 'SGN' },
  ] });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const v = r.structuredContent;
  assert.deepEqual(v.stops.map((x) => x.iata), ['SGN', 'PQC', 'DAD', 'SGN']);
  assert.deepEqual(v.stops.map((x) => x.region), ['Vietnam', 'Vietnam', 'Vietnam', 'Vietnam']);
  assert.deepEqual(v.legs.map((l) => l.mode), ['flight', 'flight', 'flight', 'flight', 'flight']);
  assert.ok(v.legs.find((l) => l.kind === 'out').chosen, 'the outbound fare stays with the trip');
});

test('the start screen lists the trips, the one under way first, and the draft', async () => {
  const today = new Date().toISOString().slice(0, 10);
  await call('create_trip', { name: 'Under way', start: addDays(today, -2), adults: 2, stops: [{ place: 'Koh Lanta', nights: 3 }, { place: 'Ao Nang', nights: 2 }] });
  await call('create_trip', { name: 'Last year', start: '2025-11-01', adults: 2, stops: [{ place: 'Bangkok', nights: 3 }] });
  const r = await call('open_planner');
  const v = r.structuredContent;
  assert.equal(v.screen, 'home');
  assert.deepEqual(v.trips.map((t) => [t.name, t.state]).map(([n, s]) => `${n}:${s}`), ['Under way:now', `${v.trips[1].name}:ahead`, 'Last year:done']);
  assert.equal(v.trips[0].here, 'Koh Lanta');
  assert.deepEqual(v.draft.compare, ['Vietnam', 'Sri Lanka', 'Mexico']);
  assert.ok(v.draft.deals >= 3);
  assert.match(r.content[0].text, /Under way \(.*under way, today in Koh Lanta\)/);
});

test('the I-know-where way: a country, its best months, then flights for one month', async () => {
  const r = await call('plan_new_trip', { country: 'Japan' });
  assert.deepEqual([r.structuredContent.draft.way, r.structuredContent.draft.step, r.structuredContent.draft.country], ['where', 'season', '392']);
  assert.match(r.content[0].text, /Country: Japan, best Mar–May, Oct–Nov\./);
  const reset = await call('plan_new_trip', { reset: true });
  const d = reset.structuredContent.draft;
  assert.deepEqual([d.homes, d.adults, d.compare, d.country, d.step], [['FRA', 'MUC'], 2, [], null, 'prompt'], 'a new draft keeps only the airports and travellers, and starts from the words');
  assert.deepEqual(reset.structuredContent.deals, {});
});

test('from the traveller\'s words: the draft moves on to the first step the words leave open', async () => {
  const words = 'I want to go on a trip to Japan in April for two weeks';
  const fresh = (await call('plan_new_trip', { reset: true, way: 'prompt', wishes: words })).structuredContent.draft;
  assert.deepEqual([fresh.way, fresh.step, fresh.wishes], ['prompt', 'prompt', words], 'words alone stay on the first screen');
  const country = (await call('save_new_trip_draft', { country: 'Japan' })).structuredContent.draft;
  assert.deepEqual([country.way, country.step], ['where', 'season'], 'a country without dates: its best months');
  await call('plan_new_trip', { reset: true, way: 'prompt', wishes: words });
  const both = await call('save_new_trip_draft', { country: 'Japan', free_from: addDays(FROM, 30), free_until: addDays(FROM, 50), min_nights: 13, max_nights: 15 });
  assert.deepEqual([both.structuredContent.draft.way, both.structuredContent.draft.step, both.structuredContent.draft.compare], ['where', 'flights', ['392']], 'country and dates: straight to the flight deals');
  assert.match(both.content[0].text, /New-trip draft \(I know where, at flights\)/);
  await call('plan_new_trip', { reset: true, wishes: 'Somewhere warm in March' });
  const dates = (await call('save_new_trip_draft', { free_from: addDays(FROM, 5), free_until: addDays(FROM, 25) })).structuredContent.draft;
  assert.deepEqual([dates.way, dates.step], ['when', 'where'], 'dates without a country: where is good then');
  await call('plan_new_trip', { reset: true });
  const several = (await call('save_new_trip_draft', { compare: ['Vietnam', 'Thailand'] })).structuredContent.draft;
  assert.deepEqual([several.way, several.step], ['when', 'when'], 'countries without dates: when you are free');
  const byHand = (await call('plan_new_trip', { reset: true, step: 'country' })).structuredContent.draft;
  assert.deepEqual([byHand.way, byHand.step], ['where', 'country'], 'a step set by hand picks its way');
});
