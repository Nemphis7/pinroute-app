// A stand-in for Amadeus Travel Builder's activity search (top activities and recommended products), answering the
// way Amadeus's guide shows: products with supplier HTML, unordered photos, a duplicate and one without a productId.
import { createServer } from 'node:http';

export const product = (n, extra = {}) => ({
  id: 17985854214047736 + n, productId: 57214960 + n, title: `Tour ${n}`,
  description: '<div><p>Experience <b>authentic</b> culture &amp; food.</p><script>alert(1)</script></div>',
  galleryImages: [{ url: `https://img.test/${n}-b.jpg`, order: 1 }, { url: `https://img.test/${n}-a.jpg`, order: 0 }],
  minPrice: 40 + n, maxPrice: 60 + n, priceCurrency: 'EUR', pricingUnit: 'PER_PERSON', bookingUrl: `https://to.discover-exp.com/${n}`,
  geoLocation: { latitude: 7.6, longitude: 99.03 }, rating: 4.7157893, numberOfRatings: 475, duration: '3 hours', cityName: 'Koh Lanta', ...extra,
});

export async function fakeAmadeus() {
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
