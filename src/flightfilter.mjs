// Filters, sorting and a summary ("facets") for fares in Pinroute's shape, whatever the source.
// Amadeus Travel Builder only takes nonstop as a hint (each airline decides whether to apply it), so every filter is
// applied here too, on the offers that come back. Times are compared as the airport's local clock time, as returned.

const clock = (iso) => String(iso || '').slice(11, 16);                 // "2027-01-03T21:00:00Z" → "21:00"
const inWindow = (t, after, before) => (!after || t >= after) && (!before || t <= before);

// Airline codes a fare flies with: the selling airline and every flight's carrier
export const carriersOf = (f) => [...new Set([f.merchant, ...f.bounds.flatMap((b) => b.flights.map((x) => x.carrier))].filter((c) => c && c !== 'XX'))];

function airlineMatch(f, wanted) {
  const codes = carriersOf(f);
  const name = String(f.airline || '').toLowerCase();
  return wanted.some((w) => (w.length === 2 ? codes.includes(w.toUpperCase()) : name.includes(w.toLowerCase())));
}

// Every filter is optional. Fares with a fact that isn't stated (bags) are kept only when that filter is off.
export function applyFilters(fares, q = {}) {
  return fares.filter((f) => {
    const [out, back] = f.bounds;
    if (q.max_stops != null && f.bounds.some((b) => b.stops > q.max_stops)) return false;
    if (q.max_hours != null && f.bounds.some((b) => b.minutes != null && b.minutes > q.max_hours * 60)) return false;
    if (q.max_price != null && f.total > q.max_price) return false;
    if (q.bag_included && !f.bounds.every((b) => b.bags)) return false;
    if (q.airlines?.length && !airlineMatch(f, q.airlines)) return false;
    if (q.exclude_airlines?.length && airlineMatch(f, q.exclude_airlines)) return false;
    if (out && !inWindow(clock(out.departs), q.depart_after, q.depart_before)) return false;
    if (out && q.arrive_before && clock(out.arrives) > q.arrive_before) return false;
    if (back && !inWindow(clock(back.departs), q.return_after, q.return_before)) return false;
    return true;
  });
}

const totalMinutes = (f) => f.bounds.reduce((n, b) => n + (b.minutes || 0), 0);

// price: cheapest first; duration: shortest first; departure: earliest first; best: price plus €15 an hour in the air
// and €25 a change, a rough trade-off so a slightly dearer direct flight beats a 20-hour one.
export function sortFares(fares, by = 'price') {
  const key = {
    price: (f) => f.total,
    duration: (f) => totalMinutes(f),
    departure: (f) => Date.parse(f.bounds[0]?.departs) || 0,
    best: (f) => f.total + (totalMinutes(f) / 60) * 15 + f.bounds.reduce((n, b) => n + b.stops, 0) * 25,
  }[by] || ((f) => f.total);
  return fares.slice().sort((a, b) => key(a) - key(b) || a.total - b.total);
}

// Same flights sold twice (two merchants, or the same date searched twice) collapse into the cheaper one
export function dedupe(fares) {
  const best = new Map();
  for (const f of fares) {
    const k = f.bounds.map((b) => b.flights.map((x) => `${x.number}@${x.departs}`).join('+')).join('|');
    const cur = best.get(k);
    if (!cur || f.total < cur.total) best.set(k, f);
  }
  return [...best.values()];
}

// What the results hold, so a filter bar can show only choices that change something
export function facets(fares) {
  if (!fares.length) return { count: 0, airlines: [], stops: {}, price: null, bagIncluded: 0 };
  const airlines = new Map();
  for (const f of fares) {
    const k = f.merchant && f.merchant !== 'XX' ? f.merchant : f.airline;
    const a = airlines.get(k) || { code: f.merchant && f.merchant !== 'XX' ? f.merchant : null, name: f.airline, count: 0, from: f.total };
    a.count++; a.from = Math.min(a.from, f.total);
    airlines.set(k, a);
  }
  const stops = {};
  for (const f of fares) { const s = Math.max(...f.bounds.map((b) => b.stops)); const k = s >= 2 ? '2+' : String(s); stops[k] = Math.min(stops[k] ?? Infinity, f.total); }
  const totals = fares.map((f) => f.total);
  return {
    count: fares.length,
    airlines: [...airlines.values()].sort((a, b) => a.from - b.from),
    stops,                                                              // cheapest per number of changes: { "0": 120, "1": 95 }
    price: { min: Math.min(...totals), max: Math.max(...totals), currency: fares[0].currency },
    bagIncluded: fares.filter((f) => f.bounds.every((b) => b.bags)).length,
  };
}
