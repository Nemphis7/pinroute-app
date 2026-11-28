// The days of a stay with the kept picks in them: morning, afternoon and evening, the arrival day from the afternoon,
// the leaving day a morning. Each kind goes where it suits (dinner in the evening, a beach in the afternoon), spread
// over the days; a pick the traveller put on a day stays there. Pure, so the same picks always land the same way.
export const SLOTS = ['morning', 'afternoon', 'evening'];
const ROOM = { morning: 1, afternoon: 1, evening: 2 };              // dinner and a drink after
// The parts of the day each kind suits, best first
const SUITS = { food: ['evening', 'afternoon'], drink: ['evening'], beach: ['afternoon', 'morning'], view: ['evening', 'morning'],
  activity: ['morning', 'afternoon'], shop: ['afternoon', 'morning'], other: ['afternoon', 'morning', 'evening'] };

const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// stop: { arrive, depart, nights }; picks as saved; next: where the trip goes after, for the leaving day.
export function planDays(stop, picks = [], { next = null } = {}) {
  if (!stop?.nights || !stop.arrive) return null;
  const n = stop.nights;
  const days = Array.from({ length: n + 1 }, (_, i) => {
    const date = addDays(stop.arrive, i);
    const open = i === 0 ? ['afternoon', 'evening'] : i === n ? ['morning'] : SLOTS;
    return { date, i, open, tag: i === 0 ? 'Arrive' : i === n ? (next ? `Leave for ${next}` : 'Leave') : null, slots: { morning: [], afternoon: [], evening: [] } };
  });
  const kept = picks.filter((p) => p.status === 'keep' && p.kind !== 'stay');
  const load = (d) => SLOTS.reduce((a, s) => a + d.slots[s].length, 0);
  const rest = [];
  for (const p of kept) {
    const d = p.date && days.find((x) => x.date === p.date);
    if (!d) { rest.push(p); continue; }
    const slot = SLOTS.includes(p.slot) ? p.slot : (SUITS[p.kind] || SUITS.other).find((s) => d.open.includes(s)) || d.open[0];
    d.slots[slot].push({ ...p, pinned: true, slot });
  }
  for (const p of rest) {
    const suits = SUITS[p.kind] || SUITS.other;
    let best = null;
    for (const d of days) for (const s of SLOTS) {
      if (!d.open.includes(s)) continue;
      const rank = suits.indexOf(s);
      const same = SLOTS.reduce((a, z) => a + d.slots[z].filter((q) => q.kind === p.kind).length, 0);   // two dinners a day is one too many
      const score = (rank < 0 ? 6 : rank * 2) + load(d) * 3 + same * 5 + (d.i === n ? 2 : 0) + (d.slots[s].length >= ROOM[s] ? 100 : 0) + d.i * 0.01;
      if (!best || score < best.score) best = { d, s, score };
    }
    best.d.slots[best.s].push({ ...p, pinned: false, slot: best.s });
  }
  return days;
}
