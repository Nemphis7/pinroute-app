// Made-up but steady fares, so the app runs before any API key arrives. Every fare is marked demo.
import { airport, km } from '../geo.mjs';
import { createHash } from 'node:crypto';

export const name = 'Demo data';

const DOMESTIC_TH = ['Thai AirAsia', 'Thai Lion Air', 'Nok Air', 'Thai Vietjet Air', 'Bangkok Airways', 'Thai Airways'];
const LONG_HAUL = ['Qatar Airways', 'Emirates', 'Etihad Airways', 'Turkish Airlines', 'Thai Airways', 'Lufthansa', 'Air China'];
const HUBS = ['DOH', 'DXB', 'AUH', 'IST', 'PEK', 'MCT'];

function rng(seed) {                                   // small deterministic generator
  let h = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

function bound(r, from, to, dateIso, dist) {
  const longHaul = dist > 3000;
  const stops = longHaul ? (r() < 0.25 ? 0 : r() < 0.7 ? 1 : 2) : (r() < 0.85 ? 0 : 1);
  const air = Math.round(40 + (dist / 800) * 60);
  const waits = Array.from({ length: stops }, () => Math.round(60 + r() * (longHaul ? 600 : 180)));
  const dep = Date.parse(`${dateIso}T00:00:00Z`) + Math.round((6 + r() * 16) * 4) * 15 * 60000;
  const total = air + waits.reduce((a, b) => a + b, 0);
  const hubs = waits.map((_, i) => HUBS[Math.floor(r() * HUBS.length + i) % HUBS.length]);
  const points = [from, ...hubs, to];
  let t = dep;
  const flights = points.slice(0, -1).map((p, i) => {
    const leg = Math.round(air / (stops + 1));
    const f = { carrier: 'XX', number: `XX${100 + Math.floor(r() * 899)}`, from: p, to: points[i + 1], departs: iso(t), arrives: iso(t + leg * 60000), cabin: 'ECONOMY' };
    t += (leg + (waits[i] || 0)) * 60000;
    return f;
  });
  return { from, to, departs: iso(dep), arrives: iso(dep + total * 60000), minutes: total, stops, changes: waits.map((m, i) => ({ at: hubs[i], minutes: m, airportChange: false })), flights, bags: r() < 0.4 ? '1 checked bag included' : null };
}

export async function searchFlights({ origin, destination, date, returnDate, adults = 1, currency = 'EUR' }) {
  const a = airport(origin), b = airport(destination);
  const dist = km(a, b) ?? 1000;
  const r = rng(`${origin}|${destination}|${date}|${returnDate || ''}`);
  const thai = a?.country === 'Thailand' && b?.country === 'Thailand';
  const names = thai ? DOMESTIC_TH : LONG_HAUL;
  const fares = Array.from({ length: 8 }, (_, i) => {
    const out = bound(r, origin, destination, date, dist);
    const back = returnDate ? bound(r, destination, origin, returnDate, dist) : null;
    const per = Math.round((25 + dist * (thai ? 0.07 : 0.055)) * (0.75 + r() * 0.8) * (returnDate ? 1.7 : 1));
    return {
      id: `demo_${i}`, provider: 'demo', merchant: 'XX', airline: names[i % names.length],
      total: per * adults, perAdult: per, currency, bounds: back ? [out, back] : [out],
      bagsIncluded: out.bags ? true : null, seatsLeft: r() < 0.3 ? 1 + Math.floor(r() * 5) : null,
      link: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${origin} to ${destination} on ${date}${returnDate ? ` through ${returnDate}` : ''}`)}`,
      demo: true,
    };
  }).sort((x, y) => x.total - y.total);
  return { fares, note: 'Demo fares: made up to show the planner. Add an Amadeus key for live prices.', requestId: null };
}
