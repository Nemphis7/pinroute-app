# Pinroute app

Pinroute as an **MCP App**: a trip planner that runs inside Claude. A trip usually starts from the traveller's own words ("I want to go on a trip to Japan in April"): Claude fills the draft from them and the planner opens at the first step still open. Set up by hand, it starts from the days the traveller is free (**I know when**: When → Where → Flights) or from a country (**I know where**: Country → Best time → Flights). It ends with a trip planned around the fare they picked, where Claude suggests two or three routes to compare on the map. Each traveller uses their own Claude plan for the AI work; this server keeps each person's trips and new-trip draft, ranks 60 countries by season, finds airports, searches airline fares, keeps the flight deals found and stores the local picks Claude researched.

Why inside Claude: Anthropic does not allow other apps to offer a Claude login or to run on people's Claude plans ([policy](https://code.claude.com/docs/en/legal-and-compliance)). An app that runs inside Claude, as a connector with its own screen, is the supported way.

## How it works

```
Claude (the traveller's own plan)
 ├─ talks with the traveller; researches flights, routes and local picks with its own tools
 ├─ calls this server's tools ──── token from the sign-in service ────► Pinroute server (this repo)
 └─ shows the planner (ui/, one HTML; Back, Home, New trip, Trips)       ├─ checks the token (src/auth.mjs)
      ├─ start screen: your words, I know when / where, the trips         ├─ trips, draft, fares, picks per person (SQLite on the volume)
      ├─ new trip: When → Where → Flights, Country → Best time → Flights  ├─ 60 countries by season and price level (src/discover.mjs)
      ├─ a trip: route (or build it on the map), flights, ferries, local picks                     ├─ airports and Thailand places (src/data)
      └─ "Ask Claude": Claude searches with the traveller's tools ──────► └─ fares: Amadeus Travel Builder, or demo
```

| Tool | What it does | Data |
| --- | --- | --- |
| `open_planner` | The start screen, or a trip (the MCP App screen) | reads |
| `plan_new_trip` | The new-trip planner; saves free dates, length, travellers, budget, airports, regions, interests, countries to compare, the traveller's wishes and a focus on part of a country (its airports are used for fares) | writes |
| `scan_flight_deals` | Return fares to a country: recent prices across the window or by month (Travelpayouts), or live fares (Amadeus) including one pair of dates across several departure and arrival airports; keeps the cheapest | writes |
| `save_flight_deals` | Keeps fares Claude found with any flight search, per country | writes |
| `add_booked_flight` | Flights the traveller booked themselves, read by Claude from a pasted booking or filled in on the planner: a new trip from them, a trip fitted to them, or one leg of the route; no search, the legs marked booked with the booking reference, times in the calendar | writes |
| `start_trip_from_flight` | A trip from a saved fare: from landing to the flight home, the fare on both flights | writes |
| `set_trip_fare` | Moves a trip to another saved fare: dates follow the flights, nights go to or come from the longest stays, a new arrival or departure airport joins the route | changes |
| `suggest_routes` / `choose_route` | Two or three route options for a trip, compared on the planner's map (the others drawn faint beside the one shown); one becomes the route, the rest stay to switch back to | writes / changes |
| `create_trip` / `update_trip` / `delete_trip` / `list_trips` | Multi-stop trips with nights per stop; dates and legs are worked out; stops anywhere by coordinates | writes / changes / deletes / reads |
| `save_route_ideas` | Places worth a stop on a trip, with coordinates, airport and a why, shown as pins to tap on the planner's map | writes |
| `route_map` | For the planner only: the places to tap when building a route on the map (Pinroute's Thailand places, the cities with flights elsewhere, Claude's ideas) and the map around them | reads |
| `set_nights` / `mark_leg` | Nights at one stop; a leg booked, with a note | writes |
| `choose_flight` / `clear_flight` | Saves or removes the flight picked for a leg, such as a fare from `search_flights` or the new-trip draft | writes / deletes |
| `search_flights` | Airline fares for one day or a return, cheapest first; daily limit per person | reads |
| `find_airports` | Airports by city, name or code, or within a distance of a point (with a map for the picker); works without signing in | reads |
| `flight_link` | A link to compare and book a flight on Aviasales, as a partner link when Travelpayouts is set up | reads |
| `hotel_link` | A Booking.com search for each stop's place and check-in/check-out dates, or for any place and dates; a partner link when Booking.com partner links are set up | reads |
| `choose_stay` / `clear_stay` | Saves or removes the hotel picked for a stop, such as one the traveller found through the stop's Booking.com search, with price, link, booked and a note; it shows as needing a new pick when the stop's dates move | writes / deletes |
| `find_transport` | Where to book a ferry, bus, minivan or train between two stops on the leg's own day: a 12Go search in Asia, an Omio search in Europe and the Rome2Rio route everywhere; 12Go and Omio as partner links when Travelpayouts is set up. No booking site gives partners a timetable feed, so times and prices come from the sites and from Claude | reads |
| `save_transport_options` / `choose_transport` | The ways to make a ferry or road leg (kind, operator, usual times, journey length, usual price, pier or station), each with the leg's booking search, and the one the traveller picked; the pick goes in the calendar with its times, and `clear_flight` removes it | writes |
| `find_activities` | Tours, activities and tickets at a trip stop or place (Amadeus Travel Builder), popular or matching interests, budget, traveller type and day; each with GetYourGuide and Klook links, as partner links when Travelpayouts is set up; daily limit per person | reads |
| `save_local_picks` / `get_local_picks` | Local favourites per place, each with its source link; a kept tour also has its booking link and price | writes / reads |
| `calendar_link` | A trip in the traveller's own calendar (Apple, Google/Android, Outlook): a secret subscription address `/calendar/<token>.ics` with each stop and its hotel, each flight, ferry and drive at its times when known, and dated tours; calendars follow changes; `new` renews the link, `stop` switches it off. Needs `PUBLIC_URL` (or Railway's domain) | writes |
| `delete_my_data` | Deletes everything the person saved | deletes |

Every tool has a title and a read-only or destructive annotation, and its description says what it does without steering Claude, as the [directory review](https://claude.com/docs/connectors/building/review-criteria) asks.

## Run it

Node 22.13 or later (the database uses Node's built-in `node:sqlite`).

```bash
npm install
npm test             # builds the planner, then the tests: tools, sign-in, separate data per person, limits, map, pages, planner
npm run dev          # http://127.0.0.1:3000/mcp
npm run screenshots  # directory images in listing/ (needs Playwright)
```

The planner tests need Playwright (`npm i -D playwright && npx playwright install chromium`); without it they're skipped.

GitHub Actions runs the same tests on every pull request and on `main` (`.github/workflows/test.yml`), and Railway deploys `main` when it changes.

## Settings

All settings are environment variables: on Railway under **Variables**, locally in `.env` (see `.env.example`). Keys never go in code, a repository or a chat.

| Variable | What it does |
| --- | --- |
| `AMADEUS_API_KEY` | Live fares and tours and activities from Amadeus Travel Builder. Without it, demo fares and no activity search. `ACTIVITY_LIMIT_PER_DAY`: activity searches per person per day (default 100). |
| `TRAVELPAYOUTS_TOKEN` | Recent prices from Aviasales (Travelpayouts Data API), low-cost airlines included, and the Links API. Profile → API token. |
| `TRAVELPAYOUTS_MARKER`, `TRAVELPAYOUTS_TRS` | Your Travelpayouts partner ID and project ID: links to Aviasales, GetYourGuide and Klook become your partner links (the project must be connected to each program; a link it can't convert stays a plain link). `TRANSPORT_PARTNER_LINKS`: the ferry, bus and train programs that accepted you, e.g. `12go` or `12go,omio`; until it is set, 12Go and Omio links stay plain links and no commission note shows. `RECENT_LIMIT_PER_DAY`: look-ups of recent prices per person per day (default 200). |
| `BOOKING_LINK_TEMPLATE` | Booking.com partner links through an affiliate network: the network's tracking link with `{url}` where the Booking.com address goes, e.g. `https://www.anrdoezrs.net/click-<PID>-<AID>?url={url}` for CJ. `BOOKING_AID`: instead, a Booking.com affiliate ID added as `aid=`, for partners of Booking.com's own programme. Without either, plain Booking.com links. |
| `AUTH_ISSUER` | Turns sign-in on: the sign-in service's issuer URL, e.g. `https://<name>.authkit.app`. |
| `PUBLIC_URL` | The server's public address, e.g. `https://pinroute.app`. On Railway, the generated domain is used until you set this. |
| `MCP_SECRET` | Without sign-in only: makes the address `/mcp/<secret>`, so only people with the link can connect. Ignored once sign-in is on. |
| `OPERATOR_NAME`, `SUPPORT_EMAIL` | Who runs the server and how to reach you, shown on `/help` and `/privacy`. |
| `SEARCH_LIMIT_PER_DAY` | Live airline searches per person per day (default 150). A search asked again within 20 minutes, by anyone, comes from the server's cache and doesn't count; past the limit, searches answer with Aviasales's recent prices and a link to Aviasales's own search instead of an error. `TRIP_LIMIT`: trips per person (default 200). |
| `ADOPT_LOCAL_DATA` | `true` for one sign-in: the first signed-in person with no trips takes over the ones saved before sign-in. Remove it afterwards. |
| `AUTH_AUDIENCE`, `AUTH_JWKS_URL` | Only for sign-in services that don't put the MCP address in the token's audience, or don't publish their keys in discovery. |
| `HOSTING_REGION`, `PRIVACY_UPDATED` | Wording on the privacy page: where the server runs (default "the United States") and the date of the last change. |
| `DATA_DIR`, `HOST`, `ALLOWED_HOSTS`, `PORT` | Set by themselves on Railway. Elsewhere: `HOST=0.0.0.0`, your domain in `ALLOWED_HOSTS`, and `DATA_DIR` on a disk that persists. |

## Your Amadeus key

```bash
npm run check:amadeus            # one real search, BKK → FRA in 30 days; prints offers, never the key
npm run check:amadeus LHR CDG    # any other pair
```

Amadeus Travel Builder covers a set of mostly full-service airlines; many regional low-cost airlines aren't in it (Krabi → Bangkok returns nothing, for example). That is why the planner's **Find flights** button also asks Aviasales for recent prices (low-cost airlines included) when the server has Travelpayouts. On the new-trip Flights step it looks up recent prices from every home airport, then live fares from the main one on three departure dates per country, each live search counted toward the daily limit. `scan_flight_deals` takes any number of departure and arrival airports in one call: it looks up a spread of routes that includes every airport (up to 16 recent-price look-ups, at most 8 live searches) and lists the routes it left out.

**Travel windows.** "April, 2 weeks" means every 2-week window in April, not two fixed dates. A window scan asks Aviasales's day-by-day calendar (`grouped_prices` by departure day, with the trip length wanted) for the cheapest return from each day you could leave: one look-up per route and month. Those windows are saved to the draft and drawn on each country as a strip, cheapest marked; tapping one checks that exact window live (one search). Live scans of a window aim their few searches at each route's cheapest windows from that calendar, instead of evenly spread dates.

**Best dates.** Aviasales keeps few prices months ahead, so a window often has no calendar. Then a live scan finds the best dates itself on the main route, in two rounds within its budget of 10 searches: five departure days spread over the window, then around the cheapest of them (a day or two either side, the shortest and longest stay wanted); searches left over check the other routes on those dates. The result leads with `best_dates` (the best combination, then the next distinct ones), and every window searched joins the strip. The planner shows the best dates first, then three other dates to pick in a tap. **Stops** (Any, Max 1, Direct) narrows the fares shown, the strip and every search (`max_stops`, recent prices included).

**Search budget.** Amadeus Travel Builder is a free beta with controlled volumes and no paid tier to move to, so Pinroute spends live searches carefully: fare look-ups are cached for everyone on the server (live fares 20 minutes, Aviasales's recent prices 3 hours), one scan spends at most 8 live searches, and `search_flights` prices nearby days (`flex_days`) live only while more than 20 searches are left, using the Aviasales quote for them otherwise. When live searches run out or Amadeus refuses (429), scans fall back to recent Aviasales prices, then to the fares already saved and an Aviasales search link, never an error.

## Flight search options

`search_flights` takes filters, all optional: `max_stops` (0 for direct only; `nonstop` still works), `depart_after` / `depart_before` / `arrive_before` and `return_after` / `return_before` (local clock times, HH:MM), `airlines` and `exclude_airlines` (IATA codes or names), `bag_included`, `max_hours` per direction, `max_price` for everyone, plus `children`, `infants` and `sort` (`price`, `best`, `duration`, `departure`). Amadeus Travel Builder only takes `nonstop` as a hint (each airline decides), so every filter is applied by Pinroute on the offers that come back (`src/flightfilter.mjs`). The result carries `facets` (airlines, cheapest per number of changes, price range, offers with a bag) for every offer on the date, so a filter bar can offer only choices that change something.

**Cheapest date:** `flex_days` (1–3) also searches that many days before and after; a return keeps its number of nights. The result has a `calendar` with the cheapest Amadeus fare and the Aviasales price for each date, and `cheapest`. Each date is one search toward the daily limit.

**Two quotes:** with Travelpayouts set up, every search also looks up Aviasales's recent price for the same route and dates (one recent-price look-up per date) and returns `compare`: the cheapest Amadeus fare, the Aviasales price with its partner link, which is cheaper and by how much. Only the filters Aviasales data can answer apply to it (changes and airline). Aviasales prices are what travellers found in the last days, not live; live Aviasales search needs Travelpayouts to approve the Flight Search API.

`scan_flight_deals` takes up to 6 departure dates in a window and `max_stops` for live fares.

## Travelpayouts: recent prices and partner links

Amadeus has no low-cost airlines. Travelpayouts, Aviasales's partner network, fills that gap for prices and pays a commission on bookings:

- **Recent prices** (`/aviasales/v3/prices_for_dates`, `/aviasales/v3/grouped_prices`): the cheapest fares Aviasales travellers found in the last days, per adult, low-cost airlines included. Pinroute uses them for the deal scan across a window and for "Best time" (the cheapest fare for each month ahead, in one look-up). They are a guide, not live; every fare links to Aviasales to check it. They don't use the 50 daily airline searches.
- **Partner links** (`/links/v1/create`): every Aviasales link (fares, and **Compare on Aviasales** on deals and flight legs) becomes your partner link, ten to a request and each made once. If the API can't be reached, the link carries your partner ID as `marker=`.
- The planner says next to these links that Pinroute may earn a commission; so do `/help`, `/privacy` and the listing answers.

## Airline names

Aviasales's recent prices name the airline by its IATA code ("VJ"), and so do some flight tools Claude uses. Pinroute shows the name instead ("VietJet Air", "VietJet Air VJ 58") wherever a fare appears: the planner, the tool results Claude reads, and fares and flights saved with a code before. The names come from `src/airlines.mjs`, a curated list of about 240 airlines flying today; a code that isn't on it stays a code rather than risk a wrong name. Add an airline there when a code shows up in the planner.

Set it up: create a Travelpayouts account, join the Aviasales program, then set `TRAVELPAYOUTS_TOKEN`, `TRAVELPAYOUTS_MARKER` and `TRAVELPAYOUTS_TRS` in Railway. The status page at `/` says when recent prices and partner links are on.

## Sign-in with WorkOS AuthKit

Any OAuth service that issues JWT access tokens works. AuthKit is free for the first million monthly users and [documents MCP sign-in](https://workos.com/docs/authkit/mcp), including the Client ID Metadata Document that Claude prefers.

1. Create a WorkOS account and open **AuthKit**. Choose the sign-in methods people can use, such as Google, email codes or passkeys.
2. In the WorkOS dashboard, under **Connect → Configuration**, turn on **Client ID Metadata Document** and **Dynamic Client Registration**.
3. Add your MCP address, `https://<your domain>/mcp`, as a **Resource Indicator**, so tokens name it as their audience.
4. If WorkOS asks for redirect URIs, add Claude's: `https://claude.ai/api/mcp/auth_callback`.
5. In Railway, set `AUTH_ISSUER` to your AuthKit domain (`https://<name>.authkit.app`) and `ADOPT_LOCAL_DATA` to `true`, then deploy.
6. In Claude, remove the old connector and add `https://<your domain>/mcp`. Ask *"list my Pinroute trips"*, click **Connect**, and sign in. Your trips from before sign-in move to your account.
7. Remove `ADOPT_LOCAL_DATA` in Railway.

What the server does: it publishes `/.well-known/oauth-protected-resource`, which tells Claude where to sign in. It checks each token's signature, issuer, audience and expiry. Tool calls that need an account get `401` with a pointer to that document, so Claude shows its Connect card and then retries the call.

## Hosting on Railway

Claude connects from Anthropic's servers, so the server needs a public HTTPS address and a disk that keeps the database between restarts.

1. **New Project → Deploy from GitHub repo**, this repository. Railway installs, builds and starts it, and redeploys on every merge to `main`.
2. **Variables:**
   - `AMADEUS_API_KEY`;
   - `MCP_SECRET` until sign-in is on, then `AUTH_ISSUER`;
   - `OPERATOR_NAME` and `SUPPORT_EMAIL`.
3. **Settings → Networking → Generate Domain**, and attach a **volume** to the service (any mount path, e.g. `/data`).
4. Open `https://<your domain>/`. It says whether live fares and sign-in are on, and never shows a key or the secret.
5. In Claude, go to **Settings → Connectors → Add custom connector** and enter the address shown there.

**Plans:**
- **Trial and Free**: fine for testing. On Free, the server sleeps after a few idle minutes, and the first request then wakes it.
- **Hobby** ($5 a month, usage included): needed before listing. It keeps the server awake and allows your own domain.

**Custom domain:**
1. Railway: **Settings → Networking → Custom Domain**, then add the CNAME record it shows at your domain registrar.
2. Set `PUBLIC_URL=https://<your domain>`.
3. Change the Resource Indicator in WorkOS to the new `/mcp` address.
4. Re-add the connector in Claude.

**Data:**
- Everything lives in `pinroute.db` on the volume.
- Version 0.1's `store.json` is imported automatically, then kept as `store.json.imported`.
- Copy `pinroute.db` now and then, or use Railway's volume backups.

## Public pages

| Path | What it is |
| --- | --- |
| `/` | Status: version, fares, sign-in, the address for Claude |
| `/help` | Setup, example prompts, tools, support contact: the directory's documentation URL |
| `/privacy` | Privacy policy: the directory's privacy policy URL |
| `/icon.svg` | The icon |
| `/.well-known/oauth-protected-resource` | Sign-in discovery for Claude (only with sign-in on) |

## Listing in Claude's directory

`listing/README.md` has a ready answer for every step of the [submission portal](https://claude.ai/directory/manage), and `listing/` also holds the carousel screenshots and the icon. These are left for you to do:
- your own domain and Railway Hobby;
- sign-in with AuthKit;
- `OPERATOR_NAME` and `SUPPORT_EMAIL`;
- a reviewer test account with a filled-in trip;
- reading the privacy policy through for your situation; it's a plain-language starting point, not legal advice.

## Layout

```
src/server.mjs        HTTP entry: sign-in check before the MCP SDK, public pages, status
src/auth.mjs          token checks (JWT, any OAuth issuer), protected resource metadata, which tools need sign-in
src/app.mjs           tools and the planner resource, scoped to one owner per request
src/discover.mjs      the new-trip rules, shared with the planner: seasons, ranking, rough costs, deal ratings
src/store.mjs         SQLite on the volume: trips, drafts, picks and search counts per owner; imports 0.1's store.json
src/pages.mjs         /help, /privacy and the icon
src/providers/        amadeus.mjs (live fares), travelpayouts.mjs (recent prices, partner links), demo.mjs, index.mjs
src/geo.mjs           airports (OurAirports, public domain), Pinroute's Thailand places, airports near a point and per country
src/data/             airports.json, places-th.json, destinations.json (60 countries: seasons, gateway, price level)
src/trips.mjs         dates and legs of a trip
src/map.mjs           a trip's coastline map and the map around a point for picking airports; src/world.mjs the world map, drawn at build time
ui/                   the planner: planner.js (screens, trip), home.js, newtrip.js, nav.js, airmap.js, world.js, core.js, dom.js,
                      planner.css, planner.html → dist/planner.html (npm run build)
scripts/              build-ui, check-amadeus, screenshots
listing/              directory listing: draft answers, screenshots, icon
test/                 tools, new trips, sign-in, store, pages, hosting, Amadeus, both planner flows; test/host is the stand-in host
```

Versions are pinned to the stack Claude's MCP Apps quickstart is verified with (`@modelcontextprotocol/ext-apps` 1.7.5). `@modelcontextprotocol/sdk` 1.32.2 and `zod` 4.6.7 are raised from the quickstart's 1.30.1 and 4.6.5 for their security fixes; ext-apps 1.7.5 accepts both. `jose` 6.2.18 checks tokens; `d3-geo`, `topojson-client` and `world-atlas` draw the maps; `lucide` provides the icons. Run `npm audit --omit=dev` after any change.

## Hotels

Booking.com has no open hotel API: its Demand API is only for Managed Affiliate Partners with a contract and an account manager, and its affiliate support says it offers no API access to other partners. So each stop with nights gets a Booking.com search for its place and dates (`stays` on every trip, and `hotel_link`), and the traveller picks a place there. From the planner, "Ask Claude where to stay" asks Claude which area suits the stop, from what it knows, with that same Booking.com search; when the traveller names the place they picked, Claude saves it with `choose_stay`. To earn commission, join Booking.com's affiliate programme through its network (CJ for most regions, from booking.com/affiliate-program) and set `BOOKING_LINK_TEMPLATE` to the deep-link format the network gives you.

## Pinroute's own lookups

Every message the planner sends to Claude asks it to use only Pinroute's tools and what it knows for flights, hotels, tours and getting between places, not other travel connectors or booking sites, so answers stay inside the planner. Flights come from `search_flights` and `scan_flight_deals` (Amadeus Travel Builder and Aviasales), tours from `find_activities` (Amadeus Travel Builder), hotels from the Booking.com search per stop, and ferries, trains, buses and drives between stops from Claude's own knowledge, with times and prices to check with the operator. Local picks are the one web search: Claude reads Reddit, social posts and blogs for them. Tool descriptions say what each tool covers and never ask Claude to prefer Pinroute over other tools, which the Claude directory does not allow.
