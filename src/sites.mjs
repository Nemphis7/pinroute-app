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

// A site's own search page for a return trip, for a fare saved without a booking link (Expedia's connector gives none):
// the Book button then opens the same search on that site. Null for a site without such a page.
export function searchLink(site, { from, to, back_from, depart, return: ret, adults = 1 }) {
  const home = back_from || to;
  const us = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
  switch (site) {
    case 'expedia':
      return `https://www.expedia.com/Flights-Search?trip=roundtrip&leg1=${encodeURIComponent(`from:${from},to:${to},departure:${us(depart)}TANYT`)}`
        + `&leg2=${encodeURIComponent(`from:${home},to:${from},departure:${us(ret)}TANYT`)}&passengers=${encodeURIComponent(`adults:${adults},children:0,infantinlap:N`)}&mode=search&options=cabinclass%3Aeconomy`;
    case 'edreams':
      return `https://www.edreams.com/travel/?searchMainProductTypeName=FLIGHT&deeplink=${encodeURIComponent(`/results/type=R;dep=${depart};ret=${ret};from.iata=${from};to.iata=${to};adults=${adults};children=0;infants=0;class=TOURIST`)}`;
    case 'kiwi':
      return `https://www.kiwi.com/en/search/results/${from}/${to}/${depart}/${ret}?adults=${adults}`;
    case 'lastminute':
      return `https://www.lastminute.com/flights/search?from=${from}&to=${to}&departure=${depart}&return=${ret}&adults=${adults}`;
    default:
      return null;
  }
}
