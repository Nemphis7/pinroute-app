// The places a traveller can tap to build a route on the map: Pinroute's curated places where it has them
// (Thailand), the cities with scheduled flights elsewhere, and the places Claude suggested for the trip
// (save_route_ideas). One pin per place: a stop already on the route, or a place Claude named, wins over a city
// close to it.
import { countryOf, countryName, countryCities, curatedPlaces, km } from './geo.mjs';
import { destById } from './discover.mjs';

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The countries the trip is in: the one it was planned for, else those of its stops, most nights first
export function tripCountries(trip) {
  const d = trip.country ? destById(trip.country) : null;
  if (d?.cc) return [d.cc];
  const nights = {};
  for (const s of trip.stops) { const cc = countryOf(s.iata); if (cc) nights[cc] = (nights[cc] || 0) + (s.nights || 0) + 0.1; }
  return Object.entries(nights).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cc]) => cc);
}

export function routePlaces(trip, { limit = 28 } = {}) {
  const ccs = tripCountries(trip);
  const out = [];
  const near = (p, within) => out.find((q) => q.name.toLowerCase() === p.name.toLowerCase() || (km(q, p) ?? 1e9) < within);
  const add = (p, within) => { if (Number.isFinite(p.lat) && Number.isFinite(p.lon) && !near(p, within)) out.push(p); };
  for (const i of trip.ideas || []) add({ id: `idea-${slug(i.place)}`, name: i.place, lat: i.lat, lon: i.lon, iata: i.iata || null, island: !!i.island, region: i.region || null, why: i.why || null, from: 'claude' }, 2);
  for (const cc of ccs) for (const p of curatedPlaces(cc)) add({ ...p, from: 'pinroute' }, 4);
  const per = Math.max(8, Math.round(limit / Math.max(1, ccs.length)));
  for (const cc of ccs) for (const c of countryCities(cc, per)) if (out.length < limit) add({ id: `air-${c.iata.toLowerCase()}`, name: c.name, lat: c.lat, lon: c.lon, iata: c.iata, island: false, region: c.region, from: 'airport' }, 25);
  return { countries: ccs.map((cc) => countryName(cc) || cc), places: out };
}
