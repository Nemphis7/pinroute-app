// Airports and places: the lists Pinroute already uses.
// airports.json rows: [iata, city, name, countryCode, lat, lon, large, scheduled, airportsServed, foreignServed]
// (OurAirports, public domain; the route counts say how busy an airport is)
// places-th.json: Pinroute's curated Thailand stops, each with its nearest useful airport.
import { readFileSync } from 'node:fs';

const load = (f) => JSON.parse(readFileSync(new URL(`./data/${f}`, import.meta.url), 'utf8'));
const AIR = load('airports.json');
const PLACES = load('places-th.json').places;

// The city a traveller would say they fly to. OurAirports names the municipality the airport stands in, which for
// many gateways is a suburb or a district ("Narita", "Sepang", "Kuta, Badung", "Ferno (VA)"): a trip that lands at
// NRT should start in Tokyo, not Narita. The few big ones are named here; elsewhere a region or district after the
// town is left out ("Manchester, Greater Manchester", "Pisa (PI)", "Toulouse/Blagnac"). The municipality stays
// searchable.
const CITY = {
  NRT: 'Tokyo', KIX: 'Osaka', NGO: 'Nagoya', CTS: 'Sapporo', ICN: 'Seoul', TPE: 'Taipei', KUL: 'Kuala Lumpur', DPS: 'Bali',
  CXR: 'Nha Trang', PQC: 'Phu Quoc', USM: 'Koh Samui', CEB: 'Cebu', GOI: 'Goa', GOX: 'Goa', ISB: 'Islamabad', MFM: 'Macau',
  BRU: 'Brussels', CRL: 'Brussels', STN: 'London', LTN: 'London', SEN: 'London', MXP: 'Milan', LIN: 'Milan', BGY: 'Bergamo',
  ATH: 'Athens', SAW: 'Istanbul', EDI: 'Edinburgh', PIK: 'Glasgow', MRS: 'Marseille', LYS: 'Lyon', NCE: 'Nice', LIL: 'Lille',
  BSL: 'Basel', OTP: 'Bucharest', KRK: 'Kraków', WMI: 'Warsaw', LJU: 'Ljubljana', ZAG: 'Zagreb', SKP: 'Skopje', TIA: 'Tirana',
  LEJ: 'Leipzig', FKB: 'Karlsruhe', HHN: 'Hahn', CGN: 'Cologne', GRZ: 'Graz', VCE: 'Venice', TSF: 'Treviso', NAP: 'Naples',
  FLR: 'Florence', GOA: 'Genoa', TRN: 'Turin', VRN: 'Verona', ADB: 'Izmir', CHQ: 'Chania', CFU: 'Corfu', FUE: 'Fuerteventura',
  ACE: 'Lanzarote', MAH: 'Menorca', DJE: 'Djerba', OUD: 'Oujda', DMM: 'Dammam', MRU: 'Mauritius', SID: 'Sal', BVC: 'Boa Vista',
  RUN: 'Réunion', SEZ: 'Mahé', ANU: 'Antigua', VRA: 'Varadero', MVD: 'Montevideo', IAD: 'Washington', EWR: 'New York',
  GIG: 'Rio de Janeiro', SDJ: 'Sendai', FSZ: 'Shizuoka', IBR: 'Ibaraki', SPN: 'Saipan', KUT: 'Kutaisi', NYO: 'Stockholm', EMA: 'East Midlands', MLA: 'Malta',
};
const plainCity = (s) => String(s).replace(/\s*\(.*\)\s*$/, '').split(/\s*\/\s*/)[0].split(',')[0].trim() || String(s);
for (const r of AIR.a) {
  const city = CITY[r[0]] || plainCity(r[1]);
  if (city !== r[1]) { r[10] = r[1]; r[1] = city; }       // r[10]: the municipality as OurAirports has it
}
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
    const city = norm(r[1]), name = norm(r[2]), country = norm(COUNTRY[r[3]] || r[3]), muni = r[10] ? norm(r[10]) : '';
    const score = city === q ? 3 : city.startsWith(q) ? 2 : name.includes(q) || country === q || (muni && muni.startsWith(q)) ? 1 : 0;
    if (score) hits.push([score, r[8] || 0, r[0]]);
  }
  hits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const list = hits.slice(0, limit).map((h) => airport(h[2]));
  if (!exact) return list;
  // Three letters are a code or the start of a city: a small airport with that code ("MUN", Maturín) follows the
  // busy cities that start so ("Munich"); a big one ("BER") stays first
  const r = BY.get(exact.code), small = !r[6] && exact.served < 10;
  const ahead = small ? list.findIndex((a, i) => !(hits[i][0] >= 2 && a.served > exact.served)) : 0;
  list.splice(ahead < 0 ? list.length : ahead, 0, exact);
  return list.slice(0, limit);
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

// Airports with scheduled flights within `within` km of a point, busiest first. International ones fly abroad.
export function airportsNear(p, within, { international = true } = {}) {
  const out = [];
  for (const r of AIR.a) {
    if (!r[7] || (international && !r[9])) continue;
    const d = km(p, { lat: r[4], lon: r[5] });
    if (d <= within) out.push({ ...airport(r[0]), km: d, international: !!r[9] });
  }
  return out.sort((a, b) => b.served - a.served || a.km - b.km);
}

// A country's airports with flights abroad, one per city (its busiest), busiest first: where a trip there can land
export function countryAirports(cc, limit = 6) {
  const byCity = new Map();
  for (const r of AIR.a) {
    if (r[3] !== cc || !r[7] || !r[9]) continue;
    const city = String(r[1]).replace(/\s*\(.*\)\s*$/, '');
    if (!byCity.has(city) || (r[8] || 0) > (byCity.get(city)[8] || 0)) byCity.set(city, r);
  }
  return [...byCity.values()].sort((a, b) => (b[8] || 0) - (a[8] || 0)).slice(0, limit).map((r) => airport(r[0]));
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

// The country an airport is in, as its two-letter code
export const countryOf = (code) => BY.get(String(code || '').toUpperCase())?.[3] || null;
export const countryName = (cc) => COUNTRY[cc] || null;

// Places to visit in a country that a traveller can reach: one per city with scheduled flights (its busiest airport),
// busiest first. Used as the pins to tap when building a route on the map, where Pinroute has no curated list.
export function countryCities(cc, limit = 24) {
  const byCity = new Map();
  for (const r of AIR.a) {
    if (r[3] !== cc || !r[7]) continue;
    if (!byCity.has(r[1]) || (r[8] || 0) > (byCity.get(r[1])[8] || 0)) byCity.set(r[1], r);
  }
  return [...byCity.values()].sort((a, b) => (b[8] || 0) - (a[8] || 0)).slice(0, limit)
    .map((r) => ({ name: r[1], lat: r[4], lon: r[5], iata: r[0], region: COUNTRY[r[3]] || r[3], served: r[8] || 0 }));
}

// Pinroute's curated places for a country, when it has them (Thailand)
export const curatedPlaces = (cc) => (cc === 'TH' ? PLACES.map((p) => ({ id: p.id, name: p.name.split(' & ')[0], lat: p.lat, lon: p.lon, iata: p.iata, region: p.region, island: !!p.island })) : []);
