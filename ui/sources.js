// Where the Flights step looks for fares: Pinroute's own airline search and the flight-search connectors the traveller
// can have in their own Claude (Kiwi.com, Expedia, eDreams, lastminute.com). The traveller taps the sites to use;
// Find flights runs Pinroute's search here and asks Claude to search the other sites across the dates and airports,
// then save the fares with save_flight_deals. Each country then shows every site's best fare side by side.
import { Check, Plus, Plug, TrendingDown, ExternalLink } from 'lucide';
import { SITES, siteById, siteOf } from '../src/sites.mjs';
import { dealPP, addDays, diffDays } from '../src/discover.mjs';
import { app, waiting } from './core.js';
import { h, icon, money, day, plural } from './dom.js';

// Where the traveller adds a connector in Claude
export const CONNECT_URL = 'https://claude.ai/settings/connectors';

// A site's monogram, in its own colour
const MARK = { pinroute: ['P', 190], kiwi: ['K', 170], expedia: ['E', 48], edreams: ['eD', 215], lastminute: ['lm', 330] };
const mark = (id, name) => {
  const [t, hue] = MARK[id] || [String(name || '?').slice(0, 2), 0];
  return h('span', { class: 'site-mark', style: `--hue:${hue}`, 'aria-hidden': 'true', text: t });
};

// The sites picked, never none: Pinroute's own search when nothing else is
export const pickedSites = (d) => (d.sites?.length ? d.sites : ['pinroute']);
export const connectorsPicked = (d) => pickedSites(d).filter((id) => !siteById(id)?.own);

// ---------------------------------------------------------------- the chips
// One chip per site, tapped on and off; a status line under them for a site that isn't connected or failed
export function sitePicker(d, { toggle, busy }) {
  const on = new Set(pickedSites(d));
  const status = d.siteStatus || {};
  const missing = [...on].filter((id) => status[id]?.status === 'not_connected');
  const failed = [...on].filter((id) => status[id]?.status === 'failed');
  const searching = waiting.sites;
  return h('section', { class: 'sites', 'aria-label': 'Where to search' },
    h('div', { class: 'sites-head' },
      h('p', { class: 'eyebrow', text: 'Search on' }),
      h('span', { class: 'small', text: on.size > 1 ? `${plural(on.size, 'site')}, compared side by side` : 'Tap the sites to compare' })),
    h('div', { class: 'site-chips', role: 'group', 'aria-label': 'Flight search sites' },
      SITES.map((x) => {
        const sel = on.has(x.id), st = status[x.id]?.status;
        return h('button', {
          class: `site-chip${sel ? ' on' : ''}${sel && st === 'not_connected' ? ' miss' : ''}`, 'aria-pressed': String(sel), disabled: busy,
          title: x.own ? 'Pinroute\'s own search of airline fares' : `Search ${x.name} with your ${x.name} connector in Claude`,
          onclick: () => toggle(x.id),
        },
        mark(x.id, x.name),
        h('span', { class: 'site-txt' }, h('b', { text: x.name }), h('span', { text: sel && st === 'not_connected' ? 'Not connected' : x.own ? x.sub : 'Claude connector' })),
        h('span', { class: 'site-tick' }, icon(sel ? Check : Plus)));
      })),
    searching ? h('p', { class: 'meta busy', text: `Claude is searching ${connectorsPicked(d).map((id) => siteById(id).name).join(', ')}…` }) : null,
    missing.length ? connectHelp(missing) : null,
    failed.length ? h('p', { class: 'note warn', text: failed.map((id) => `${siteById(id).name}: the search failed${status[id].note ? ` (${status[id].note})` : ''}.`).join(' ') }) : null,
    h('p', { class: 'small foot', text: 'Kiwi.com, Expedia, eDreams and lastminute.com are searched by Claude with your own connectors; Pinroute\'s search runs on its server. Skyscanner and Google Flights have no Claude connector yet.' }));
}

// How to add a connector the traveller picked but doesn't have
function connectHelp(ids) {
  const names = ids.map((id) => siteById(id).name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return h('div', { class: 'connect' },
    h('p', { class: 'connect-head' }, icon(Plug), h('b', { text: `${list} ${ids.length > 1 ? 'aren\'t' : 'isn\'t'} connected in your Claude yet` })),
    h('ol', {},
      h('li', { text: 'In Claude, open Settings → Connectors (or the + button in the chat box → Connectors).' }),
      h('li', { text: `Choose Browse connectors, search for ${names[0]}, and choose Connect.` }),
      h('li', { text: 'Come back here and tap Find flights again.' })),
    h('div', { class: 'acts' }, h('button', { class: 'ghost', onclick: () => app.openLink({ url: CONNECT_URL }).catch(() => {}) }, icon(ExternalLink), 'Open Connectors in Claude')));
}

// ---------------------------------------------------------------- the side by side
// Each site's cheapest fare for a country, per person, as bars; the cheapest marked. Tapping a site shows its fare.
export function siteCompare(d, list, { picked, pick }) {
  const by = new Map();
  for (const x of list) {
    const k = siteOf(x.source) || x.source;
    if (!by.has(k) || dealPP(x) < dealPP(by.get(k))) by.set(k, x);
  }
  if (by.size < 2) return null;
  const rows = [...by.entries()].sort((a, b) => dealPP(a[1]) - dealPP(b[1]));
  const lo = dealPP(rows[0][1]), hi = Math.max(...rows.map(([, x]) => dealPP(x)));
  return h('section', { class: 'site-cmp', 'aria-label': `${d.name}: best fare on each site` },
    h('p', { class: 'small', text: 'Best fare on each site, per person' }),
    rows.map(([k, x], i) => {
      const site = siteById(k);
      const save = i === 0 && rows[1] ? dealPP(rows[1][1]) - lo : 0;
      return h('button', { class: `sc-row${i === 0 ? ' win' : ''}${picked === x.id ? ' picked' : ''}`, 'aria-pressed': String(picked === x.id), onclick: () => pick(x) },
        mark(site?.id, site?.name || k),
        h('span', { class: 'sc-who' }, h('b', { text: site?.name || k }), h('span', { class: 'small', text: `${day(x.depart)} → ${day(x.return)} · ${x.from} → ${x.to} · ${x.airline}` })),
        h('span', { class: 'sc-bar' }, h('i', { style: `--w:${hi === lo ? 100 : Math.max(12, Math.round(100 - (60 * (dealPP(x) - lo)) / (hi - lo)))}%` })),
        h('span', { class: 'sc-price' }, h('b', { text: money(dealPP(x), x.currency) }),
          i === 0 && save > 0 ? h('span', { class: 'pill done' }, icon(TrendingDown), `${money(save, x.currency)} less`) : null));
    }));
}

// ---------------------------------------------------------------- the message to Claude
// The exact-date sites get a few date pairs to search: the cheapest windows found so far, else ones spread over the dates
function datePairs(dr, windows, deals) {
  const seen = new Set(), out = [];
  const add = (a, b) => { const k = `${a}|${b}`; if (!seen.has(k) && a >= dr.from && b <= dr.until && out.length < 3) { seen.add(k); out.push([a, b]); } };
  for (const w of (windows || []).slice().sort((a, b) => a.perAdult - b.perAdult)) add(w.depart, w.return);
  for (const x of (deals || []).slice().sort((a, b) => dealPP(a) - dealPP(b))) add(x.depart, x.return);
  const n = Math.round((dr.minNights + dr.maxNights) / 2), last = addDays(dr.until, -n), span = Math.max(0, diffDays(dr.from, last));
  for (const f of [0, 0.5, 1]) { const a = addDays(dr.from, Math.round(span * f)); add(a, addDays(a, n)); }
  return out;
}
const ddmmyyyy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function sitesMessage(dr, { countries, homes, stops }) {
  const ids = connectorsPicked(dr), names = ids.map((id) => siteById(id).name);
  const lastOut = addDays(dr.until, -dr.minNights);
  const stopTxt = stops == null ? '' : stops === 0 ? ', direct flights only' : ', at most one change each way';
  const lines = [
    `Find flight deals for my new trip in Pinroute with my own flight-search connectors in Claude: ${names.join(', ')}. Use only these sites for the search (Pinroute's own search already runs in the planner).`,
    `The trip: return flights for ${plural(dr.adults, 'adult')}, ${dr.minNights}–${dr.maxNights} nights, leaving ${dr.from} at the earliest and back by ${dr.until}${stopTxt}. Prices in EUR where the site lets me choose.`,
    `From: ${homes.join(', ')}.`,
    ...countries.map((c) => `To ${c.name} (country "${c.id}"): ${c.airports.join(', ')}.`),
  ];
  if (ids.includes('kiwi')) lines.push(`Kiwi.com (search-flight) searches date ranges: for each departure airport and each arrival airport, one search with departureDate ${ddmmyyyy(dr.from)}, departureDateTo ${ddmmyyyy(lastOut)}, nights_in_dst_from ${dr.minNights}, nights_in_dst_to ${dr.maxNights}, adults ${dr.adults}, currency EUR, sort price${stops == null ? '' : `, max_sector_stopovers ${stops}`}.`);
  const exact = ids.filter((id) => id !== 'kiwi').map((id) => siteById(id).name);
  if (exact.length) {
    lines.push(`${exact.join(', ')} search exact dates: for each departure and arrival airport, search these date pairs${ids.includes('kiwi') ? ', and the cheapest dates Kiwi.com finds' : ''}:`);
    for (const c of countries) lines.push(`- ${c.name}: ${c.pairs.map(([a, b]) => `${a} to ${b}`).join('; ')}`);
    lines.push('Keep to about 12 searches per site, main airports first.');
  }
  lines.push(
    `Then save each country's cheapest fares from each site, up to 5 per site, with Pinroute's save_flight_deals: source exactly ${names.map((n) => `"${n}"`).join(' / ')}, price the total for all travellers both ways, the fare's currency, the airline, out and back with flight numbers and times, stops, and link the site's booking link.`,
    `In the same call, report each site in sites (${ids.join(', ')}): searched, no_fares, not_connected if you don't have that connector, or failed with a short note. Report every site for every country, even with no fares.`,
    'The planner compares the sites side by side and refreshes itself; in the chat, one short line on the best deal is enough.',
  );
  return lines.join('\n');
}
export const pairsFor = datePairs;
