# Pinroute app

Pinroute as an **MCP App**: a trip planner that runs inside Claude. A trip starts from the days the traveller is free (**I know when**: When → Where → Flights) or from a country (**I know where**: Country → Best time → Flights) and ends with a trip planned around the fare they picked. Each traveller uses their own Claude plan for the AI work; this server keeps each person's trips and new-trip draft, ranks 60 countries by season, finds airports, searches airline fares, keeps the flight deals found and stores the local picks Claude researched.

Why inside Claude: Anthropic does not allow other apps to offer a Claude login or to run on people's Claude plans ([policy](https://code.claude.com/docs/en/legal-and-compliance)). An app that runs inside Claude, as a connector with its own screen, is the supported way.

## How it works

```
Claude (the traveller's own plan)
 ├─ talks with the traveller; researches flights, routes and local picks with its own tools
 ├─ calls this server's tools ──── token from the sign-in service ────► Pinroute server (this repo)
 └─ shows the planner (ui/, one HTML; Back, Home, New trip, Trips)       ├─ checks the token (src/auth.mjs)
      ├─ start screen: I know when / I know where, the trips              ├─ trips, draft, fares, picks per person (SQLite on the volume)
      ├─ new trip: When → Where → Flights, Country → Best time → Flights  ├─ 60 countries by season and price level (src/discover.mjs)
      ├─ a trip: route, flights, ferries, local picks                     ├─ airports and Thailand places (src/data)
      └─ "Ask Claude": Claude searches with the traveller's tools ──────► └─ fares: Amadeus Travel Builder, or demo
```

| Tool | What it does | Data |
| --- | --- | --- |
| `open_planner` | The start screen, or a trip (the MCP App screen) | reads |
| `plan_new_trip` | The new-trip planner; saves free dates, length, travellers, budget, airports, regions, interests, countries to compare, the traveller's wishes and a focus on part of a country (its airports are used for fares) | writes |
| `scan_flight_deals` | Return fares to a country: recent prices across the window or by month (Travelpayouts), or live fares (Amadeus) including one pair of dates across several departure and arrival airports; keeps the cheapest | writes |
| `save_flight_deals` | Keeps fares Claude found with any flight search, per country | writes |
| `start_trip_from_flight` | A trip from a saved fare: from landing to the flight home, the fare on both flights | writes |
| `set_trip_fare` | Moves a trip to another saved fare: dates follow the flights, nights go to or come from the longest stays, a new arrival or departure airport joins the route | changes |
| `create_trip` / `update_trip` / `delete_trip` / `list_trips` | Multi-stop trips with nights per stop; dates and legs are worked out; stops anywhere by coordinates | writes / changes / deletes / reads |
| `set_nights` / `mark_leg` | Nights at one stop; a leg booked, with a note | writes |
| `choose_flight` / `clear_flight` | Saves or removes the flight picked for a leg, from any flight search | writes / deletes |
| `search_flights` | Airline fares for one day or a return, cheapest first; daily limit per person | reads |
| `find_airports` | Airports by city, name or code, or within a distance of a point (with a map for the picker); works without signing in | reads |
| `flight_link` | A link to compare and book a flight on Aviasales, as a partner link when Travelpayouts is set up | reads |
| `save_local_picks` / `get_local_picks` | Local favourites per place, each with its source link | writes / reads |
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

## Settings

All settings are environment variables: on Railway under **Variables**, locally in `.env` (see `.env.example`). Keys never go in code, a repository or a chat.

| Variable | What it does |
| --- | --- |
| `AMADEUS_API_KEY` | Live fares from Amadeus Travel Builder. Without it, demo fares. |
| `TRAVELPAYOUTS_TOKEN` | Recent prices from Aviasales (Travelpayouts Data API), low-cost airlines included, and the Links API. Profile → API token. |
| `TRAVELPAYOUTS_MARKER`, `TRAVELPAYOUTS_TRS` | Your Travelpayouts partner ID and project ID: links to Aviasales become your partner links. `RECENT_LIMIT_PER_DAY`: look-ups of recent prices per person per day (default 200). |
| `AUTH_ISSUER` | Turns sign-in on: the sign-in service's issuer URL, e.g. `https://<name>.authkit.app`. |
| `PUBLIC_URL` | The server's public address, e.g. `https://pinroute.app`. On Railway, the generated domain is used until you set this. |
| `MCP_SECRET` | Without sign-in only: makes the address `/mcp/<secret>`, so only people with the link can connect. Ignored once sign-in is on. |
| `OPERATOR_NAME`, `SUPPORT_EMAIL` | Who runs the server and how to reach you, shown on `/help` and `/privacy`. |
| `SEARCH_LIMIT_PER_DAY` | Flight searches per person per day (default 50). `TRIP_LIMIT`: trips per person (default 200). |
| `ADOPT_LOCAL_DATA` | `true` for one sign-in: the first signed-in person with no trips takes over the ones saved before sign-in. Remove it afterwards. |
| `AUTH_AUDIENCE`, `AUTH_JWKS_URL` | Only for sign-in services that don't put the MCP address in the token's audience, or don't publish their keys in discovery. |
| `HOSTING_REGION`, `PRIVACY_UPDATED` | Wording on the privacy page: where the server runs (default "the United States") and the date of the last change. |
| `DATA_DIR`, `HOST`, `ALLOWED_HOSTS`, `PORT` | Set by themselves on Railway. Elsewhere: `HOST=0.0.0.0`, your domain in `ALLOWED_HOSTS`, and `DATA_DIR` on a disk that persists. |

## Your Amadeus key

```bash
npm run check:amadeus            # one real search, BKK → FRA in 30 days; prints offers, never the key
npm run check:amadeus LHR CDG    # any other pair
```

Amadeus Travel Builder covers a set of mostly full-service airlines; many regional low-cost airlines aren't in it (Krabi → Bangkok returns nothing, for example). That is why the planner's **Ask Claude** buttons exist: Claude searches with whatever flight tools the traveller has connected (LetsFG's flexible-date search fits the new-trip flow best) and saves deals with `save_flight_deals` or a leg's pick with `choose_flight`. The planner's **Quick check** is the server's own Amadeus search: three departure dates per country, each counted toward the daily limit.

## Travelpayouts: recent prices and partner links

Amadeus has no low-cost airlines. Travelpayouts, Aviasales's partner network, fills that gap for prices and pays a commission on bookings:

- **Recent prices** (`/aviasales/v3/prices_for_dates`, `/aviasales/v3/grouped_prices`): the cheapest fares Aviasales travellers found in the last days, per adult, low-cost airlines included. Pinroute uses them for the deal scan across a window and for "Best time" (the cheapest fare for each month ahead, in one look-up). They are a guide, not live; every fare links to Aviasales to check it. They don't use the 50 daily airline searches.
- **Partner links** (`/links/v1/create`): every Aviasales link (fares, and **Compare on Aviasales** on deals and flight legs) becomes your partner link, ten to a request and each made once. If the API can't be reached, the link carries your partner ID as `marker=`.
- The planner says next to these links that Pinroute may earn a commission; so do `/help`, `/privacy` and the listing answers.

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
