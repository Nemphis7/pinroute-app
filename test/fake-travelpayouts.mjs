// A stand-in for the Travelpayouts API: the two Data API calls Pinroute makes and the Links API, answering the way the
// documentation shows (prices per adult in euros, relative Aviasales links). It records what it was asked.
import { createServer } from 'node:http';

export async function fakeTravelpayouts({ token = 'tp-test' } = {}) {
  const routes = {};
  const app = { get: (p, fn) => { routes[`GET ${p}`] = fn; }, post: (p, fn) => { routes[`POST ${p}`] = fn; } };
  const calls = [];
  const pad = (n) => String(n).padStart(2, '0');
  const add = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const entry = (o, d, out, back, price) => ({
    origin: o, destination: d, origin_airport: o, destination_airport: d, price, airline: 'VJ', flight_number: '58',
    departure_at: `${out}T10:15:00+01:00`, return_at: back ? `${back}T21:40:00+07:00` : undefined, transfers: 1, return_transfers: back ? 1 : undefined,
    duration: 1500, duration_to: 760, duration_back: back ? 740 : undefined, link: `/search/${o}${out.slice(8, 10)}${out.slice(5, 7)}${d}${back ? `${back.slice(8, 10)}${back.slice(5, 7)}` : ''}1?t=VJ1`,
  });
  const authed = (req, res) => {
    if (req.headers['x-access-token'] !== token) { res.status(401).json({ success: false, error: 'Unauthorized' }); return false; }
    return true;
  };
  app.get('/aviasales/v3/prices_for_dates', (req, res) => {
    calls.push({ path: req.path, query: req.query });
    if (!authed(req, res)) return;
    const { origin: o, destination: d, departure_at: dep, return_at: ret } = req.query;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dep)) return res.json({ success: true, data: [entry(o, d, dep, ret, 333)], error: null });
    const data = [2, 9, 16, 23].map((n, i) => entry(o, d, `${dep}-${pad(n)}`, add(`${dep}-${pad(n)}`, 11), 290 + i * 40))
      .concat([entry(o, d, `${dep}-05`, add(`${dep}-05`, 3), 150)]);               // a short trip: too short for the window
    res.json({ success: true, data: data.sort((a, b) => a.price - b.price), error: null });
  });
  app.get('/aviasales/v3/grouped_prices', (req, res) => {
    calls.push({ path: req.path, query: req.query });
    if (!authed(req, res)) return;
    const { origin: o, destination: d, min_trip_duration: min, max_trip_duration: max, group_by: by, departure_at: dep } = req.query;
    if (by === 'departure_at') {                     // a day-by-day calendar for one month: the cheapest window from each day
      const data = {};
      for (let n = 1; n <= 28; n += 3) {
        const out = `${dep}-${pad(n)}`, nights = Number(min) + (n % (Number(max) - Number(min) + 1));
        data[out] = entry(o, d, out, add(out, nights), 300 + ((n * 53) % 170));
      }
      return res.json({ success: true, data });
    }
    const first = new Date();
    const data = {};
    for (let i = 1; i <= 12; i++) {
      const m = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1)).toISOString().slice(0, 7);
      data[m] = entry(o, d, `${m}-10`, add(`${m}-10`, Number(min) + 1), 400 + ((i * 37) % 200));
    }
    res.json({ success: true, data });
  });
  app.post('/links/v1/create', (req, res) => {
    calls.push({ path: req.path, body: req.body });
    if (!authed(req, res)) return;
    const { trs, marker, links } = req.body;
    res.json({ result: { trs, marker, shorten: true, links: links.map((l, i) => ({ url: l.url, code: 'success', partner_url: `https://aviasales.tp.st/fake${calls.length}x${i}` })) }, code: 'success', status: 200 });
  });
  // Plain node:http, with the little of Express's request and response these handlers use
  const server = createServer((rq, rs) => {
    const u = new URL(rq.url, 'http://x');
    let raw = '';
    rq.on('data', (c) => { raw += c; });
    rq.on('end', () => {
      const req = { path: u.pathname, query: Object.fromEntries(u.searchParams), headers: rq.headers, body: raw ? JSON.parse(raw) : {} };
      const res = { code: 200, status(n) { this.code = n; return this; }, json(v) { rs.writeHead(this.code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(v)); } };
      const fn = routes[`${rq.method} ${u.pathname}`];
      if (fn) fn(req, res); else res.status(404).json({ success: false, error: 'Not found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() };
}
