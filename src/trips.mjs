// Dates and legs of a trip, worked out the same way Pinroute does.
import { airport, km } from './geo.mjs';

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Each stop with its arrival and departure dates
export function schedule(trip) {
  let day = trip.start;
  return trip.stops.map((s, i) => {
    const row = { i, ...s, arrive: day, depart: addDays(day, s.nights) };
    day = row.depart;
    return row;
  });
}

// Flights worth searching: home → first stop, between stops that are far apart and have different airports, last stop → home.
// Short hops (under 250 km, or the same airport) are left to road and ferry, as in Pinroute.
export function legs(trip) {
  const rows = schedule(trip), out = [];
  const home = trip.home ? airport(trip.home) : null;
  if (home && rows[0]?.iata && rows[0].iata !== home.code) {
    out.push({ key: `out|${home.code}|${rows[0].iata}|${trip.start}`, kind: 'out', from: home.code, to: rows[0].iata, fromName: home.city, toName: rows[0].place, date: trip.start });
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    const dist = km(a, b);
    const fly = a.iata && b.iata && a.iata !== b.iata && (dist == null || dist >= 250);
    out.push({ key: `leg|${a.iata || a.place}|${b.iata || b.place}|${a.depart}`, kind: fly ? 'flight' : 'ground', from: a.iata, to: b.iata, fromName: a.place, toName: b.place, date: a.depart, km: dist });
  }
  const last = rows[rows.length - 1];
  if (home && last?.iata && last.iata !== home.code) {
    out.push({ key: `home|${last.iata}|${home.code}|${last.depart}`, kind: 'home', from: last.iata, to: home.code, fromName: last.place, toName: home.city, date: last.depart });
  }
  return out;
}

export const endDate = (trip) => {
  const rows = schedule(trip);
  return rows.length ? rows[rows.length - 1].depart : trip.start;
};
