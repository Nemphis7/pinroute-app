// Finding the next trip, the way Pinroute's artifact did it: when the traveller is free, which countries have good
// weather then, roughly what a trip there costs, and whether a fare is a deal. Plain functions with no Node imports,
// so the server (for Claude) and the planner (bundled, for instant answers while the traveller clicks) share them.
import DATA from './data/destinations.json' with { type: 'json' };

// 60 countries. months is January to December: G good season, o mixed or shoulder, x poor (monsoon, hurricanes,
// extreme heat or deep winter). gw is the main gateway airport, tier the price level on the ground (1 cheap to 4).
export const REGIONS = DATA.regions;
export const DESTS = DATA.dests;
export const INTERESTS = ['city', 'culture', 'nature', 'beach'];
export const INTEREST_NAME = { city: 'Cities', culture: 'Culture', nature: 'Nature', beach: 'Beaches' };
export const LENGTHS = [[5, 8, 'About a week'], [9, 12, '10 days or so'], [13, 16, 'About two weeks'], [18, 23, 'Three weeks']];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON = MONTHS.map((m) => m.slice(0, 3));

const BY_ID = new Map(DESTS.map((d) => [d.id, d]));
export const destById = (id) => BY_ID.get(String(id)) || null;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ALIAS = {
  usa: '840', us: '840', 'united states of america': '840', america: '840', uk: '826', britain: '826', 'great britain': '826',
  england: '826', scotland: '826', wales: '826', uae: '784', emirates: '784', dubai: '784', 'viet nam': '704', korea: '410',
  'republic of korea': '410', turkiye: '792', 'cabo verde': '132', bali: '360', zanzibar: '834', 'dominican rep': '214',
};
// A country by its name, a common other name or its ISO numeric code
export function findDest(q) {
  const k = norm(q);
  if (!k) return null;
  return BY_ID.get(String(q)) || BY_ID.get(ALIAS[k]) || DESTS.find((d) => norm(d.name) === k) || DESTS.find((d) => norm(d.name).startsWith(k)) || null;
}

// ---- dates, as YYYY-MM-DD strings in UTC
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
export const monthOf = (iso) => Number(String(iso).slice(5, 7)) - 1;
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// The months a window touches, in order
export function windowMonths(from, until) {
  if (!isDate(from)) return [];
  const out = [];
  let d = `${from.slice(0, 8)}01`;
  const end = isDate(until) && until >= from ? until : from;
  while (d <= end && out.length < 12) { out.push(monthOf(d)); d = `${addDays(d, 32).slice(0, 8)}01`; }
  return out;
}

const SEASON_W = { G: 1, o: 0.5, x: 0 };
export const seasonFit = (d, months) => (months.length ? months.reduce((a, m) => a + SEASON_W[d.months[m]], 0) / months.length : 0.5);
export const fitLabel = (f) => (f >= 0.85 ? ['G', 'Great time to go'] : f >= 0.6 ? ['G', 'Good time'] : f >= 0.4 ? ['o', 'Mixed weather'] : ['x', 'Off season']);

// The good months as runs: "Nov–Apr", "May, Sep–Oct"
export function bestMonthsText(d) {
  const g = d.months.split('').map((c) => c === 'G');
  if (g.every(Boolean)) return 'all year';
  if (!g.some(Boolean)) return 'no clear season';
  const start = g.findIndex((v, i) => v && !g[(i + 11) % 12]);
  const runs = [];
  for (let k = 0; k < 12; k++) {
    const i = (start + k) % 12;
    if (g[i] && !g[(i + 11) % 12]) runs.push([i, i]);
    else if (g[i] && runs.length) runs[runs.length - 1][1] = i;
  }
  return runs.map(([a, b]) => (a === b ? MON[a] : `${MON[a]}–${MON[b]}`)).join(', ');
}

// The next twelve months from today: { ym, m, year, from, to }, leaving tomorrow at the earliest
export function nextMonths(today) {
  const tomorrow = addDays(today, 1), out = [];
  let first = `${today.slice(0, 8)}01`;
  for (let i = 0; i < 12; i++) {
    const next = `${addDays(first, 32).slice(0, 8)}01`;
    const last = addDays(next, -1);
    if ((first < tomorrow ? tomorrow : first) <= last) out.push({ ym: first.slice(0, 7), m: monthOf(first), year: first.slice(0, 4), from: first < tomorrow ? tomorrow : first, to: last });
    first = next;
  }
  return out;
}
// The months worth pricing for a country: its good ones in the coming year, topped up with mixed ones, at most four
export function monthsToCheck(d, today) {
  const ms = nextMonths(today);
  let pick = ms.filter((x) => d.months[x.m] === 'G');
  if (pick.length < 3) pick = pick.concat(ms.filter((x) => d.months[x.m] === 'o')).slice(0, 4).sort((a, b) => a.ym.localeCompare(b.ym));
  return pick.slice(0, 4);
}

// ---- distances, flight time and money
export function km(a, b) {
  if (a?.lat == null || b?.lat == null) return null;
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
// Rough hours in the air one way, with a change on long trips
export const flightHours = (k) => (k == null ? null : Math.round((k / 800 + (k > 4000 ? 2.5 : 0.7)) * 2) / 2);
// A rough return economy fare per person for the distance. Used only to call out deals; never shown as a price.
export const typicalFare = (k) => 120 + 0.07 * k;
export function dealLabel(ratio) {
  if (ratio == null) return null;
  return ratio < 0.7 ? ['deal3', 'Exceptional deal'] : ratio < 0.85 ? ['deal2', 'Great deal'] : ratio < 1 ? ['deal1', 'Good price']
    : ratio < 1.25 ? ['deal0', 'Typical price'] : ['dealx', 'Pricey'];
}

// Per price tier: a double room a night (simple, clean, mid-budget), food and local costs and trips per person a day
export const TIER = { 1: { room: 35, daily: 22, act: 12 }, 2: { room: 60, daily: 35, act: 18 }, 3: { room: 110, daily: 60, act: 28 }, 4: { room: 180, daily: 90, act: 40 } };
export function roughCost(d, { adults = 2, nights = 10, flightTotal = null, dist = null } = {}) {
  const t = TIER[d.tier] || TIER[2], n = Math.max(1, adults), rooms = Math.ceil(n / 2);
  const flights = flightTotal != null ? flightTotal : dist != null ? typicalFare(dist) * n : null;
  const ground = Math.round(nights * t.room * rooms + (nights + 1) * (t.daily + t.act) * n + (nights / 3) * 25 * n);
  return { flights: flights == null ? null : Math.round(flights), ground, total: flights == null ? null : Math.round(flights + ground), nights, perDay: Math.round(ground / (nights + 1)) };
}
export function budgetFit(cost, budget) {
  if (!budget || cost?.total == null) return null;
  const left = budget - cost.total;
  return left < 0 ? ['x', 'Over budget'] : left < budget * 0.1 ? ['o', 'Just fits budget'] : ['G', 'Fits budget'];
}

// ---- ranking the countries for a draft: weather in the window, interests, time in the air and budget
export function scoreDest(d, draft, home) {
  const fit = seasonFit(d, windowMonths(draft.from, draft.until));
  const tags = draft.interests || [];
  const tagFit = tags.length ? tags.filter((t) => d.tags.includes(t)).length / tags.length : 0.6;
  const dist = home ? km(home, d) : null;
  const hours = flightHours(dist);
  let travel = 0;
  if (hours != null) { const shortTrip = draft.maxNights <= 9; travel = hours > 13 ? (shortTrip ? 0.3 : 0.12) : hours > 9 ? (shortTrip ? 0.15 : 0.04) : 0; }
  const cost = roughCost(d, { adults: draft.adults, nights: Math.round((draft.minNights + draft.maxNights) / 2), dist });
  let money = 0;
  if (draft.budget && cost.total != null && cost.total > draft.budget) money = Math.min(0.35, (0.35 * (cost.total - draft.budget)) / draft.budget + 0.1);
  return { d, fit, dist, hours, cost, score: fit * 0.7 + tagFit * 0.3 - travel - money };
}
export const rankDests = (draft, home) => DESTS.filter((d) => !draft.regions?.length || draft.regions.includes(d.region))
  .map((d) => scoreDest(d, draft, home)).sort((a, b) => b.score - a.score);

// ---- deals: return fares saved for a country, from Pinroute's own search or from the traveller's flight tools
export const dealPP = (x) => x.price / Math.max(1, x.adults || 1);
// Nights away by the calendar: the day the flight leaves to the day the flight home leaves (14 → 30 June is 16 nights),
// whatever time the flights leave or land. The traveller counts so, and so does every screen and message.
export const dealNights = (x) => diffDays(x.depart, x.return);
export const dealFits = (x, draft) => dealNights(x) >= draft.minNights && dealNights(x) <= draft.maxNights;
export const dealRatio = (x) => (x.currency === 'EUR' && x.km ? dealPP(x) / typicalFare(x.km) : null);
// The fares for a window, cheapest first; fares outside the trip length go last
export function dealsFor(list, draft) {
  return (list || []).filter((x) => x.depart >= draft.from && x.depart <= draft.until)
    .map((x) => ({ ...x, fits: dealFits(x, draft) }))
    .sort((a, b) => (b.fits - a.fits) || dealPP(a) - dealPP(b));
}
