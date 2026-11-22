# Pinroute app

Pinroute as an **MCP App**: a trip planner that runs inside Claude. Each traveller uses their own Claude plan for the AI work; this server keeps trips, finds airports, searches flights and stores the local picks Claude researched.

Why inside Claude: Anthropic does not allow other apps to offer a Claude login or to run on people's Claude plans ([policy](https://code.claude.com/docs/en/legal-and-compliance)). An app that runs inside Claude, as a connector with its own screen, is the supported way.

## How it works

```
Claude (the traveller's own plan)
 ├─ talks with the traveller, researches local picks with its own web search
 ├─ calls this server's tools ───────────────► Pinroute server (this repo)
 └─ shows the planner screen (ui/, one HTML)      ├─ trips, chosen flights, local picks (data/store.json)
      └─ the planner calls the same tools ──────► ├─ airports and Thailand places (src/data)
         through Claude                           └─ flights: Amadeus Travel Builder, or demo fares
```

| Tool | What it does | Writes? |
| --- | --- | --- |
| `open_planner` | Shows the planner for a trip (the MCP App screen) | no |
| `create_trip` / `update_trip` / `list_trips` | Multi-stop trips with nights per stop; dates and flight legs are worked out | yes / yes (replaces stops) / no |
| `search_flights` | Fares for one day or a return, cheapest first, links to the airline's site | no |
| `choose_flight` | Saves the flight picked for a leg | yes |
| `find_airports` | Airports by city, name or code | no |
| `save_local_picks` / `get_local_picks` | Local favourites per place, each with its source link; Claude researches, the server keeps them | yes / no |

## Run it

Node 20 or later.

```bash
npm install
npm test          # builds the planner, then 20 tests: every tool over HTTP, the Amadeus mapping, the hosting defaults, the planner in a stand-in host
npm run dev       # http://127.0.0.1:3000/mcp
```

The planner test needs Playwright (`npm i -D playwright && npx playwright install chromium`); without it those 4 tests are skipped.

## Your Amadeus key

The key goes in the server's settings as `AMADEUS_API_KEY`: a `.env` file on your computer, Claude Desktop's config (local mode), or the host's environment variables. Never in code, a repository or a chat. Check it with:

```bash
npm run check:amadeus            # one real search, BKK → FRA in 30 days; prints offers, never the key
npm run check:amadeus LHR CDG    # any other pair
```

## Try it in Claude

Claude shows the planner and does the thinking, but the tools run on your server, with your key. Two ways to run it:

### On your own computer (Claude Desktop, free)

Claude Desktop starts the server itself; nothing is hosted and the key stays on your computer. It works on that computer only, while Claude Desktop is open.

1. `npm install` in this folder.
2. In Claude Desktop: **Settings → Developer → Edit Config**, add the entry below with this folder's full path and your key, save, restart Claude Desktop.

```json
{
  "mcpServers": {
    "pinroute": {
      "command": "node",
      "args": ["/full/path/to/pinroute-app/src/stdio.mjs"],
      "env": { "AMADEUS_API_KEY": "your key" }
    }
  }
}
```

### Hosted (works on your phone too, and later for others)

Claude connects from Anthropic's servers, so the server needs a public HTTPS address and a disk that keeps the trips between restarts.

- **Testing: Railway.** New accounts start with a 30-day trial ($5 of usage). Sign up with GitHub so Railway can verify the account: its "Limited Trial" restricts outgoing connections, and the server could not reach Amadeus. After the trial, switch to the **Free plan** ($1 of usage a month, no card) and redeploy; switch within 30 days or the trial's volume is deleted. On Free the server sleeps after 5–10 minutes without outbound traffic and wakes on the next request; that first request can be slow or fail once, so ask Claude again. If the $1 runs out, it stops until next month and the data stays.
- **For other people: Hobby** ($5 a month including $5 of usage): no sleeping, room to grow.
- Avoid hosts whose disk is wiped on every restart: saved trips would be lost.

On Railway:

1. **New Project → Deploy from GitHub repo**, this repository. Railway installs, builds and starts it by itself.
2. **Variables**: `AMADEUS_API_KEY` (your key) and `MCP_SECRET` (a long random string, 32 or more letters and digits; it becomes part of the address, so treat it like a password). Nothing else: on Railway the server listens on all interfaces, answers only its public domain (`RAILWAY_PUBLIC_DOMAIN`) and keeps trips on the volume (`RAILWAY_VOLUME_MOUNT_PATH`) by itself. If the service ever has more than one domain, list them all in `ALLOWED_HOSTS`, comma-separated.
3. **Settings → Networking → Generate Domain**, and attach a **volume** to the service (any mount path, e.g. `/data`). Deploy.
4. Open `https://<your domain>/`. It says the server is running and whether flights come from Amadeus or demo data; it never shows the key or the secret.
5. In Claude: **Settings → Connectors → Add custom connector**, URL `https://<your domain>/mcp/<MCP_SECRET>`.

Elsewhere: set `HOST=0.0.0.0`, `ALLOWED_HOSTS=<your public domain>` and `DATA_FILE=<a path on a disk that persists>`, plus the two variables above.

Then ask Claude, e.g. *"Plan my Thailand trip in Pinroute: Bangkok 1 night, Khao Sok 1, … from Frankfurt, 2 adults, starting 14 November"*. Claude creates the trip and opens the planner; it asks once before showing an app.

## Flights

Demo fares are shown until `AMADEUS_API_KEY` is set. Then `search_flights` uses Amadeus Travel Builder: live prices from the airlines in its network, with links to book on the airline's own site. It is search only, covers a subset of airlines, and the key must stay on the server. The adapter follows Amadeus's guide: local times shown as returned, door-to-door time from the time-zone offsets, results sorted here, links used as returned and never stored.

Every source returns the same fare shape (`src/providers`), so another one can be added without touching the tools or the planner.

## Before other people use it

- **Sign-in and one store per user.** Today one JSON file holds everything and `MCP_SECRET` is the only lock. The Claude directory requires OAuth 2.0 for tools that act on a user's data.
- **Directory listing**: privacy policy, documentation URL, support contact, icon, 3–5 screenshots, a test account. Every tool already has a title and a read or write annotation, as the directory requires.
- **`_meta.ui.domain`** only if the planner ever runs its own sign-in (see Claude's MCP Apps docs).

## Layout

```
src/server.mjs        HTTP entry (Streamable HTTP, stateless)
src/app.mjs           tools and the planner resource
src/providers/        amadeus.mjs, demo.mjs, index.mjs (picks the source)
src/geo.mjs           airports (OurAirports, public domain) and Pinroute's Thailand places
src/trips.mjs         dates and legs of a trip
src/store.mjs         JSON file store (swap for a database before sign-in)
ui/                   the planner: planner.js, planner.css, planner.html → dist/planner.html (npm run build)
test/                 server, Amadeus, hosting and planner tests; test/host is the stand-in host
```

Versions are pinned to the stack Claude's MCP Apps quickstart is verified with: `@modelcontextprotocol/sdk` 1.30.1, `@modelcontextprotocol/ext-apps` 1.7.5, `zod` 4.6.5. The 2.x line of ext-apps uses the same wire protocol and can come later.
