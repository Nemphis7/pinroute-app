// Recent prices and partner links from Travelpayouts, against a stand-in for its API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, addDays, START } from './helpers.mjs';
import { fakeTravelpayouts } from './fake-travelpayouts.mjs';
import * as tp from '../src/providers/travelpayouts.mjs';

let fake, srv, client;
const TP = (url) => ({ TRAVELPAYOUTS_API_URL: url, TRAVELPAYOUTS_TOKEN: 'tp-test', TRAVELPAYOUTS_MARKER: '123456', TRAVELPAYOUTS_TRS: '987' });
before(async () => {
  fake = await fakeTravelpayouts();
  srv = await startServer(null, TP(fake.url));
  client = await connect(srv.url);
});
after(async () => { await client.close(); srv.server.close(); fake.close(); });
const call = async (name, args = {}) => client.callTool({ name, arguments: args });
const FROM = `${addDays(START, 30).slice(0, 7)}-01`, UNTIL = addDays(FROM, 27);

test('an Aviasales search link, and its partner link made once, ten to a request', async () => {
  assert.equal(tp.searchUrl({ from: 'fra', to: 'bkk', depart: '2027-03-01', ret: '2027-03-15', adults: 2 }), 'https://www.aviasales.com/search/FRA0103BKK15032');
  assert.equal(tp.searchUrl({ from: 'KBV', to: 'BKK', depart: '2027-03-01' }), 'https://www.aviasales.com/search/KBV0103BKK1');
  tp._forget();
  const env = TP(fake.url), n = fake.calls.length;
  const urls = Array.from({ length: 11 }, (_, i) => `https://www.aviasales.com/search/FRA0103BKK${String(10 + i)}031`);
  const links = await tp.partnerLinks(urls, { env });
  assert.equal(fake.calls.length - n, 2, '11 links, two requests');
  assert.ok(links.every((l) => l.startsWith('https://aviasales.tp.st/')));
  const body = fake.calls.at(-2).body;
  assert.deepEqual([body.trs, body.marker, body.shorten, body.links.length, body.links[0].sub_id], [987, 123456, true, 10, 'pinroute']);
  await tp.partnerLinks(urls, { env });
  assert.equal(fake.calls.length - n, 2, 'remembered');
  const down = await tp.partnerLinks(['https://www.aviasales.com/search/MUC0103BKK15031'], { env: { ...env, TRAVELPAYOUTS_API_URL: 'http://127.0.0.1:9' } });
  assert.equal(down[0], 'https://www.aviasales.com/search/MUC0103BKK15031?marker=123456', 'when the Links API is out of reach, the partner ID rides along');
  assert.deepEqual(await tp.partnerLinks(['https://x.test/a'], { env: { TRAVELPAYOUTS_TOKEN: 'tp-test' } }), ['https://x.test/a'], 'no partner ID, no change');
});

test('a fallback to marker= links logs one warning with its reason, never a secret, and not on every call', async () => {
  tp._forget();
  const lines = [], log = (l) => lines.push(l);
  const env = { ...TP('http://127.0.0.1:9'), TRAVELPAYOUTS_TOKEN: 'tp-secret-token' };
  await tp.partnerLinks(['https://www.aviasales.com/search/MUC0103BKK15031'], { env, log });
  await tp.partnerLinks(['https://www.aviasales.com/search/MUC0103BKK16031'], { env, log });
  assert.equal(lines.length, 1, 'the same reason is logged once');
  assert.match(lines[0], /fell back to marker= \(could not reach the Links API/);
  const slow = async (_, { signal }) => new Promise((_, no) => signal.addEventListener('abort', () => no(signal.reason)));
  await tp.partnerLinks(['https://x.test/b'], { env, log, fetchImpl: slow, timeoutMs: 50 });
  assert.match(lines[1], /took over 0.05s/);
  await tp.partnerLinks(['https://x.test/c'], { env, log, fetchImpl: async () => new Response('', { status: 500 }) });
  assert.match(lines[2], /Links API answered 500/);
  await tp.partnerLinks(['https://x.test/d'], { env: { ...env, TRAVELPAYOUTS_TRS: '' }, log });
  assert.match(lines[3], /TRAVELPAYOUTS_TRS is not set/);
  for (const l of lines) assert.ok(!/tp-secret-token|123456|987|x\.test|aviasales\.com/.test(l), l);
});

test('a window is scanned from recent prices, day by day: every travel window of the right length, without airline searches', async () => {
  await call('plan_new_trip', { free_from: FROM, free_until: UNTIL, min_nights: 9, max_nights: 12, adults: 2, home_airports: ['FRA'], compare: ['Vietnam'], step: 'flights' });
  const before = (await call('plan_new_trip')).structuredContent.flights;
  assert.equal(before.recent, true);
  assert.equal(before.partnerLinks, true);
  const r = await call('scan_flight_deals', { country: 'Vietnam' });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const { deals, source, searched } = r.structuredContent;
  assert.equal(source, 'recent');
  assert.equal(searched[0].from, 'FRA');
  assert.ok(deals.length >= 3 && deals.every((x) => x.source === 'Aviasales' && x.recent && x.airline === 'VietJet Air'), 'the airline by name, not its code');
  assert.ok(deals.every((x) => x.depart >= FROM && x.return <= UNTIL), 'inside the window');
  const len = (x) => (Date.parse(x.return) - Date.parse(x.depart)) / 864e5;
  assert.ok(deals.every((x) => len(x) >= 9 && len(x) <= 12), '9 to 12 nights, as asked');
  const { windows } = r.structuredContent;
  assert.ok(windows.length >= 5, `a window from many departure days, not two or three dates: ${windows.length}`);
  assert.ok(windows.every((w) => w.depart >= FROM && w.return <= UNTIL && w.nights >= 9 && w.nights <= 12 && w.price === w.perAdult * 2));
  assert.ok(new Set(windows.map((w) => w.nights)).size > 1, 'trip lengths vary within the range');
  assert.equal(deals[0].price, Math.min(...windows.map((w) => w.price)), 'the cheapest window is saved first');
  assert.match(deals[0].link, /^https:\/\/aviasales\.tp\.st\//);
  assert.match(r.content[0].text, /^Recent prices on Aviasales \(found by travellers in the last days, check before booking\)/);
  assert.match(r.content[0].text, /\nCheapest windows \(recent Aviasales prices, per person\): /);
  const q = fake.calls.find((c) => c.path === '/aviasales/v3/grouped_prices' && c.query.group_by === 'departure_at').query;
  assert.deepEqual([q.origin, q.destination, q.departure_at, q.min_trip_duration, q.max_trip_duration, q.currency], ['FRA', 'SGN', FROM.slice(0, 7), '9', '12', 'eur']);
  assert.deepEqual((await call('plan_new_trip')).structuredContent.windows['704'].map((w) => w.depart), windows.map((w) => w.depart), 'the draft keeps the windows for the planner');
  assert.equal((await call('plan_new_trip')).structuredContent.flights.searchesLeft, before.searchesLeft, 'no airline searches used');
});

test('the best time to go: the cheapest fare for each month ahead in one look-up', async () => {
  const r = await call('scan_flight_deals', { country: 'Japan', by_month: true });
  assert.ok(!r.isError, JSON.stringify(r.content));
  assert.equal(r.structuredContent.deals.length, 12);
  const months = new Set(r.structuredContent.deals.map((x) => x.depart.slice(0, 7)));
  assert.equal(months.size, 12, 'one fare a month');
  const q = fake.calls.filter((c) => c.path === '/aviasales/v3/grouped_prices').at(-1).query;
  assert.deepEqual([q.origin, q.destination, q.group_by, q.min_trip_duration, q.max_trip_duration], ['FRA', 'NRT', 'month', '9', '12']);
});

test('exact dates go to live airline fares unless recent prices are asked for', async () => {
  const depart = addDays(FROM, 3), ret = addDays(FROM, 14);
  const live = await call('scan_flight_deals', { country: 'Vietnam', origins: ['FRA'], depart, return: ret });
  assert.ok(live.structuredContent.deals.every((x) => x.source === 'Demo data'));
  const recent = await call('scan_flight_deals', { country: 'Vietnam', origins: ['FRA'], depart, return: ret, source: 'recent' });
  assert.deepEqual(recent.structuredContent.deals.map((x) => [x.depart, x.return, x.price]), [[depart, ret, 666]]);
});

test('a link to compare and book any flight on Aviasales, as a partner link', async () => {
  const r = await call('flight_link', { from: 'KBV', to: 'BKK', depart: addDays(START, 14), adults: 2 });
  assert.ok(!r.isError);
  assert.match(r.structuredContent.url, /^https:\/\/aviasales\.tp\.st\//);
  assert.equal(r.structuredContent.partner, true);
  const tools = (await client.listTools()).tools;
  assert.match(tools.find((t) => t.name === 'flight_link').description, /may earn a commission/);
});

test('says what is missing when Travelpayouts is not set up, or refuses the token', async () => {
  const plain = await startServer();
  const c = await connect(plain.url);
  try {
    assert.match((await c.callTool({ name: 'scan_flight_deals', arguments: { country: 'Vietnam', source: 'recent' } })).content[0].text, /need Travelpayouts on the server/);
    assert.match((await c.callTool({ name: 'scan_flight_deals', arguments: { country: 'Vietnam', by_month: true } })).content[0].text, /by_month works with recent prices/);
    const link = await c.callTool({ name: 'flight_link', arguments: { from: 'FRA', to: 'BKK', depart: addDays(START, 1) } });
    assert.match(link.structuredContent.url, /^https:\/\/www\.aviasales\.com\/search\/FRA\d{4}BKK1$/);
    assert.equal(link.structuredContent.partner, false);
    assert.doesNotMatch((await c.listTools()).tools.find((t) => t.name === 'flight_link').description, /commission/);
  } finally { await c.close(); plain.server.close(); }
  const wrong = await startServer(null, { ...TP(fake.url), TRAVELPAYOUTS_TOKEN: 'nope' });
  const w = await connect(wrong.url);
  try {
    await w.callTool({ name: 'plan_new_trip', arguments: { home_airports: ['FRA'] } });
    assert.match((await w.callTool({ name: 'scan_flight_deals', arguments: { country: 'Vietnam' } })).content[0].text, /refused the API token; check TRAVELPAYOUTS_TOKEN/);
  } finally { await w.close(); wrong.server.close(); }
});

test('the status page says whether recent prices and partner links are on, without showing them', async () => {
  const page = await (await fetch(`${srv.base}/`)).text();
  assert.match(page, /Recent prices \(Aviasales via Travelpayouts\): on\. Partner links: on\./);
  assert.doesNotMatch(page, /tp-test|123456|987/);
});

test('a window from five home airports to six arrival airports runs in one call: a spread that fits, every airport in it', async () => {
  const froms = ['CGN', 'DUS', 'FRA', 'BRU', 'EIN'], tos = ['FCO', 'MXP', 'NAP', 'VCE', 'BLQ', 'CTA'];
  const r = await call('scan_flight_deals', { country: 'Italy', origins: froms, destinations: tos, earliest: FROM, latest: addDays(FROM, 45) });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const { searched, left_out } = r.structuredContent;
  const months = new Set(searched.map((x) => x.depart)).size;
  assert.ok(months >= 2, 'two months in the window');
  assert.ok(searched.length <= 16, `${searched.length} look-ups`);
  assert.deepEqual([...new Set(searched.map((x) => x.from))].sort(), [...froms].sort());
  assert.deepEqual([...new Set(searched.map((x) => x.to))].sort(), [...tos].sort());
  assert.equal(new Set(searched.map((x) => `${x.from}>${x.to}`)).size + left_out.length, 30);
  assert.match(r.content[0].text, /of 30 routes, each airport at least once; left out: /);
});

test('live airline fares for a window go to its cheapest windows from the calendar, not to evenly spread dates', async () => {
  const cal = (await call('plan_new_trip')).structuredContent.windows['704'];
  const cheapest = cal.slice().sort((a, b) => a.perAdult - b.perAdult).slice(0, 3).map((w) => `${w.depart}>${w.return}`).sort();
  const r = await call('scan_flight_deals', { country: 'Vietnam', source: 'live' });
  assert.ok(!r.isError, JSON.stringify(r.content));
  assert.deepEqual(r.structuredContent.searched.map((x) => `${x.depart}>${x.return}`).sort(), cheapest);
  assert.match(r.content[0].text, /the cheapest windows /);
});

test('with no live searches left, a live scan answers with recent Aviasales prices instead of an error', async () => {
  const tight = await startServer(null, { ...TP(fake.url), SEARCH_LIMIT_PER_DAY: '1' });
  const c = await connect(tight.url);
  try {
    await c.callTool({ name: 'plan_new_trip', arguments: { free_from: FROM, free_until: UNTIL, min_nights: 9, max_nights: 12, adults: 2, home_airports: ['FRA'], compare: ['Vietnam'] } });
    const first = await c.callTool({ name: 'scan_flight_deals', arguments: { country: 'Vietnam', source: 'live' } });
    assert.ok(!first.isError, JSON.stringify(first.content));
    assert.equal(first.structuredContent.searches_left, 0);
    const r = await c.callTool({ name: 'scan_flight_deals', arguments: { country: 'Vietnam', source: 'live', earliest: addDays(FROM, 1) } });
    assert.ok(!r.isError, JSON.stringify(r.content));
    assert.match(r.content[0].text, /^Today's 1 live airline searches in Pinroute are used up \(they start again at 00:00 UTC\), so these are recent Aviasales prices instead\.\nRecent prices on Aviasales/);
    assert.equal(r.structuredContent.fallback, 'recent');
    assert.ok(r.structuredContent.deals.length && r.structuredContent.deals.every((x) => x.source === 'Aviasales'));
  } finally { await c.close(); tight.server.close(); }
});
