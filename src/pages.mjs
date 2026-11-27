// Public pages, for travellers and for the Claude directory listing: /help (setup, example prompts, tools),
// /privacy and /icon.svg. Who runs the server and how to reach them come from OPERATOR_NAME and SUPPORT_EMAIL,
// never from code; until they are set the pages say so plainly.
import { authConfig, publicUrl } from './auth.mjs';
import { VERSION } from './app.mjs';
import { flightProvider } from './providers/index.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const EXAMPLE_PROMPTS = [
  'I\'m free from 1 to 24 March for about two weeks, flying from Frankfurt. Where is good then? Plan a new trip in Pinroute.',
  'In Pinroute, find flight deals for Vietnam, Sri Lanka and Mexico for my new trip and save the best ones.',
  'When is the best time to go to Japan, and what do flights cost in those months? Use Pinroute.',
  'Plan the route for my Pinroute trip between the flights and save it.',
  'Plan a trip in Pinroute: Bangkok 2 nights, Khao Sok 2, Koh Lanta 4 and Ao Nang 3, for 2 adults from 14 November, then open the planner.',
  'Find flights for the Krabi to Bangkok leg of my Pinroute trip and save the one I pick.',
  'Find local favourites for Koh Lanta from recent posts and save them to my Pinroute trip.',
  'Delete my Pinroute data.',
];

const TOOLS = [
  ['open_planner', 'Shows the start screen, or the planner for a saved trip', 'Reads'],
  ['plan_new_trip', 'Shows the new-trip planner and saves your free dates, length, travellers, budget, airports, countries to compare, your wishes in your own words and a focus on part of a country; ranks 60 countries by the weather then', 'Writes'],
  ['scan_flight_deals', 'Looks up return fares to a country across your window or by month (recent prices from Aviasales), or live airline fares, also comparing departure and arrival airports for one pair of dates (Amadeus Travel Builder); keeps the cheapest', 'Writes'],
  ['save_flight_deals', 'Keeps return fares Claude found with any flight search, for one country', 'Writes'],
  ['start_trip_from_flight', 'Creates a trip from a saved fare: from landing to the flight home, with the fare on both flights', 'Writes'],
  ['set_trip_fare', 'Moves a trip to another saved fare: its dates follow the flights, nights are added to or taken from the longest stays', 'Changes'],
  ['create_trip', 'Saves a new multi-stop trip; dates and legs are worked out', 'Writes'],
  ['update_trip', 'Changes a trip: name, start, travellers, home airport or route', 'Changes'],
  ['delete_trip', 'Deletes one trip', 'Deletes'],
  ['list_trips', 'Lists your saved trips', 'Reads'],
  ['set_nights', 'Changes the nights at one stop; later dates move with it', 'Writes'],
  ['choose_flight', 'Saves the flight you picked for a leg, from any flight search', 'Writes'],
  ['clear_flight', 'Removes the flight saved for a leg', 'Deletes'],
  ['mark_leg', 'Marks a flight, ferry or drive as booked, with an optional note', 'Writes'],
  ['search_flights', 'Searches airline fares (Amadeus Travel Builder); daily limit per person', 'Reads'],
  ['flight_link', 'Makes a link to compare and book a flight on Aviasales (with Pinroute\'s partner ID when set up)', 'Reads'],
  ['find_airports', 'Finds airports by city, name or code, or all airports within a distance of a point; works without signing in', 'Reads'],
  ['find_activities', 'Finds tours, activities and tickets at a place or trip stop (Amadeus Travel Builder), with links to book on GetYourGuide or Klook; daily limit per person', 'Reads'],
  ['save_local_picks', 'Saves local favourites for a place, each with its source link', 'Writes'],
  ['get_local_picks', 'Returns the local favourites saved for a place', 'Reads'],
  ['calendar_link', 'Gives a link that adds a trip to Apple Calendar, Google Calendar or any calendar app, and follows later changes; can be renewed or switched off', 'Writes'],
  ['delete_my_data', 'Deletes everything you saved in Pinroute', 'Deletes'],
];

const CSS = `
:root{--bg:#fbfaf7;--fg:#1d2327;--muted:#5b6670;--line:#e3e0d8;--accent:#0e7490;--card:#ffffff;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121416;--fg:#e7e9ea;--muted:#9aa5ad;--line:#2a2f33;--accent:#5cc3d9;--card:#1a1d20;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:46rem;margin:0 auto;padding:2.5rem max(16px,env(safe-area-inset-right)) 4rem max(16px,env(safe-area-inset-left))}
header{display:flex;gap:1rem;align-items:center;margin-bottom:1.5rem}header img{width:56px;height:56px}
h1{font-size:1.9rem;line-height:1.2;margin:0;text-wrap:balance}h2{font-size:1.15rem;margin:2.2rem 0 .6rem}
p,li{max-width:65ch}.muted{color:var(--muted)}a{color:var(--accent)}
code,.url{font:0.92em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:.1em .4em;overflow-wrap:anywhere}
.prompts li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.7rem .9rem;margin:.5rem 0;list-style:none}.prompts{padding:0}
.table{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:.95rem}th,td{text-align:left;padding:.55rem .8rem;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:0}
th{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}footer{margin-top:3rem;font-size:.9rem}`;

function page(title, body, env) {
  const base = publicUrl(env);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="icon" href="/icon.svg"><style>${CSS}</style></head><body><main>
<header><img src="/icon.svg" alt=""><div><h1>${esc(title)}</h1></div></header>
${body}
<footer class="muted"><a href="${esc(base)}/help">Help</a> · <a href="${esc(base)}/privacy">Privacy</a> · Pinroute ${esc(VERSION)}</footer>
</main></body></html>`;
}

// Until OPERATOR_NAME and SUPPORT_EMAIL are set, bracketed placeholders show where they go
const contact = (env) => (env.SUPPORT_EMAIL ? `<a href="mailto:${esc(env.SUPPORT_EMAIL)}">${esc(env.SUPPORT_EMAIL)}</a>` : '[support email]');
const operator = (env) => (env.OPERATOR_NAME ? esc(env.OPERATOR_NAME) : '[operator name]');

export function helpPage(env = process.env) {
  const auth = authConfig(env);
  const base = publicUrl(env);
  const address = auth || !env.MCP_SECRET ? `${base}/mcp` : `${base}/mcp/<the secret you were given>`;
  const live = flightProvider(env).name !== 'Demo data';
  return page('Pinroute Trip Planner', `
<p>Plan trips inside Claude, starting from the days you are free or from where you want to go: see where the weather is good, compare flight deals, then plan the route and dates, the flight or ferry between stops, and local favourites for each place, together in one planner. Claude does the thinking on your own Claude plan; Pinroute keeps your trips.</p>
<h2>Two ways to start</h2>
<ul>
<li><b>I know when:</b> give your free days, how long to go and where you fly from (type an airport, or pick several on a map within the distance you would travel). Pinroute ranks 60 countries by the weather in those months, the flight time and your budget; tick a few and compare flight deals; plan the trip from the fare you like.</li>
<li><b>I know where:</b> pick a country and see its weather month by month for the next year, with the cheapest fares found for the good months; choose a month to see its flights.</li>
</ul>
<p>Already know what you want, such as <i>Indonesia, but only Sulawesi</i>? Write it under <b>What do you have in mind?</b> when you start, or just tell Claude. Claude sets up the planner from it: the country, the part of it you mean and that area's airports, so fares are looked up to Makassar or Manado instead of Jakarta, and the route stays in that area.</p>
<p>For a fare you like, <b>Same dates, other airports</b> compares the same dates from each of your departure airports to each of the country's main airports, with the cheapest route marked.</p>
<p>A deal is rated against a rough fare for the distance, about €120 plus 7 cents a km per person for a return economy ticket. It points out unusual prices; it is not a forecast.</p>
<h2>Looking after your trips</h2>
<p>Each trip has a <b>Trip</b> menu: <b>Rename and details</b> (name, first night, travellers, home airport), <b>Change flights</b> to move the trip to another fare you saved, or one Claude finds, with the dates and nights following the new flights, and <b>Delete trip</b>. <b>Add to calendar</b> puts the trip in Apple Calendar, Google Calendar (and so on Android) or any other calendar app: each stop with its dates and hotel, each flight, ferry and drive, and the tours you planned for a day. The calendar follows later changes to the trip by itself. The start screen lists your trips with Rename and Delete next to each, and <b>Start over</b> clears a new trip you no longer want.</p>
<h2>Add Pinroute to Claude</h2>
<ol>
<li>In Claude, open <b>Settings → Connectors</b> and choose <b>Add custom connector</b>.</li>
<li>Name it <b>Pinroute Trip Planner</b> and enter <span class="url">${esc(address)}</span></li>
<li>${auth ? 'Sign in when Claude asks. Your trips are saved to your own Pinroute account.' : 'This server has no sign-in yet: anyone with the address shares the same trips.'}</li>
</ol>
<p class="muted">The planner works in Claude on the web, in the desktop app and in the iOS and Android apps.</p>
<h2>Try these</h2>
<ul class="prompts">${EXAMPLE_PROMPTS.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
<h2>Flights</h2>
<p>${env.TRAVELPAYOUTS_TOKEN ? '<b>Recent prices</b> come from Aviasales: the cheapest fares its travellers found in the last days, low-cost airlines included. They are a guide, not live: check the price on Aviasales before booking. ' : ''}${live ? `${env.TRAVELPAYOUTS_TOKEN ? '<b>Live airline fares</b> come from' : 'Fare search uses'} Amadeus Travel Builder, which covers a set of mostly full-service airlines and links to their own sites. Many regional low-cost airlines are not included.` : 'This server shows demo fares, not real prices.'} ${live && env.TRAVELPAYOUTS_TOKEN ? ' Each flight search shows both quotes side by side, the airline fare and the Aviasales price, and says which is cheaper.' : ''} Searches can be narrowed to direct flights or a number of changes, departure and arrival times, airlines, fares with a checked bag, a longest flight time or a highest price, and can try the days around a date to find the cheapest day. The planner's <b>Ask Claude</b> button lets Claude search with any other flight tools you have connected in Claude, and save the flight you pick to your trip. Booking always happens on the airline's or booking site.</p>
${env.AMADEUS_API_KEY ? `<p><b>Tours and activities</b> at each stop come from Amadeus Travel Builder: the most popular ones, or ones matching what you ask for. Prices are a guide. You book on GetYourGuide or Klook, which show the live price and availability.${env.TRAVELPAYOUTS_MARKER ? ' These links carry Pinroute\'s partner ID with Travelpayouts: if you book through one, Pinroute may earn a commission. The price you pay is the same, and tours are never ranked by commission.' : ''}</p>` : ''}
<p><b>Compare on Aviasales</b> opens a search for the route and dates on Aviasales, where airlines and agencies show live prices.${env.TRAVELPAYOUTS_MARKER ? ' These links carry Pinroute\'s partner ID with Travelpayouts, Aviasales\'s partner network: if you book through one, Pinroute may earn a commission. The price you pay is the same, and fares are never ranked by commission.' : ''}</p>
<h2>What Pinroute can do</h2>
<div class="table"><table><thead><tr><th>Tool</th><th>What it does</th><th>Data</th></tr></thead><tbody>
${TOOLS.map(([n, d, k]) => `<tr><td><code>${n}</code></td><td>${esc(d)}</td><td>${k}</td></tr>`).join('')}
</tbody></table></div>
<h2>Your data</h2>
<p>Pinroute keeps the trips, chosen flights, new-trip draft and local picks you save, and nothing from your conversations. Ask Claude to <i>delete my Pinroute data</i> at any time. Details are in the <a href="${esc(base)}/privacy">privacy policy</a>.</p>
<h2>Support</h2>
<p>Run by ${operator(env)}. Questions and problems: ${contact(env)}.</p>`, env);
}

export function privacyPage(env = process.env) {
  const auth = authConfig(env);
  const region = env.HOSTING_REGION || 'the United States';
  const updated = env.PRIVACY_UPDATED || '23 November 2026';
  return page('Pinroute privacy policy', `
<p class="muted">Last updated ${esc(updated)}.</p>
<p>Pinroute is a trip planner that runs inside Claude. This page explains what Pinroute keeps about you, why, who else is involved and how to delete it. Pinroute is run by ${operator(env)}; you can reach us at ${contact(env)}.</p>
<h2>What Pinroute keeps</h2>
<ul>
<li><b>An account id.</b> ${auth ? 'When you sign in, the sign-in service gives Pinroute a random id for your account, and your data is stored under it. Pinroute never sees your password and does not store your name or email address.' : 'This server has no sign-in; everything is stored under one shared account.'}</li>
<li><b>Your trips:</b> their names, dates, places and nights, the number of travellers, your home airport, the flights you chose (a one-line summary, price, booking link and where it was found), which legs you marked as booked, any short note you added to a leg, and the wishes and area you planned it from.</li>
<li><b>Your new-trip draft:</b> the days you are free, the trip length, the number of travellers, a budget if you gave one, your departure airports, the regions, interests and countries you chose, what you wrote you have in mind and the part of a country you chose, and the return fares saved for them (airports, dates, price, airline, booking link and where it was found).</li>
<li><b>Local picks</b> saved for places: name, type, a short note, area and source link, and for a tour you kept, its booking link and price.</li>
<li><b>A calendar link</b> for a trip you added to your calendar: a long random address. Calendar apps can't sign in, so anyone with that address can see the trip's calendar; make a new link or switch it off in the planner's <b>Add to calendar</b>, or by asking Claude, and the old address stops working.</li>
<li><b>A count of your flight and activity searches per day</b>, kept for seven days, to apply the daily limit.</li>
</ul>
<p>Pinroute uses this data only to provide the planner you asked for. It has no ads, does not sell or share your data for marketing, does not track you across sites and sets no cookies.${env.TRAVELPAYOUTS_MARKER ? ' Links to Aviasales carry Pinroute\'s partner ID, so a booking made through one can earn Pinroute a commission; the partner ID identifies Pinroute, not you.' : ''}</p>
<h2>What Pinroute does not keep</h2>
<ul>
<li><b>Your conversations with Claude.</b> Pinroute only receives what Claude sends to its tools, such as the places and dates of a trip.</li>
<li><b>Flight search results.</b> They are passed back to Claude and not stored, unless you choose a flight or they are saved as fares for your new-trip draft.</li>
</ul>
<h2>Who else is involved</h2>
<ul>
<li><b>Anthropic</b> runs Claude, through which you use Pinroute. Your conversations are covered by Anthropic's privacy policy.</li>
${auth ? '<li><b>WorkOS</b> runs sign-in. It handles your login details under its own privacy policy; of what it sends, Pinroute uses only your account id.</li>' : ''}
<li><b>Railway</b> hosts the Pinroute server and its database in ${esc(region)}.</li>
<li><b>Amadeus</b> receives each live flight search (airports, dates, number of travellers and cabin) and each tour search (the place or its coordinates, the day, interests, budget and kind of traveller you gave), without your account id.</li>
${env.TRAVELPAYOUTS_TOKEN || env.TRAVELPAYOUTS_MARKER ? '<li><b>Travelpayouts</b> (Aviasales\'s partner network) receives the routes and months of recent-price look-ups and the Aviasales, GetYourGuide and Klook links Pinroute turns into partner links (route, dates, number of travellers, or a tour\'s name and place), without your account id. When you open such a link, that site\'s and Travelpayouts\'s own policies apply.</li>' : ''}
<li><b>Your calendar provider</b> (Apple, Google or another) fetches a trip's calendar from its address when you subscribe to it, and keeps a copy under its own policy.</li>
<li><b>Airlines and booking sites</b>: when you open a booking link, their own policies apply.</li>
</ul>
<h2>How long it is kept</h2>
<p>Your trips, draft and picks are kept until you delete them; fares in the draft whose departure has passed are dropped when new ones are saved. Ask Claude to delete a trip, or to <i>delete my Pinroute data</i> to remove everything at once; it is gone immediately and Pinroute keeps no backup copy. The hosting service keeps technical logs (time, address requested, response code) for a short period; they do not contain your trips.</p>
<h2>Your rights</h2>
<p>You can see your data in the planner, change it through Claude, delete it at any time as described above, and ask us for a copy or with any other request at ${contact(env)}. If you are in the EU or UK, you also have the right to complain to your data protection authority.</p>
<h2>Changes</h2>
<p>When this policy changes, the new version is posted here with a new date.</p>`, env);
}

// A pin at the end of a dotted route, on a deep teal tile
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Pinroute">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f8aa6"/><stop offset="1" stop-color="#0b5c70"/></linearGradient></defs>
<rect width="512" height="512" rx="116" fill="url(#g)"/>
<path d="M112 392 C 168 300, 236 430, 304 376" fill="none" stroke="#bdeff8" stroke-width="20" stroke-linecap="round" stroke-dasharray="0.1 40"/>
<circle cx="112" cy="392" r="26" fill="#ffd27a"/>
<path d="M336 92c-63 0-114 51-114 114 0 86 114 202 114 202s114-116 114-202c0-63-51-114-114-114z" fill="#fff"/>
<circle cx="336" cy="206" r="44" fill="#0d7590"/>
</svg>`;
