// Tours and activities from Amadeus Travel Builder (the activity-search APIs), booked through partner links.
// - Top activities (GET /recommendation/v1/top-activities): the best-performing products at a place, at most 10.
// - Recommended products (POST /recommendation/v1/products): the same, filtered by interests, price, traveller type
//   and travel date, up to 1000.
// Both locate a search by coordinates, IATA code or English city name. Products come with Amadeus's own booking link
// (Holibob, which pays Pinroute nothing), so each one also gets a GetYourGuide and a Klook search for its title, made
// into Travelpayouts partner links when the partner ID is set: a booking through those can earn Pinroute a commission.
// Rules from Amadeus's guide: productId is the product's identity (id changes per call); description is supplier HTML
// and is reduced to plain text here; galleryImages come in no fixed order; bookingUrl can be missing.
import * as tp from './travelpayouts.mjs';

export const name = 'Amadeus Travel Builder';
export const configured = (env = process.env) => !!env.AMADEUS_API_KEY;
// Where product photos are served from (Holibob, Amadeus's activity supplier); the planner declares these to its host
export const IMAGE_DOMAINS = ['https://images.holibob.tech'];

const base = (env) => (env.AMADEUS_GATEWAY_URL || 'https://api.amadeus.com').replace(/\/$/, '');
const coded = (code, message) => Object.assign(new Error(message), { code });

// Supplier HTML to a short plain-text teaser
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function plainText(html, max = 220) {
  const t = String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e.toLowerCase()] ?? (/^#\d+$/.test(e) ? String.fromCharCode(Number(e.slice(1))) : m))
    .replace(/\/n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[\s,.;:–-]+$/, '')}…`;
}

// Where a traveller can book something like this, and earn Pinroute a commission
export const gygSearch = (q) => `https://www.getyourguide.com/s/?q=${encodeURIComponent(q)}`;
export const klookSearch = (q) => `https://www.klook.com/search/result/?query=${encodeURIComponent(q)}`;
const SITES = [['GetYourGuide', gygSearch], ['Klook', klookSearch]];

export function mapProduct(p) {
  const img = [...(p.galleryImages || [])].filter((g) => g?.url).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
  const hours = Number(p.durationHours);
  return {
    id: p.productId,
    title: String(p.title || '').trim(),
    summary: plainText(p.description),
    image: img?.url || null,
    priceFrom: typeof p.minPrice === 'number' && p.minPrice > 0 ? p.minPrice : null,
    currency: String(p.priceCurrency || 'EUR').toUpperCase(),
    perPerson: p.pricingUnit === 'PER_PERSON',
    rating: typeof p.rating === 'number' && p.rating > 0 ? Math.round(p.rating * 10) / 10 : null,
    reviews: Number(p.numberOfRatings) || 0,
    duration: p.duration || (hours > 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : null),
    city: p.cityName || null,
    lat: p.geoLocation?.latitude ?? null,
    lon: p.geoLocation?.longitude ?? null,
    bestseller: !!p.bestseller,
    cancellable: p.isCancellable ?? null,
    bookingUrl: p.bookingUrl || null,
  };
}

// The error body is a gateway { errors: [{ code, title, detail }] } or the API's own { code, title, detail }
function apiError(status, body) {
  let e = {};
  try { const j = JSON.parse(body); e = j.errors?.[0] || j; } catch { /* not JSON */ }
  const code = String(e.code ?? '');
  if (status === 429) return coded('rate_limited', 'Amadeus rate limit reached: try again in a few minutes.');
  if (code === '38187' || code === '38191' || status === 401) return coded('bad_key', 'Amadeus refused the API key; check AMADEUS_API_KEY.');
  if (code === '6025' || code === '6056') return coded('no_place', 'Amadeus has no tours or activities for this place.');
  if (code === '6503' && status >= 500) return coded('provider_error', 'Amadeus could not search activities right now (internal error).');
  return coded(status === 400 ? 'bad_request' : 'provider_error', `Amadeus refused the activity search: ${e.detail || e.title || `HTTP ${status}`}.`);
}

async function call(url, init, { env = process.env, fetchImpl = fetch } = {}) {
  if (!configured(env)) throw coded('no_key', 'AMADEUS_API_KEY is not set');
  let res;
  try {
    res = await fetchImpl(url, { ...init, headers: { 'X-API-Key': env.AMADEUS_API_KEY, Accept: 'application/json', ...init.headers }, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw coded('network', `Could not reach Amadeus from this server (${e.cause?.code || e.name || e.message}).`);
  }
  const body = await res.text();
  if (!res.ok) throw apiError(res.status, body);
  const j = JSON.parse(body || '[]');
  return Array.isArray(j) ? j : [];
}

// One search. `at` is { lat, lon } or { iata } or { city }; filters switch to recommended products.
export async function searchActivities({ at, radiusKm, interests = [], maxPrice, minPrice, travellerType, date, limit = 10, currency = 'EUR' }, ctx = {}) {
  const env = ctx.env || process.env;
  const filtered = interests.length || maxPrice != null || minPrice != null || travellerType || date || limit > 10;
  let raw;
  if (!filtered) {
    const q = new URLSearchParams({ maxRecommendations: String(Math.min(10, limit)), currency });
    if (at.lat != null) { q.set('lat', String(at.lat)); q.set('lon', String(at.lon)); } else if (at.iata) q.set('iataCode', at.iata); else q.set('cityName', at.city);
    if (radiusKm) q.set('radius', String(radiusKm));
    raw = await call(`${base(env)}/recommendation/v1/top-activities?${q}`, { method: 'GET' }, ctx);
  } else {
    const f = { currency };
    if (at.lat != null) f.geoLocation = { latitude: at.lat, longitude: at.lon }; else if (at.iata) f.iataCode = at.iata; else f.city = at.city;
    if (radiusKm) f.radius = radiusKm;
    if (interests.length) f.interests = interests;
    if (minPrice != null) f.minPrice = minPrice;
    if (maxPrice != null) f.maxPrice = maxPrice;
    if (travellerType) f.travelerType = travellerType;
    if (date) f.travelDate = date;
    f.tripContext = 'leisure';
    raw = await call(`${base(env)}/recommendation/v1/products`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maxRecommendations: limit, recommendationFilters: f }) }, ctx);
  }
  const seen = new Set();
  return raw.filter((p) => p && p.productId != null && p.title && !seen.has(p.productId) && seen.add(p.productId)).map(mapProduct).slice(0, limit);
}

// Booking links for each activity and for the place as a whole: GetYourGuide and Klook, as partner links when
// Travelpayouts is set up. A link the Links API can't convert (the program isn't connected yet) stays a plain link,
// because a marker= on GetYourGuide or Klook would not count. Amadeus's own link is kept only without a partner ID.
export async function withBookingLinks(list, place, ctx = {}) {
  const env = ctx.env || process.env;
  const partner = tp.linksOn(env);
  const query = (a) => (place && !a.title.toLowerCase().includes(place.toLowerCase()) ? `${a.title} ${place}` : a.title).slice(0, 120);
  const urls = [...list.flatMap((a) => SITES.map(([, f]) => f(query(a)))), ...(place ? SITES.map(([, f]) => f(place)) : [])];
  const made = await tp.partnerLinks(urls, { ...ctx, env, fallback: 'plain' });
  let i = 0;
  const activities = list.map((a) => {
    const links = SITES.map(([site]) => ({ site, url: made[i++] }));
    if (!partner && a.bookingUrl) links.push({ site: 'Amadeus', url: a.bookingUrl });
    const { bookingUrl, ...rest } = a;
    return { ...rest, links };
  });
  const more = place ? SITES.map(([site]) => ({ site, url: made[i++] })) : [];
  return { activities, more, partner };
}
