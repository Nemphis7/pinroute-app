// Travelpayouts, Aviasales's partner network: recent prices and partner links.
// - Data API (/aviasales/v3/prices_for_dates, /aviasales/v3/grouped_prices): the cheapest fares Aviasales users found,
//   kept for up to 7 days, low-cost airlines included. Prices are per adult. Not live: a fare has to be checked before
//   booking, which the link does.
// - Links API (/links/v1/create): turns an Aviasales link into the operator's partner link, so a booking made through
//   it counts for them. Each link is made once and remembered; if the API can't be reached, the link carries the
//   partner ID as marker= instead, the form Travelpayouts's own links take.
// - Trip.com flight links: the search Pinroute hands over for a route and dates, turned into a partner link by the same
//   Links API (the Travelpayouts project must be connected to the Trip.com program; until then the link stays plain).
// Settings: TRAVELPAYOUTS_TOKEN (Data and Links API), TRAVELPAYOUTS_MARKER (partner ID), TRAVELPAYOUTS_TRS (project ID).
// Aviasales's recent prices are off unless AVIASALES_PRICES=on: they were often far from what travellers could book, so
// flight prices come from the live airline search alone and the token is used only for partner links.
import { airlineName, withAirlineName } from '../airlines.mjs';

export const name = 'Aviasales';
export const configured = (env = process.env) => !!env.TRAVELPAYOUTS_TOKEN && /^(1|on|true|yes)$/i.test(String(env.AVIASALES_PRICES || ''));
export const linksOn = (env = process.env) => !!(env.TRAVELPAYOUTS_MARKER);
const base = (env) => (env.TRAVELPAYOUTS_API_URL || 'https://api.travelpayouts.com').replace(/\/$/, '');
const coded = (code, message) => Object.assign(new Error(message), { code });

async function get(path, params, { env = process.env, fetchImpl = fetch } = {}) {
  const url = `${base(env)}${path}?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]))}`;
  let res;
  try { res = await fetchImpl(url, { headers: { 'X-Access-Token': env.TRAVELPAYOUTS_TOKEN, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw coded('network', `Could not reach Travelpayouts from this server (${e.cause?.code || e.name || e.message}).`); }
  if (res.status === 401 || res.status === 403) throw coded('bad_token', 'Travelpayouts refused the API token; check TRAVELPAYOUTS_TOKEN.');
  if (res.status === 429) throw coded('rate_limited', 'Travelpayouts rate limit reached: try again in a minute.');
  if (!res.ok) throw coded('provider_error', `Travelpayouts answered ${res.status}.`);
  const j = await res.json();
  if (j.success === false) throw coded('provider_error', `Travelpayouts: ${j.error || 'the request failed'}.`);
  return j.data;
}

const day = (s) => (s ? String(s).slice(0, 10) : null);
const clock = (s) => String(s || '').slice(11, 16);
// One Data API entry as a fare: per adult, both directions, with the Aviasales link it came with. The API names the
// airline by its IATA code ("VJ"); the fare carries the name, and the flight number keeps the code ("VietJet Air VJ 58").
export function mapEntry(x) {
  const flight = x.airline && x.flight_number ? withAirlineName(`${x.airline} ${x.flight_number}`) : x.airline ? airlineName(x.airline) : null;
  return {
    from: x.origin_airport || x.origin, to: x.destination_airport || x.destination, depart: day(x.departure_at), return: day(x.return_at),
    pricePerAdult: Number(x.price), currency: String(x.currency || 'eur').toUpperCase(), airline: x.airline ? airlineName(x.airline) : 'Several airlines',
    out: `${flight ? `${flight}, ` : ''}${clock(x.departure_at)} ${x.origin_airport || x.origin} → ${x.destination_airport || x.destination}${x.transfers ? `, ${x.transfers} change${x.transfers > 1 ? 's' : ''}` : ', direct'}`,
    back: x.return_at ? `${clock(x.return_at)} ${x.destination_airport || x.destination} → ${x.origin_airport || x.origin}${x.return_transfers ? `, ${x.return_transfers} change${x.return_transfers > 1 ? 's' : ''}` : x.return_transfers === 0 ? ', direct' : ''}` : null,
    stops: Math.max(x.transfers ?? 0, x.return_transfers ?? 0), minutes: x.duration_to ?? null,
    url: x.link ? `https://www.aviasales.com${x.link.startsWith('/') ? '' : '/'}${x.link}` : null,
  };
}

// Return fares (or one-way ones, with oneWay) leaving in one month (YYYY-MM) or on one day, cheapest first
export async function pricesForDates({ origin, destination, departure, ret = null, limit = 100, oneWay = false }, ctx) {
  const data = await get('/aviasales/v3/prices_for_dates', {
    origin: origin.toUpperCase(), destination: destination.toUpperCase(), departure_at: departure, return_at: oneWay ? null : ret,
    one_way: oneWay ? 'true' : 'false', sorting: 'price', currency: 'eur', limit,
  }, ctx);
  return (Array.isArray(data) ? data : []).map(mapEntry).filter((f) => f.depart && (oneWay || f.return) && f.pricePerAdult > 0);
}

// The cheapest return fare for each month ahead, for trips of minDays to maxDays
export async function monthlyPrices({ origin, destination, minDays, maxDays }, ctx) {
  const data = await get('/aviasales/v3/grouped_prices', {
    origin: origin.toUpperCase(), destination: destination.toUpperCase(), group_by: 'month', currency: 'eur',
    min_trip_duration: minDays, max_trip_duration: maxDays,
  }, ctx);
  return Object.values(data && typeof data === 'object' ? data : {}).map(mapEntry).filter((f) => f.depart && f.return && f.pricePerAdult > 0);
}

// The cheapest return fare for each departure day of one month (YYYY-MM), for trips of minDays to maxDays: a calendar
// of travel windows in one request
export async function dayPrices({ origin, destination, month, minDays, maxDays }, ctx) {
  const data = await get('/aviasales/v3/grouped_prices', {
    origin: origin.toUpperCase(), destination: destination.toUpperCase(), group_by: 'departure_at', departure_at: month, currency: 'eur',
    min_trip_duration: minDays, max_trip_duration: maxDays,
  }, ctx);
  return Object.values(data && typeof data === 'object' ? data : {}).map(mapEntry).filter((f) => f.depart && f.return && f.pricePerAdult > 0)
    .sort((a, b) => a.depart.localeCompare(b.depart));
}

// An Aviasales search for a route and dates: FRA0103BKK15032 is Frankfurt to Bangkok on 1 March, back 15 March, 2 adults
export function searchUrl({ from, to, depart, ret, adults = 1 }) {
  const ddmm = (d) => `${d.slice(8, 10)}${d.slice(5, 7)}`;
  return `https://www.aviasales.com/search/${from.toUpperCase()}${ddmm(depart)}${to.toUpperCase()}${ret ? ddmm(ret) : ''}${Math.max(1, Math.min(9, adults))}`;
}

// A Trip.com search for a route and dates, round trip when there is a return date
export function tripSearchUrl({ from, to, depart, ret, adults = 1, currency = 'EUR' }) {
  const q = new URLSearchParams({ dcity: from.toLowerCase(), acity: to.toLowerCase(), ddate: depart });
  if (ret) q.set('rdate', ret);
  q.set('triptype', ret ? 'rt' : 'ow'); q.set('class', 'y'); q.set('quantity', String(Math.max(1, Math.min(9, adults)))); q.set('curr', currency);
  return `https://www.trip.com/flights/showfarefirst?${q}`;
}
// The Trip.com search as Pinroute's partner link when Travelpayouts can make one, else the plain search
export async function flightLink(args, ctx = {}) {
  const [url] = await partnerLinks([tripSearchUrl(args)], { ...ctx, fallback: 'plain' });
  return url;
}

const made = new Map();                        // Aviasales link → partner link, the last 2000
const withMarker = (url, env) => `${url}${url.includes('?') ? '&' : '?'}marker=${encodeURIComponent(env.TRAVELPAYOUTS_MARKER)}`;
// One warning line when links fall back to marker=, at most once per reason every 10 minutes so the logs stay readable.
// The reason names what went wrong, never a token, ID or link.
const warned = new Map();                      // reason → when it was last logged
function warnFallback(reason, count, log, how = 'marker=') {
  const now = Date.now();
  if (now - (warned.get(reason) || 0) < 10 * 60_000) return;
  warned.set(reason, now);
  log(`Travelpayouts partner links: ${count} link${count === 1 ? '' : 's'} fell back to ${how} (${reason}).`);
}
// Partner links for any number of brand links (Aviasales, GetYourGuide, Klook...), ten to a request, in the same order.
// A link that can't be converted gets marker= (how Aviasales counts it), or stays as it is with fallback 'plain', for
// brands where a marker= would not count.
export async function partnerLinks(urls, { env = process.env, fetchImpl = fetch, timeoutMs = 4000, log = console.warn, fallback = 'marker' } = {}) {
  if (!linksOn(env)) return urls.slice();
  const todo = [...new Set(urls.filter((u) => u && !made.has(u)))];
  const warn = (reason, count) => warnFallback(reason, count, log, fallback === 'plain' ? 'plain links' : 'marker=');
  if (todo.length && !(env.TRAVELPAYOUTS_TOKEN && env.TRAVELPAYOUTS_TRS)) {
    warn(`${env.TRAVELPAYOUTS_TOKEN ? 'TRAVELPAYOUTS_TRS' : 'TRAVELPAYOUTS_TOKEN'} is not set`, todo.length);
  } else if (todo.length) {
    for (let i = 0; i < todo.length; i += 10) {
      const batch = todo.slice(i, i + 10);
      let reason = null;
      try {
        const res = await fetchImpl(`${base(env)}/links/v1/create`, {
          method: 'POST', signal: AbortSignal.timeout(timeoutMs),
          headers: { 'X-Access-Token': env.TRAVELPAYOUTS_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ trs: Number(env.TRAVELPAYOUTS_TRS), marker: Number(env.TRAVELPAYOUTS_MARKER), shorten: true, links: batch.map((url) => ({ url, sub_id: 'pinroute' })) }),
        });
        if (!res.ok) reason = `Links API answered ${res.status}`;
        else {
          const j = await res.json();
          for (const l of j.result?.links || []) if (l.code === 'success' && l.partner_url) made.set(l.url, l.partner_url);
          const missed = batch.filter((u) => !made.has(u)).length;
          if (missed) warn('Links API did not return a partner link for them', missed);
        }
      } catch (e) {
        reason = e?.name === 'TimeoutError' ? `Links API took over ${timeoutMs / 1000}s` : `could not reach the Links API (${e?.cause?.code || e?.name || 'error'})`;
      }
      if (reason) { warn(reason, todo.length - i); break; }
    }
    while (made.size > 2000) made.delete(made.keys().next().value);
  }
  return urls.map((u) => (u ? made.get(u) || (fallback === 'plain' ? u : withMarker(u, env)) : u));
}
export const _forget = () => { made.clear(); warned.clear(); };      // for tests
