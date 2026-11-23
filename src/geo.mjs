// Airports and places: the lists Pinroute already uses.
// airports.json rows: [iata, city, name, countryCode, lat, lon, large, scheduled, airportsServed, foreignServed]
// (OurAirports, public domain; the route counts say how busy an airport is)
// places-th.json: Pinroute's curated Thailand stops, each with its nearest useful airport.
import { readFileSync } from 'node:fs';

const load = (f) => JSON.parse(readFileSync(new URL(`./data/${f}`, import.meta.url), 'utf8'));
const AIR = load('airports.json');
const PLACES = load('places-th.json').places;

const BY = new Map(AIR.a.map((r) => [r[0], r]));
const COUNTRY = AIR.c || {};
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function airport(code) {
  const r = BY.get(String(code || '').toUpperCase());
  return r ? { code: r[0], city: r[1], name: r[2], country: COUNTRY[r[3]] || r[3], lat: r[4], lon: r[5], served: r[8] || 0 } : null;
}

// Airports matching a code, a city or an airport name; busiest first.
export function findAirports(query, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const exact = q.length === 3 ? airport(q) : null;
  const hits = [];
  for (const r of AIR.a) {
    if (exact && r[0] === exact.code) continue;
    const city = norm(r[1]), name = norm(r[2]), country = norm(COUNTRY[r[3]] || r[3]);
    const score = city === q ? 3 : city.startsWith(q) ? 2 : name.includes(q) || country === q ? 1 : 0;
    if (score) hits.push([score, r[8] || 0, r[0]]);
  }
  hits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  return [...(exact ? [exact] : []), ...hits.slice(0, limit).map((h) => airport(h[2]))].slice(0, limit);
}

// A stop typed by the traveller ("Ao Nang", "Koh Lanta", "Hoi An") → name, coordinates and its airport. Pinroute's
// Thailand list knows its places; anywhere else Claude gives the nearest airport and, best, the place's own position.
export function resolvePlace(text, airportHint, { lat, lon, island } = {}) {
  const q = norm(text);
  const p = PLACES.find((x) => norm(x.id) === q.replace(/ /g, '-') || norm(x.name) === q || norm(x.short) === q)
    || PLACES.find((x) => norm(x.name).includes(q) || q.includes(norm(x.short)));
  const hint = airportHint ? airport(airportHint) : null;
  const at = Number.isFinite(lat) && Number.isFinite(lon);
  if (at && !p) {
    const a = hint || nearestAirport({ lat, lon });
    return { place: String(text).trim(), placeId: null, region: a?.country || null, lat, lon, iata: a?.code || null, island: !!island };
  }
  // The stop keeps the traveller's own words ("Khao Sok"), Pinroute's list adds where it is and its airport
  if (p) return { place: String(text).trim(), placeId: p.id, region: p.region, lat: p.lat, lon: p.lon, iata: hint ? hint.code : p.iata, island: p.island };
  const a = hint || findAirports(text, 1)[0];
  if (a) return { place: String(text).trim(), placeId: null, region: a.country, lat: a.lat, lon: a.lon, iata: a.code, island: !!island };
  return { place: String(text).trim(), placeId: null, region: null, lat: null, lon: null, iata: null, island: false };
}

// The busiest airport with scheduled flights within 150 km, else the closest one that has them
export function nearestAirport(p) {
  let best = null;
  for (const r of AIR.a) {
    if (!r[7]) continue;
    const d = km(p, { lat: r[4], lon: r[5] });
    if (d > 300) continue;
    const near = d <= 150;
    if (!best || (near && !best.near) || (near === best.near && (near ? (r[8] || 0) > best.served : d < best.d))) best = { code: r[0], d, near, served: r[8] || 0 };
  }
  return best ? airport(best.code) : null;
}

// Great-circle distance in km
export function km(a, b) {
  if (a?.lat == null || b?.lat == null) return null;
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
