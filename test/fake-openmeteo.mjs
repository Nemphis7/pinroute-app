// A stand-in for Open-Meteo's historical weather and marine APIs: daily (or hourly) series shaped the way the
// documentation shows, made up from the latitude so the north has winter in January and the tropics a wet season.
import { createServer } from 'node:http';

export function fakeClimate(lat, m) {
  const north = lat >= 0, a = Math.abs(lat);
  const season = Math.cos(((m - (north ? 6.5 : 0.5)) / 12) * 2 * Math.PI);          // 1 at the height of summer
  const mean = 27 - Math.max(0, a - 15) * 0.55 + season * Math.min(14, a * 0.35);
  const wet = a < 25 ? Math.max(0, season) : Math.max(0, -season) * 0.6;           // tropics: rain in summer
  return { hi: mean + 5, lo: mean - 5, rain: 20 + wet * 260, wetDays: Math.round(3 + wet * 17), sun: 10 - wet * 5, sea: Math.min(30, mean + 1.5) };
}

export async function fakeOpenMeteo() {
  const calls = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), q = Object.fromEntries(u.searchParams);
    calls.push({ path: u.pathname, query: q });
    const lat = Number(q.latitude), from = q.start_date, to = q.end_date;
    const days = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Connection', 'close');
    if (u.pathname === '/v1/archive') {
      const c = days.map((d) => fakeClimate(lat, Number(d.slice(5, 7)) - 1));
      const dom = days.map((d) => Number(d.slice(8, 10)));
      return res.end(JSON.stringify({ latitude: lat, daily: {
        time: days,
        temperature_2m_max: c.map((x) => x.hi), temperature_2m_min: c.map((x) => x.lo),
        precipitation_sum: c.map((x, i) => (dom[i] <= x.wetDays ? x.rain / x.wetDays : 0)),
        sunshine_duration: c.map((x) => x.sun * 3600),
      } }));
    }
    if (u.pathname === '/v1/marine') {
      const time = days.flatMap((d) => [`${d}T00:00`, `${d}T12:00`]);
      return res.end(JSON.stringify({ latitude: lat, hourly: { time, sea_surface_temperature: time.map((t) => fakeClimate(lat, Number(t.slice(5, 7)) - 1).sea) } }));
    }
    res.statusCode = 400;
    res.end(JSON.stringify({ error: true, reason: 'Unknown path' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  server.unref();                                     // never what keeps a test run alive
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, calls, close: () => new Promise((r) => server.close(r)) };
}
