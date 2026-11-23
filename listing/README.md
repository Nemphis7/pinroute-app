# Claude directory listing: draft answers

Everything the submission portal at [claude.ai/directory/manage](https://claude.ai/directory/manage) (choose **MCP connector**) asks for, ready to paste. Placeholders in angle brackets are yours to fill in.

## 1. Connection

- **Server URL:** `https://<your domain>/mcp` (universal URL: everyone connects to the same address)

## 3. Listing

- **Name:** Pinroute
- **One-liner (≤200):** Plan trips in Claude from the days you're free or the place you dream of: where the weather is good, flight deals, then the route, flights and local favourites in one planner.
- **Description (≤2,000):**

  Pinroute turns a trip idea into a day-by-day route you can see and change in the conversation. Start from the days you are free: Pinroute ranks 60 countries by the weather in those months, the flight time and your budget, and compares flight deals for the ones you like. Or start from a country, or part of one such as Sulawesi, and see its best months, with what flights cost in each. Pick a fare and Pinroute starts the trip around it.

  Tell Claude where you want to go and for how many nights; Pinroute works out the dates, spots which hops are flights and which are a ferry or a drive, and shows it all in an interactive planner.

  For each flight, ask Claude to search with the flight tools you already use, or check airline fares directly, then save the one you pick to your trip with its price and booking link. For each place, Claude can gather what locals and recent visitors recommend, from restaurants to beaches and viewpoints, and save each pick to the planner with its source.

  Your trips are saved to your own Pinroute account, so you can come back to them in any chat and on any device, including the Claude mobile apps. Pinroute never books or pays for anything: booking happens on the airline's or booking site. Rename a trip, move it to other flights or delete it from the planner's Trip menu, or delete all your data at any time by asking Claude.

- **Categories:** Travel; Productivity (pick what the portal offers closest to these)
- **Documentation URL:** `https://<your domain>/help`
- **Privacy policy URL:** `https://<your domain>/privacy`
- **Support contact:** `<SUPPORT_EMAIL>`
- **Icon:** `icon-512.png` (or `icon-1024.png`, `icon.svg`)
- **Slug (permanent):** `pinroute`

## 4. Use cases

- **Primary use cases:** choosing where to go for the days you are free; finding the best time and flight deals for a country; planning multi-stop trips; finding and comparing flights for each leg; collecting local recommendations per place; keeping a trip plan across chats and devices.
- **What users need first:** a free Pinroute account, created when they first sign in from Claude. No paid plan is needed.
- **Reads or writes:** both. It reads and writes the user's own trips, new-trip draft, saved fares and picks; flight search and airport lookup only read.

## 5. Company

- **Name and website:** `<OPERATOR_NAME>`, `<website, or https://<your domain>/help>`
- **Primary contact:** `<your email>`

## 6. Authentication

- **Authentication requirement:** Required when the server asks (airport lookup works without signing in; everything else asks for sign-in).
- **Method:** OAuth sign-in through WorkOS AuthKit. Claude registers itself with a Client ID Metadata Document, with Dynamic Client Registration as a fallback, so there's no client to enter here.

## 7. Data handling

- **Underlying API:** Pinroute's own API for trips, the new-trip draft, picks and the planner. Live flight search calls Amadeus Travel Builder with Pinroute's key under Amadeus's terms; recent prices and partner links come from Travelpayouts (Aviasales Data API and Links API) under Pinroute's partner account.
- **Personal health data:** no.
- **Sponsored content:** no paid placement. Countries are ranked by weather, interests, flight time and budget; fares by price, deal rating or weather, never by commission. Links to Aviasales carry Pinroute's Travelpayouts partner ID, so Pinroute may earn a commission on bookings made through them; the planner says so next to those links, and the help page and privacy policy say so too.

## 8. Test & launch

- **Reviewer account:** `<email and password of a test user in AuthKit>`. Sign in with it when Claude shows the Connect card.
- **Populated data:** before submitting, sign in to Claude with the reviewer account and run the prompts for images 1–3 below. That way the reviewers find a new-trip draft with fares, and a trip with chosen flights and saved picks.
- **Steps:**
  1. Add the connector with the URL above.
  2. Ask: *Open my Pinroute trip.*
  3. Click **Connect** and sign in with the reviewer account.
  4. Try the prompts below.
- Confirm you've called every tool yourself as a custom connector in Claude.

## Carousel screenshots (PNG, 2× scale, cropped to the app)

| File | Paired prompt |
| --- | --- |
| `1-where.png` | I'm free from 1 to 24 March for about two weeks, flying from Frankfurt or Munich, with a budget of €6,000 for two. Where is good then? Plan a new trip in Pinroute. |
| `2-deals.png` | Find flight deals for Sri Lanka, Vietnam, Oman and Mexico for my new Pinroute trip and save the best ones. |
| `3-planner.png` | Plan my Thailand trip in Pinroute: Bangkok 1 night, Khao Sok 1, Khao Lak 2, Koh Yao Noi 2, Koh Phi Phi 3, Koh Lanta 3 and Ao Nang 2, then back to Bangkok, for 2 adults from Frankfurt, and find local favourites for Koh Lanta. |
| `4-flight.png` | Find flights from Krabi to Bangkok for the last day of my Pinroute trip and save the one I pick. |
| `5-card.png` | Open my Pinroute trip. |
| `6-ferry-dark.png` | How do I get from Koh Lanta to Ao Nang on my Pinroute trip? |

The images use a sample trip and sample fares; the Koh Lanta picks are real recommendations from Reddit, Instagram and travel guides. Regenerate them with `npm run screenshots`.

## Allowed link URIs

Leave this empty. Pinroute opens airline, booking and source links that belong to other sites, and the portal only accepts origins you own. People see Claude's confirmation before each external link opens.
