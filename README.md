# Pinroute app

Pinroute as an **MCP App**: a trip planner that runs inside Claude. Each traveller uses their own Claude plan for the AI work; this server keeps each person's trips, finds airports, searches airline fares and stores the local picks Claude researched.

Why inside Claude: Anthropic does not allow other apps to offer a Claude login or to run on people's Claude plans ([policy](https://code.claude.com/docs/en/legal-and-compliance)). An app that runs inside Claude, as a connector with its own screen, is the supported way.

## How it works

```
Claude (the traveller's own plan)
 ├─ talks with the traveller; researches local picks and flights with its own tools
 ├─ calls this server's tools ──── token from the sign-in service ────► Pinroute server (this repo)
 └─ shows the planner screen (ui/, one HTML)                              ├─ checks the token (src/auth.mjs)
      ├─ "Ask Claude": Claude searches with the traveller's tools         ├─ trips, choices, picks per person (SQLite on the volume)
      └─ the planner calls the same tools through Claude ───────────────► ├─ airports and Thailand places (src/data)
                                                                          └─ fares: Amadeus Travel Builder, or demo
```

| Tool | What it does | Data |
| --- | --- | --- |
| `open_planner` | Shows the planner for a trip (the MCP App screen) | reads |
| `create_trip` / `update_trip` / `delete_trip` / `list_trips` | Multi-stop trips with nights per stop; dates and legs are worked out | writes / changes / deletes / reads |
| `set_nights` | Changes the nights at one stop; later dates move with it | writes |
| `choose_flight` / `clear_flight` | Saves the flight picked for a leg, from any flight search, or removes it | writes / deletes |
| `mark_leg` | Marks a flight, ferry or drive as booked, with an optional note | writes |
| `search_flights` | Airline fares for one day or a return, cheapest first; daily limit per person | reads |
| `find_airports` | Airports by city, name or code; works without signing in | reads |
| `save_local_picks` / `get_local_picks` | Local favourites per place, each with its source link | writes / reads |
| `delete_my_data` | Deletes everything the person saved | deletes |

## The planner

- **In the chat:** a trip card. It shows the nights strip (one segment per stay, sized by its nights, with today marked), where you are today and what's next, how many flights are chosen and transfers booked, a small map, and one action: **Open planner**.
- **Full screen:**
  - The route on the left (stops, and the flight, ferry or drive between them, each with its state); the selected stop or leg on the right, with the map beside it. Phones show one pane at a time.
  - Change nights with plus and minus. Choose, book or remove flights, and mark ferries booked.
  - Ask Claude for flights (with whatever flight tools the traveller has connected), for local picks, or for how to get between two places.
  - Every change saves through the tools above, and Claude is told about it.
- **Map:** drawn on the server from Natural Earth's 1:50m coastline (`src/map.mjs`). It travels in the result's `_meta`, so the model never reads it.
- **Design:** audited with the /unslop process.
  - A 4 px spacing grid, neutrals from Claude's theme, and one accent used only for the selection and the single main action.
  - Two font weights, sentence case and tabular figures.
  - Lucide line icons at one size and one stroke.

Every tool has a title and a read-only or destructive annotation, and its description says what it does without steering Claude, as the [directory review](https://claude.com/docs/connectors/building/review-criteria) asks.

## Run it

Node 22.13 or later (the database uses Node's built-in `node:sqlite`).

```bash
npm install
npm test             # builds the planner, then 50 tests: tools, sign-in, separate data per person, limits, map, pages, planner
npm run dev          # http://127.0.0.1:3000/mcp
npm run screenshots  # directory images in listing/ (needs Playwright)
```

The planner tests need Playwright (`npm i -D playwright && npx playwright install chromium`); without it they're skipped.

## Settings

All settings are environment variables: on Railway under **Variables**, locally in `.env` (see `.env.example`). Keys never go in code, a repository or a chat.

| Variable | What it does |
| --- | --- |
| `AMADEUS_API_KEY` | Live fares from Amadeus Travel Builder. Without it, demo fares. |
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

Amadeus Travel Builder covers a set of mostly full-service airlines; many regional low-cost airlines aren't in it (Krabi → Bangkok returns nothing, for example). That is why the planner's **Ask Claude** button exists: Claude searches with whatever flight tools the traveller has connected and saves the pick with `choose_flight`.

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
src/store.mjs         SQLite on the volume: trips, picks and search counts per owner; imports 0.1's store.json
src/pages.mjs         /help, /privacy and the icon
src/map.mjs           each trip's map: coastline (Natural Earth via world-atlas) and stop positions
src/providers/        amadeus.mjs, demo.mjs, index.mjs (picks the source)
src/geo.mjs           airports (OurAirports, public domain) and Pinroute's Thailand places
src/trips.mjs         dates and legs of a trip
ui/                   the planner: planner.js, planner.css, planner.html → dist/planner.html (npm run build)
scripts/              build-ui, check-amadeus, screenshots
listing/              directory listing: draft answers, screenshots, icon
test/                 tools, sign-in, store, pages, hosting, Amadeus, planner; test/host is the stand-in host
```

Versions are pinned to the stack Claude's MCP Apps quickstart is verified with (`@modelcontextprotocol/ext-apps` 1.7.5). `@modelcontextprotocol/sdk` 1.32.2 and `zod` 4.6.7 are raised from the quickstart's 1.30.1 and 4.6.5 for their security fixes; ext-apps 1.7.5 accepts both. `jose` 6.2.18 checks tokens; `d3-geo`, `topojson-client` and `world-atlas` draw the maps; `lucide` provides the icons. Run `npm audit --omit=dev` after any change.
