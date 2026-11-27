// Tours and activities: Amadeus Travel Builder's activity search, against a stand-in that answers the way Amadeus's
// guide shows, with GetYourGuide and Klook booking links made into Travelpayouts partner links.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startServer, connect, THAILAND_TRIP } from './helpers.mjs';
import { fakeTravelpayouts } from './fake-travelpayouts.mjs';
import * as acts from '../src/providers/activities.mjs';
import * as tp from '../src/providers/travelpayouts.mjs';

const product = (n, extra = {}) => ({
  id: 17985854214047736 + n, productId: 57214960 + n, title: `Tour ${n}`,
  description: '<div><p>Experience <b>authentic</b> culture &amp; food.</p><script>alert(1)</script></div>',
  galleryImages: [{ url: `https://img.test/${n}-b.jpg`, order: 1 }, { url: `https://img.test/${n}-a.jpg`, order: 0 }],
  minPrice: 40 + n, maxPrice: 60 + n, priceCurrency: 'EUR', pricingUnit: 'PER_PERSON', bookingUrl: `https://to.discover-exp.com/${n}`,
  geoLocation: { latitude: 7.6, longitude: 99.03 }, rating: 4.7157893, numberOfRatings: 475, duration: '3 hours', cityName: 'Koh Lanta', ...extra,
});

async function fakeAmadeus() {
  const calls = [];
  const server = createServer((rq, rs) => {
    const u = new URL(rq.url, 'http://x');
    let raw = '';
    rq.on('data', (c) => { raw += c; });
    rq.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method: rq.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, key: rq.headers['x-api-key'] });
      const send = (code, v) => { rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(v)); };
      if (rq.headers['x-api-key'] !== 'am-test') return send(400, { errors: [{ status: 400, code: 38187, title: 'Invalid parameters' }] });
      const city = u.searchParams.get('cityName') || body?.recommendationFilters?.city;
      if (city === 'Atlantis') return send(400, { status: 400, code: 6025, title: 'Could not find destination in database' });
      if (u.pathname === '/recommendation/v1/top-activities') {
        const n = Number(u.searchParams.get('maxRecommendations'));
        return send(200, [product(1), product(1), product(2, { bookingUrl: undefined }), { title: 'no id' }, ...Array.from({ length: n }, (_, i) => product(10 + i))].slice(0, n));
      }
      if (u.pathname === '/recommendation/v1/products' && rq.method === 'POST') {
        if (body.recommendationFilters.interests?.includes('nothing')) return send(200, []);
        return send(200, Array.from({ length: Math.min(body.maxRecommendations, 12) }, (_, i) => product(30 + i)));
      }
      send(404, { status: 404, code: 404, title: 'Not found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() };
}

let am, fake, srv, client;
before(async () => {
  am = await fakeAmadeus();
  fake = await fakeTravelpayouts();
  srv = await startServer(null, {
    AMADEUS_API_KEY: 'am-test', AMADEUS_GATEWAY_URL: am.url, ACTIVITY_LIMIT_PER_DAY: '5',
    TRAVELPAYOUTS_API_URL: fake.url, TRAVELPAYOUTS_TOKEN: 'tp-test', TRAVELPAYOUTS_MARKER: '123456', TRAVELPAYOUTS_TRS: '987',
  });
  client = await connect(srv.url);
});
after(async () => { await client.close(); srv.server.close(); fake.close(); am.close(); });
const call = async (name, args = {}) => client.callTool({ name, arguments: args });

test('maps a product: plain-text teaser without the supplier HTML, the first photo by order, productId as identity', () => {
  const a = acts.mapProduct(product(1));
  assert.equal(a.id, 57214961);
  assert.equal(a.summary, 'Experience authentic culture & food.');
  assert.equal(a.image, 'https://img.test/1-a.jpg');
  assert.deepEqual([a.priceFrom, a.currency, a.perPerson, a.rating, a.reviews, a.duration], [41, 'EUR', true, 4.7, 475, '3 hours']);
  assert.equal(acts.plainText('a/nb'), 'a b', 'list items joined by a literal /n');
  assert.ok(acts.plainText('word '.repeat(100), 50).length <= 51);
});

test('finds the top activities at a trip stop by its coordinates, with partner links to GetYourGuide and Klook', async () => {
  const t = (await call('create_trip', THAILAND_TRIP)).structuredContent.trip;
  const r = await call('find_activities', { trip_id: t.id, stop: 5, limit: 3 });
  assert.equal(r.isError, undefined, r.content[0].text);
  const s = r.structuredContent;
  assert.equal(s.place, 'Koh Lanta');
  const req = am.calls.at(-1);
  assert.equal(req.method, 'POST', 'a trip stop brings its day and the kind of traveller, so recommendations are used');
  assert.equal(req.key, 'am-test');
  const f = req.body.recommendationFilters;
  assert.ok(f.geoLocation.latitude && f.geoLocation.longitude && f.radius === 15);
  assert.equal(f.travelerType, 'couple');
  assert.match(f.travelDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(s.activities.length, 3);
  for (const a of s.activities) {
    assert.deepEqual(a.links.map((l) => l.site), ['GetYourGuide', 'Klook'], 'Amadeus\'s own link is left out once partner links are on');
    assert.ok(a.links.every((l) => l.url.startsWith('https://aviasales.tp.st/')), 'made into partner links');
    assert.equal(a.bookingUrl, undefined);
  }
  assert.deepEqual(s.more.map((l) => l.site), ['GetYourGuide', 'Klook']);
  const sent = fake.calls.at(-1).body.links.map((l) => l.url);
  assert.ok(sent.includes(acts.gygSearch('Tour 30 Koh Lanta')) && sent.includes(acts.klookSearch('Koh Lanta')));
  assert.match(r.content[0].text, /1\. Tour 30, from €70 pp, 4\.7★ \(475 reviews\), 3 hours/);
});

test('a city by name gets the top activities; filters switch to recommendations; duplicates and products without an id are dropped', async () => {
  let r = await call('find_activities', { place: 'Chiang Mai', limit: 5 });
  const top = am.calls.at(-1);
  assert.equal(top.path, '/recommendation/v1/top-activities');
  assert.deepEqual([top.query.cityName, top.query.maxRecommendations, top.query.currency], ['Chiang Mai', '5', 'EUR']);
  const ids = r.structuredContent.activities.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(r.structuredContent.activities.every((a) => a.title));

  r = await call('find_activities', { place: 'Chiang Mai', interests: ['street food'], max_price: 80, traveller_type: 'family', limit: 12 });
  const rec = am.calls.at(-1).body;
  assert.deepEqual([rec.maxRecommendations, rec.recommendationFilters.city, rec.recommendationFilters.interests, rec.recommendationFilters.maxPrice, rec.recommendationFilters.travelerType],
    [12, 'Chiang Mai', ['street food'], 80, 'family']);
  assert.equal(r.structuredContent.activities.length, 12);

  r = await call('find_activities', { place: 'Chiang Mai', interests: ['nothing'] });
  assert.match(r.content[0].text, /found no tours or activities in Chiang Mai with those filters/);
});

test('an unknown place, a missing place and the daily limit answer plainly', async () => {
  let r = await call('find_activities', { place: 'Atlantis' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /no tours or activities for Atlantis/);
  r = await call('find_activities', {});
  assert.match(r.content[0].text, /Give a place/);
  for (let i = 0; i < 3; i++) await call('find_activities', { place: 'Hanoi' });
  r = await call('find_activities', { place: 'Hanoi' });
  assert.match(r.content[0].text, /today's 5 activity searches/);
});

test('a GetYourGuide or Klook link the Links API can\'t convert stays a plain link, never an Aviasales-style marker=', async () => {
  tp._forget();
  const env = { TRAVELPAYOUTS_TOKEN: 't', TRAVELPAYOUTS_MARKER: '1', TRAVELPAYOUTS_TRS: '2' };
  const fetchImpl = async (url, opts) => {
    const { links } = JSON.parse(opts.body);
    return new Response(JSON.stringify({ result: { links: links.map((l) => (l.url.includes('klook') ? { url: l.url, code: 'brand_not_connected' } : { url: l.url, code: 'success', partner_url: 'https://gyg.tp.st/x' })) } }), { status: 200 });
  };
  const lines = [];
  const out = await tp.partnerLinks([acts.gygSearch('Rome'), acts.klookSearch('Rome')], { env, fetchImpl, fallback: 'plain', log: (l) => lines.push(l) });
  assert.deepEqual(out, ['https://gyg.tp.st/x', acts.klookSearch('Rome')]);
  assert.match(lines[0], /fell back to plain links/);
});

test('saves an activity as a local pick with its booking link and price', async () => {
  const r = await call('save_local_picks', { place: 'Koh Lanta', picks: [{ name: 'Four Islands snorkel trip', kind: 'activity', why: 'Most booked day trip from Lanta.', source_url: 'https://gyg.tp.st/x', book_url: 'https://gyg.tp.st/x', price_from: 35, currency: 'EUR' }] });
  const p = r.structuredContent.picks.find((x) => x.name === 'Four Islands snorkel trip');
  assert.deepEqual([p.book_url, p.price_from, p.currency], ['https://gyg.tp.st/x', 35, 'EUR']);
});

test('without an Amadeus key the tool is not offered', async () => {
  const s2 = await startServer(null, { AMADEUS_API_KEY: '' });
  const c2 = await connect(s2.url);
  const { tools } = await c2.listTools();
  assert.ok(!tools.some((t) => t.name === 'find_activities'));
  await c2.close(); s2.server.close();
});
