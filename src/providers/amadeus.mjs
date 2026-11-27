// Amadeus Travel Builder flight search (GET /api/v3/search/), mapped to Pinroute's fare shape.
// Rules from Amadeus's own guide: times are shown as returned (local, with offset); door-to-door time is first departure to
// last arrival using the offsets (bound.duration can be an hour off over a clock change); results are sorted here; deep links
// are used as returned and never stored, because prices are live.
import { airlineName } from '../airlines.mjs';

export const name = 'Amadeus Travel Builder';

const CABIN = { economy: 'ECONOMY', premium: 'PREMIUM_ECONOMY', business: 'BUSINESS', first: 'FIRST' };

export function buildUrl({ origin, destination, date, returnDate, adults = 1, children = 0, infants = 0, cabin = 'economy', nonstop = false, currency = 'EUR' }, base) {
  const o = origin.toUpperCase(), d = destination.toUpperCase();
  const q = new URLSearchParams({
    origins: returnDate ? `${o},${d}` : o,            // positional: leg i = origins[i] → destinations[i] on dates[i]
    destinations: returnDate ? `${d},${o}` : d,
    dates: returnDate ? `${date},${returnDate}` : date,
    locale: 'en-GB',
    flow: 'NETWORK',                                   // always NETWORK
    adults: String(adults),
    travel_class: CABIN[cabin] || 'ECONOMY',
    currency,
    number_of_results: '20',                           // per airline: enough to hold its cheapest fares after Pinroute's own filters
  });
  if (children) q.set('children', String(children));
  if (infants) q.set('infants', String(infants));
  if (nonstop) q.set('nonstop', 'true');             // a hint: each airline decides whether to apply it, so stops are filtered again later
  return `${base.replace(/\/$/, '')}/api/v3/search/?${q}`;
}

const mins = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);

function bagsText(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const b = list[0];
  if (b.type === 'piece') return `${b.quantity ?? 1} checked bag${(b.quantity ?? 1) === 1 ? '' : 's'} included`;
  if (b.type === 'weight' && b.weight_amount) return `${b.weight_amount} ${(b.weight_unit || 'KG').toLowerCase()} checked bag included`;
  return 'checked bag included';
}

export function mapResult(r, i, merchants = {}) {
  const bounds = (r.bounds || []).map((b) => {
    const f = b.flights || [];
    const first = f[0], last = f[f.length - 1];
    return {
      from: first?.origin?.airport, to: last?.destination?.airport,
      departs: first?.departs_at, arrives: last?.arrives_at,
      minutes: first && last ? mins(first.departs_at, last.arrives_at) : null,
      stops: Math.max(0, f.length - 1),
      changes: f.slice(1).map((x, j) => ({ at: x.origin?.airport, minutes: mins(f[j].arrives_at, x.departs_at), airportChange: f[j].destination?.airport !== x.origin?.airport })),
      flights: f.map((x) => ({ carrier: x.marketing_airline, number: `${x.marketing_airline}${x.flight_number}`, from: x.origin?.airport, to: x.destination?.airport, departs: x.departs_at, arrives: x.arrives_at, cabin: x.booking_infos?.[0]?.travel_class || null })),
      bags: bagsText(b.included_checked_bags),
    };
  });
  const seats = (r.bounds || []).flatMap((b) => (b.flights || []).flatMap((x) => (x.booking_infos || []).map((bi) => bi.seats_remaining))).filter((n) => n != null);
  return {
    id: `am_${i}_${r.merchant}`,
    provider: 'amadeus',
    merchant: r.merchant,
    airline: merchants[r.merchant]?.name || airlineName(r.merchant),     // the carrier list names most; a code left over gets its name here
    total: r.fare?.itinerary_price?.total_fare ?? null,
    perAdult: r.fare?.price_per_adult?.total_fare ?? null,
    currency: r.fare?.currency || 'EUR',
    bounds,
    bagsIncluded: bounds.every((b) => b.bags) ? true : null,     // absent means "not stated", not "none"
    seatsLeft: seats.length ? Math.min(...seats) : null,
    link: r.deep_link || null,
    demo: false,
  };
}

// The error body is either { message: "<JSON string>" } or a gateway { errors: [{ code, title, detail }] }
function errorText(status, body) {
  try {
    const j = JSON.parse(body);
    if (j.message) { try { return Object.entries(JSON.parse(j.message)).map(([k, v]) => `${k}: ${v}`).join('; '); } catch { return String(j.message); } }
    if (j.errors?.[0]) return j.errors[0].detail || j.errors[0].title || String(j.errors[0].code);
  } catch { /* not JSON */ }
  return `HTTP ${status}`;
}

export async function searchFlights(query, { fetchImpl = fetch, env = process.env } = {}) {
  const key = env.AMADEUS_API_KEY;
  if (!key) throw Object.assign(new Error('AMADEUS_API_KEY is not set'), { code: 'no_key' });
  const url = buildUrl(query, env.AMADEUS_GATEWAY_URL || 'https://api.amadeus.com');
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {                 // a 500 is retried once, nothing else is
    try { res = await fetchImpl(url, { headers: { 'X-API-Key': key, Accept: 'application/json' } }); }
    catch (e) { throw Object.assign(new Error(`Could not reach Amadeus from this server (${e.cause?.code || e.message}).`), { code: 'network' }); }
    if (res.status !== 500) break;
  }
  const body = await res.text();
  if (res.status === 429) throw Object.assign(new Error('Amadeus rate limit reached: try again in a few minutes.'), { code: 'rate_limited' });
  if (!res.ok) throw Object.assign(new Error(`Amadeus refused the search: ${errorText(res.status, body)}`), { code: res.status === 400 || res.status === 401 ? 'bad_request' : 'provider_error' });
  const j = JSON.parse(body);
  const fares = (j.results || []).map((r, i) => mapResult(r, i, j.meta?.carriers)).filter((f) => f.total != null).sort((a, b) => a.total - b.total);
  const noOffers = Object.keys(j.errors || {}).length;
  return {
    fares: fares.slice(0, 80),
    note: noOffers ? `${noOffers} airline${noOffers === 1 ? '' : 's'} had no offer for this search.` : '',
    requestId: j.request_id || null,
  };
}
