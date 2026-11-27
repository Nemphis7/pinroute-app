// Airports around a point, for the map picker, and the same dates compared across departure and arrival airports.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, addDays, START } from './helpers.mjs';

let srv, client;
before(async () => { srv = await startServer(); client = await connect(srv.url); });
after(async () => { await client.close(); srv.server.close(); });
const call = async (name, args = {}) => client.callTool({ name, arguments: args });
const FROM = addDays(START, 10), UNTIL = addDays(FROM, 21);

test('lists the airports around a point, busiest first, with a map for the picker', async () => {
  const r = await call('find_airports', { near_lat: 50.03, near_lon: 8.56, within_km: 200 });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const list = r.structuredContent.airports;
  assert.equal(list[0].code, 'FRA');
  assert.ok(['DUS', 'CGN', 'STR', 'LUX'].every((c) => list.some((a) => a.code === c)), list.map((a) => a.code).join(' '));
  assert.ok(list.every((a) => a.km <= 200 && a.international));
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].served >= list[i].served, 'busiest first');
  const m = r._meta.map;
  assert.ok(m.land.startsWith('M') && m.borders.length > 100, 'land and borders');
  const x = m.k * (8.56 * Math.PI / 180) + m.tx, y = m.ty - m.k * Math.log(Math.tan(Math.PI / 4 + (50.03 * Math.PI / 180) / 2));
  assert.ok(Math.abs(x - m.w / 2) < 2 && Math.abs(y - m.h / 2) < 15, `the point sits near the middle, and the projection can be redone in the view: ${x}, ${y}`);
  assert.match(r.content[0].text, /^Airports within 200 km of 50\.03, 8\.56:\nFRA /);
  const houston = { near_lat: 29.76, near_lon: -95.37, within_km: 100 };          // Hobby (HOU) flies only within the US
  const abroad = (await call('find_airports', houston)).structuredContent.airports;
  const all = (await call('find_airports', { ...houston, international: false })).structuredContent.airports;
  assert.ok(abroad.every((a) => a.international) && !abroad.some((a) => a.code === 'HOU') && all.some((a) => a.code === 'HOU'), 'airports with domestic flights only come in when asked');
  assert.match((await call('find_airports', {})).content[0].text, /Give a query, or near_lat and near_lon/);
});

test('the draft knows where each compared country can be reached', async () => {
  const r = await call('plan_new_trip', { free_from: FROM, free_until: UNTIL, home_airports: ['FRA', 'MUC', 'STR'], compare: ['Vietnam', 'Thailand'], step: 'flights' });
  const a = r.structuredContent.arrivals;
  assert.deepEqual(a['704'].slice(0, 3).map((x) => x.code), ['SGN', 'HAN', 'DAD']);
  assert.equal(a['764'][0].code, 'BKK', 'the main airport first');
  assert.equal(r.structuredContent.flights.searchesLeft, 50);
});

test('compares departure and arrival airports for one pair of dates, one search a route', async () => {
  const depart = addDays(FROM, 3), ret = addDays(FROM, 15);
  const r = await call('scan_flight_deals', { country: 'Vietnam', origins: ['FRA', 'MUC', 'STR'], destinations: ['SGN', 'HAN'], depart, return: ret });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const { searched, deals, searches_left } = r.structuredContent;
  assert.deepEqual(searched.map((x) => `${x.from}>${x.to}`), ['FRA>SGN', 'FRA>HAN', 'MUC>SGN', 'MUC>HAN', 'STR>SGN', 'STR>HAN']);
  assert.ok(searched.every((x) => x.depart === depart && x.return === ret && x.fares > 0 && x.best > 0));
  assert.equal(searches_left, 44);
  assert.ok(deals.every((x) => x.depart === depart && x.return === ret));
  for (let i = 1; i < deals.length; i++) assert.ok(deals[i - 1].price <= deals[i].price, 'cheapest first');
  assert.match(r.content[0].text, /saved for Vietnam, FRA, MUC, STR → SGN, HAN, /);

  const saved = (await call('plan_new_trip', {})).structuredContent.deals['704'];
  assert.deepEqual([...new Set(saved.map((x) => `${x.from}>${x.to}`))].sort(), ['FRA>HAN', 'FRA>SGN', 'MUC>HAN', 'MUC>SGN', 'STR>HAN', 'STR>SGN']);
  await call('scan_flight_deals', { country: 'Vietnam', origins: ['FRA'], destinations: ['SGN'], depart, return: ret });
  const again = (await call('plan_new_trip', {})).structuredContent.deals['704'];
  assert.equal(again.filter((x) => x.from === 'MUC').length, saved.filter((x) => x.from === 'MUC').length, 'a new search replaces only its own route');
});

test('says what is wrong with a comparison before searching', async () => {
  const depart = addDays(FROM, 3);
  assert.match((await call('scan_flight_deals', { country: 'Vietnam', origins: ['FRA'], depart })).content[0].text, /both depart and return/);
  assert.match((await call('scan_flight_deals', { country: 'Vietnam', origins: ['FRA', 'QQQ'] })).content[0].text, /No airport with the code QQQ/);
  const many = ['FRA', 'MUC', 'STR', 'DUS', 'CGN'];
  assert.match((await call('scan_flight_deals', { country: 'Vietnam', origins: many, destinations: ['SGN', 'HAN', 'DAD', 'CXR'], depart, return: addDays(depart, 12) })).content[0].text, /20 routes is more than one comparison takes/);
});

test('names an airport by the city travellers fly to, not the suburb it stands in', async () => {
  const city = async (q) => (await call('find_airports', { query: q })).structuredContent.airports[0];
  assert.deepEqual([(await city('NRT')).city, (await city('DPS')).city, (await city('KUL')).city, (await city('MXP')).city], ['Tokyo', 'Bali', 'Kuala Lumpur', 'Milan']);
  assert.equal((await city('MAN')).city, 'Manchester', 'a county after the town is left out');
  assert.equal((await city('Narita')).code, 'NRT', 'the suburb still finds it');
  const tokyo = (await call('find_airports', { query: 'Tokyo' })).structuredContent.airports.map((a) => a.code);
  assert.deepEqual(tokyo.slice(0, 2).sort(), ['HND', 'NRT']);
});

test('three letters: a big airport\'s code comes first, a small one\'s follows the busy cities that start so', async () => {
  const codes = async (q) => (await call('find_airports', { query: q })).structuredContent.airports.map((a) => a.code);
  assert.equal((await codes('Mun'))[0], 'MUC', 'Munich before Maturín (MUN)');
  assert.ok((await codes('Mun')).includes('MUN'));
  assert.equal((await codes('Pra'))[0], 'PRG');
  assert.equal((await codes('BER'))[0], 'BER', 'Berlin keeps its code first');
  assert.equal((await codes('FRA'))[0], 'FRA');
});
