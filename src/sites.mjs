// Where the new-trip planner looks for flights. Pinroute's own search (live airline fares) runs on this server; the
// other sites are flight-search connectors the traveller can add to their own Claude. Pinroute can't call those: the
// planner asks Claude to search the ones the traveller picked and save what it finds with save_flight_deals, so the
// planner compares every site side by side. Pinroute's own search is the fallback when no site is picked.
// Skyscanner and Google Flights have no Claude connector, so they aren't offered.
export const SITES = [
  { id: 'pinroute', name: 'Pinroute', sub: 'Airline fares', own: true },
  { id: 'kiwi', name: 'Kiwi.com', sub: 'Searches whole date ranges', tool: 'search-flight', ranges: true },
  { id: 'expedia', name: 'Expedia', sub: 'Exact dates', tool: 'search_flights' },
  { id: 'edreams', name: 'eDreams', sub: 'Exact dates', tool: 'search_flights' },
  { id: 'lastminute', name: 'lastminute.com', sub: 'Exact dates', tool: 'search_flights' },
];
export const SITE_IDS = SITES.map((s) => s.id);
export const CONNECTOR_IDS = SITES.filter((s) => !s.own).map((s) => s.id);
export const siteById = (id) => SITES.find((s) => s.id === id) || null;
export const DEFAULT_SITES = ['pinroute'];

// The site a fare came from, by the source name it was saved with ("Kiwi.com", "kiwi", "eDreams Prime"…).
// Pinroute's own sources (Amadeus, the demo data, recent prices) count as Pinroute; any other source is null.
export function siteOf(source) {
  const s = String(source || '').toLowerCase().replace(/[^a-z]/g, '');
  if (s.includes('kiwi')) return 'kiwi';
  if (s.includes('expedia')) return 'expedia';
  if (s.includes('edreams')) return 'edreams';
  if (s.includes('lastminute')) return 'lastminute';
  if (/amadeus|demodata|aviasales|pinroute/.test(s)) return 'pinroute';
  return null;
}
