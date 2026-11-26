// Travelpayouts, Aviasales's partner network: recent prices and partner links.
// - Data API (/aviasales/v3/prices_for_dates, /aviasales/v3/grouped_prices): the cheapest fares Aviasales users found,
//   kept for up to 7 days, low-cost airlines included. Prices are per adult. Not live: a fare has to be checked before
//   booking, which the link does.
// - Links API (/links/v1/create): turns an Aviasales link into the operator's partner link, so a booking made through
//   it counts for them. Each link is made once and remembered; if the API can't be reached, the link carries the
//   partner ID as marker= instead, the form Travelpayouts's own links take.
// Settings: TRAVELPAYOUTS_TOKEN (Data and Links API), TRAVELPAYOUTS_MARKER (partner ID), TRAVELPAYOUTS_TRS (project ID).
import { airlineName, withAirlineName } from '../airlines.mjs';

export const name = 'Aviasales';
export const configured = (env = process.env) => !!env.TRAVELPAYOUTS_TOKEN;
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

// Return fares leaving in one month (YYYY-MM) or on one day, cheapest first
export async function pricesForDates({ origin, destination, departure, ret = null, limit = 100 }, ctx) {
  const data = await get('/aviasales/v3/prices_for_dates', {
    origin: origin.toUpperCase(), destination: destination.toUpperCase(), departure_at: departure, return_at: ret,
    one_way: 'false', sorting: 'price', currency: 'eur', limit,
  }, ctx);
  return (Array.isArray(data) ? data : []).map(mapEntry).filter((f) => f.depart && f.return && f.pricePerAdult > 0);
}

// The cheapest return fare for each month ahead, for trips of minDays to maxDays
export async function monthlyPrices({ origin, destination, minDays, maxDays }, ctx) {
  const data = await get('/aviasales/v3/grouped_prices', {
    origin: origin.toUpperCase(), destination: destination.toUpperCase(), group_by: 'month', currency: 'eur',
    min_trip_duration: minDays, max_trip_duration: maxDays,
  }, ctx);
  return Object.values(data && typeof data === 'object' ? data : {}).map(mapEntry).filter((f) => f.depart && f.return && f.pricePerAdult > 0);
}

// An Aviasales search for a route and dates: FRA0103BKK15032 is Frankfurt to Bangkok on 1 March, back 15 March, 2 adults
export function searchUrl({ from, to, depart, ret, adults = 1 }) {
  const ddmm = (d) => `${d.slice(8, 10)}${d.slice(5, 7)}`;
  return `https://www.aviasales.com/search/${from.toUpperCase()}${ddmm(depart)}${to.toUpperCase()}${ret ? ddmm(ret) : ''}${Math.max(1, Math.min(9, adults))}`;
}

const made = new Map();                        // Aviasales link → partner link, the last 2000
const withMarker = (url, env) => `${url}${url.includes('?') ? '&' : '?'}marker=${encodeURIComponent(env.TRAVELPAYOUTS_MARKER)}`;
// One warning line when links fall back to marker=, at most once per reason every 10 minutes so the logs stay readable.
// The reason names what went wrong, never a token, ID or link.
const warned = new Map();                      // reason → when it was last logged
function warnFallback(reason, count, log) {
  const now = Date.now();
  if (now - (warned.get(reason) || 0) < 10 * 60_000) return;
  warned.set(reason, now);
  log(`Travelpayouts partner links: ${count} link${count === 1 ? '' : 's'} fell back to marker= (${reason}).`);
}
// Partner links for up to any number of Aviasales links, ten to a request, in the same order
export async function partnerLinks(urls, { env = process.env, fetchImpl = fetch, timeoutMs = 4000, log = console.warn } = {}) {
  if (!linksOn(env)) return urls.slice();
  const todo = [...new Set(urls.filter((u) => u && !made.has(u)))];
  if (todo.length && !(env.TRAVELPAYOUTS_TOKEN && env.TRAVELPAYOUTS_TRS)) {
    warnFallback(`${env.TRAVELPAYOUTS_TOKEN ? 'TRAVELPAYOUTS_TRS' : 'TRAVELPAYOUTS_TOKEN'} is not set`, todo.length, log);
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
          if (missed) warnFallback('Links API did not return a partner link for them', missed, log);
        }
      } catch (e) {
        reason = e?.name === 'TimeoutError' ? `Links API took over ${timeoutMs / 1000}s` : `could not reach the Links API (${e?.cause?.code || e?.name || 'error'})`;
      }
      if (reason) { warnFallback(reason, todo.length - i, log); break; }
    }
    while (made.size > 2000) made.delete(made.keys().next().value);
  }
  return urls.map((u) => (u ? made.get(u) || withMarker(u, env) : u));
}
export const _forget = () => { made.clear(); warned.clear(); };      // for tests
