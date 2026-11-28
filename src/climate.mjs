// What the weather is like in each month at a place: day and night temperatures, rain, sunshine and, for coasts, the
// sea. From Open-Meteo (free, no key): ten full years of daily ERA5 reanalysis from its historical weather API,
// averaged by month, and two years of hourly sea surface temperature from its marine API. A place's months barely
// change from year to year, so an answer is kept for 60 days in memory and in the database, shared by everyone.
import { makeCache } from './cache.mjs';
import * as store from './store.mjs';

const ARCHIVE = 'https://archive-api.open-meteo.com';
const MARINE = 'https://marine-api.open-meteo.com';
const TTL = 60 * 864e5;
const YEARS = 10;
const mem = makeCache(500), flying = new Map();
export const _clearClimateCache = () => { mem.clear(); flying.clear(); };

const round1 = (x) => Math.round(x * 10) / 10;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// Daily values to twelve months. time is YYYY-MM-DD (or YYYY-MM-DDTHH:MM for hourly).
export function monthly(daily, years) {
  const t = daily.time || [];
  const acc = Array.from({ length: 12 }, () => ({ hi: [], lo: [], rain: 0, wet: 0, sun: [] }));
  t.forEach((day, i) => {
    const m = Number(day.slice(5, 7)) - 1, a = acc[m];
    if (!a) return;
    const hi = daily.temperature_2m_max?.[i], lo = daily.temperature_2m_min?.[i], p = daily.precipitation_sum?.[i], s = daily.sunshine_duration?.[i];
    if (hi != null) a.hi.push(hi);
    if (lo != null) a.lo.push(lo);
    if (p != null) { a.rain += p; if (p >= 1) a.wet += 1; }
    if (s != null) a.sun.push(s / 3600);
  });
  const ys = years || new Set(t.map((d) => d.slice(0, 4))).size || 1;
  return acc.map((a) => (a.hi.length ? {
    hi: round1(mean(a.hi)), lo: round1(mean(a.lo)),
    rain: Math.round(a.rain / ys),                      // mm in an average month
    wet: Math.round(a.wet / ys),                        // days with at least 1 mm
    sun: a.sun.length ? round1(mean(a.sun)) : null,     // hours of sunshine a day
  } : null));
}

export function monthlySea(hourly) {
  const t = hourly.time || [], v = hourly.sea_surface_temperature || [];
  const acc = Array.from({ length: 12 }, () => []);
  t.forEach((x, i) => { if (v[i] != null) acc[Number(x.slice(5, 7)) - 1]?.push(v[i]); });
  const out = acc.map((a) => (a.length ? round1(mean(a)) : null));
  return out.some((x) => x != null) ? out : null;
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) throw new Error(`Open-Meteo answered ${res.status}${body?.reason ? `: ${body.reason}` : ''}`);
  return body;
}

// The months at a point. sea: also look up the sea temperature (only worth it for a coast).
export async function climateAt({ lat, lon, sea = false }, { env = process.env, fetchImpl = fetch, now = new Date() } = {}) {
  const last = now.getUTCFullYear() - 1, first = last - YEARS + 1;
  const ll = `latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}`;
  const base = (env.OPEN_METEO_ARCHIVE_URL || ARCHIVE).replace(/\/$/, ''), mbase = (env.OPEN_METEO_MARINE_URL || MARINE).replace(/\/$/, '');
  const land = getJson(`${base}/v1/archive?${ll}&start_date=${first}-01-01&end_date=${last}-12-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration&timezone=GMT`, fetchImpl);
  const water = sea
    ? getJson(`${mbase}/v1/marine?${ll}&start_date=${last - 1}-01-01&end_date=${last}-12-31&hourly=sea_surface_temperature&cell_selection=sea&timezone=GMT`, fetchImpl).catch(() => null)
    : Promise.resolve(null);
  const [l, w] = await Promise.all([land, water]);
  const months = monthly(l.daily || {}, YEARS);
  if (!months.some(Boolean)) throw new Error('Open-Meteo had no weather for this place');
  const seaT = w?.hourly ? monthlySea(w.hourly) : null;
  return {
    months: months.map((m, i) => (m ? { ...m, sea: seaT?.[i] ?? null } : null)),
    years: `${first}–${last}`,
    source: 'Open-Meteo (ERA5)',
  };
}

// The months for a place, cached: key names the place (a country id, or a country id and an airport)
export async function climateFor(key, at, opts = {}) {
  const k = `${key}|${at.lat.toFixed(2)},${at.lon.toFixed(2)}`;
  const hit = mem.get(k);
  if (hit) return hit;
  const kept = store.getShared(`climate|${k}`);
  if (kept && Date.parse(kept.updated) > Date.now() - TTL) { mem.set(k, kept.data, TTL); return kept.data; }
  if (flying.has(k)) return flying.get(k);
  const p = climateAt(at, opts).then((c) => {
    mem.set(k, c, TTL);
    store.putShared(`climate|${k}`, c);
    return c;
  }).finally(() => flying.delete(k));
  flying.set(k, p);
  try { return await p; } catch (e) { if (kept) return kept.data; throw e; }
}

// A sentence for Claude: the warmest, driest and sunniest months
export function climateText(c, MON) {
  const ms = c.months.map((m, i) => (m ? { ...m, i } : null)).filter(Boolean);
  if (!ms.length) return '';
  const top = (f, lo) => ms.slice().sort((a, b) => (lo ? f(a) - f(b) : f(b) - f(a)))[0];
  const rows = ms.map((m) => `${MON[m.i]} ${Math.round(m.lo)} to ${Math.round(m.hi)}°C, ${m.rain} mm rain on ${m.wet} days${m.sun != null ? `, ${m.sun} h sun a day` : ''}${m.sea != null ? `, sea ${Math.round(m.sea)}°C` : ''}`);
  return `Averages ${c.years} (${c.source}): ${rows.join('; ')}. Warmest ${MON[top((m) => m.hi).i]}, driest ${MON[top((m) => m.rain, true).i]}, sunniest ${MON[top((m) => m.sun ?? 0).i]}.`;
}
