// A small in-memory cache for fare look-ups, shared by everyone on this server: the same route and dates asked again
// within a few minutes (by the same traveller or another) is answered from here, and doesn't count as a search.
export function makeCache(max = 1000) {
  const m = new Map();
  return {
    get(k) {
      const e = m.get(k);
      if (!e) return undefined;
      if (e.until < Date.now()) { m.delete(k); return undefined; }
      return e.value;
    },
    has(k) { return this.get(k) !== undefined; },
    set(k, value, ttlMs) {
      m.delete(k);
      m.set(k, { value, until: Date.now() + ttlMs });
      while (m.size > max) m.delete(m.keys().next().value);       // the oldest goes first
    },
    clear() { m.clear(); },
    get size() { return m.size; },
  };
}
