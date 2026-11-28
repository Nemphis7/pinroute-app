// The new-trip planner in a stand-in host, both ways a traveller uses it: from the start screen, "I know when"
// (When → Where → Flights → a trip from a fare, then Claude plans the route) and "I know where" (Country → Best time →
// Flights). Fares are demo data; what Claude would save is saved by the test. Skipped where Playwright is missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect, addDays, START } from './helpers.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
const skip = !chromium && 'Playwright not installed';

let srv, client, browser, page, hostJs;
const FROM = addDays(START, 10), UNTIL = addDays(FROM, 23);
const frame = () => page.frameLocator('#planner');
const lastMessage = () => page.evaluate(() => window.__messages.at(-1).content[0].text);
const draft = async () => (await client.callTool({ name: 'plan_new_trip', arguments: {} })).structuredContent;

async function openHost(tool, args, opts = {}) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
  p.on('pageerror', (e) => console.error('page error:', e.message));
  await p.goto(`${srv.base}/__host`);
  await p.evaluate(([u, a, o]) => window.startHost(u, a, 'light', o), [srv.url, args, { inline: [760, 420], full: [1100, 900], tool, ...opts }]);
  await p.frameLocator('#planner').locator('#app[data-screen]').waitFor();
  return p;
}

before(async () => {
  if (!chromium) return;
  hostJs = (await build({ entryPoints: [new URL('./host/host.js', import.meta.url).pathname], bundle: true, format: 'iife', platform: 'browser', write: false })).outputFiles[0].text;
  srv = await startServer((app) => {
    app.get('/__host', (req, res) => res.type('html').send('<!doctype html><meta charset="utf-8"><body style="margin:0"><script src="/__host.js"></script>'));
    app.get('/__host.js', (req, res) => res.type('js').send(hostJs));
  });
  client = await connect(srv.url);
  await client.callTool({ name: 'create_trip', arguments: { name: 'Island hop', start: START, adults: 2, home_airport: 'FRA', stops: [{ place: 'Koh Lanta', nights: 3 }, { place: 'Ao Nang', nights: 2 }] } });
  browser = await chromium.launch();
  page = await openHost('open_planner', {});
});
after(async () => { await browser?.close(); await client?.close(); srv?.server.close(); });

test('in the chat: the start screen is a small card with one main action', { skip }, async () => {
  assert.equal(await frame().locator('#app').getAttribute('data-layout'), 'card');
  assert.equal(await frame().locator('#name').textContent(), 'Pinroute');
  assert.match(await frame().locator('#status').textContent(), /^Island hop · Starts in /);
  assert.equal(await frame().locator('button.primary').count(), 1);
  await frame().getByRole('button', { name: 'Open Pinroute' }).click();
  await frame().locator('#app[data-layout="app"] .home').waitFor();
  assert.equal(await frame().locator('.way').count(), 2);
  assert.match(await frame().locator('.trips').textContent(), /Island hop.*Koh Lanta, Ao Nang/);
});

test('I know when: the days off, the length and the airports, saved as the traveller sets them', { skip }, async () => {
  await frame().getByRole('button', { name: /I know when/ }).click();
  await frame().locator('#w-from').waitFor();
  assert.equal(await frame().locator('.step[aria-current="step"]').textContent(), '1When');
  await frame().locator('#w-from').fill(FROM);
  await frame().locator('#w-until').fill(UNTIL);
  await frame().getByRole('button', { name: /About two weeks/ }).click();
  await frame().locator('.chip[aria-pressed="true"]', { hasText: 'About two weeks' }).waitFor();
  await frame().locator('#w-air').fill('Munich');
  await frame().getByRole('option', { name: /MUC/ }).click();
  await frame().locator('.token', { hasText: 'MUC' }).waitFor();
  const d = (await draft()).draft;
  assert.deepEqual([d.from, d.until, d.minNights, d.maxNights], [FROM, UNTIL, 13, 16]);
  assert.ok(d.homes.includes('MUC'));
  assert.ok(d.homes.includes('FRA'), 'the last trip\'s airport was already there');
  assert.match(await frame().locator('.box .meta').textContent(), /^Any 13–16 nights between /);
});

test('Where: countries ranked for those months, the best four ticked, the map shaded', { skip }, async () => {
  await frame().getByRole('button', { name: 'Next: where is good then' }).click();
  await frame().locator('.dests').waitFor();
  assert.equal(await frame().locator('.dest.on').count(), 4, 'the four best matches are compared to start with');
  assert.ok(await frame().locator('.world .dest').count() >= 55);
  assert.equal(await frame().locator('.world .cmp').count(), 4);
  const name = (await frame().locator('.dest:not(.on) .dname b').first().textContent());
  await frame().getByRole('checkbox', { name: `Compare ${name}` }).click();      // clicked, not check(): the list redraws at once
  await frame().locator('.dest.on').nth(4).waitFor();
  assert.equal((await draft()).draft.compare.length, 5);
  await frame().getByRole('button', { name: 'Beaches' }).click();
  await frame().locator('.chip[aria-pressed="true"]', { hasText: 'Beaches' }).waitFor();
  await frame().getByRole('button', { name: 'Ask Claude about these' }).click();
  await page.waitForFunction(() => window.__messages.length > 0);
  assert.match(await lastMessage(), /for 13–16 nights, 2 travellers flying from .*, and we like beaches\. Pinroute ranks these countries by the weather then: /);
});

test('Flights: one Find flights button prices every country, the best deal leads', { skip }, async () => {
  await frame().locator('.stepnav button.primary').click();
  await frame().locator('.country').first().waitFor();
  assert.equal(await frame().locator('.country').count(), 5);
  assert.deepEqual((await frame().locator('.toolbar .acts button').allTextContents()).map((t) => t.trim()), ['Find flights'], 'no Ask Claude or quick-check buttons');
  await frame().locator('.toolbar').getByRole('button', { name: 'Find flights' }).click();
  await frame().locator('.banner').waitFor({ timeout: 30000 });
  await frame().locator('.country .deal.main').nth(4).waitFor({ timeout: 30000 });
  assert.match(await frame().locator('.banner h3').textContent(), /^.+ from €[\d,]+ per person$/);
  assert.match(await frame().locator('.country .deal.main').first().textContent(), /per person · €[\d,]+ for 2/);
});

test('Flights: the best dates lead, other dates follow, and Stops narrows every fare to direct or one change', { skip }, async () => {
  const card = frame().locator('.country').first();
  assert.equal(await card.locator('.eyebrow').first().textContent(), 'Best dates found');
  const alts = card.locator('.alts .alt');
  assert.ok(await alts.count() >= 1, 'other date combinations to pick from');
  const mainDates = (await card.locator('.deal.main .meta').nth(1).textContent()).split(' · ')[0];
  const altDates = await alts.first().locator('.ad').textContent();
  assert.notEqual(altDates, mainDates, 'other dates, not the same dates again');
  await alts.first().click();
  assert.equal(await card.locator('.eyebrow').first().textContent(), 'Your pick');
  assert.equal((await card.locator('.deal.main .meta').nth(1).textContent()).split(' · ')[0], altDates);
  const stops = frame().locator('.sorter[aria-label="Changes"]');
  assert.deepEqual((await stops.locator('button').allTextContents()), ['Any', 'Max 1', 'Direct']);
  await stops.getByRole('button', { name: 'Direct' }).click();
  for (const t of await frame().locator('.country .deal.main .small').first().allTextContents()) assert.match(t, /Direct/);
  await stops.getByRole('button', { name: 'Any' }).click();
});

test('fares Claude saves show up on the Flights step', { skip }, async () => {
  const d = await draft();
  const first = d.draft.compare[0];
  await client.callTool({ name: 'save_flight_deals', arguments: { country: first, deals: [{ from: 'FRA', to: 'BKK', depart: addDays(FROM, 1), return: addDays(FROM, 15), price: 300, currency: 'EUR', adults: 2, airline: 'Test Air', out: 'TA 1, 10:00 FRA → 06:00 BKK', source: 'LetsFG', link: 'https://letsfg.co/b/test' }] } });
  await frame().locator('.stepnav button').first().click();               // back to Where and on again: the step loads the draft afresh
  await frame().locator('.country').first().waitFor({ state: 'detached' });
  await frame().locator('.stepnav button.primary').click();
  await frame().locator('.banner', { hasText: '€150 per person' }).waitFor({ timeout: 15000 });
  assert.match(await frame().locator('.banner').textContent(), /Exceptional deal.*via LetsFG/);
});

test('Flights: the traveller taps the sites to search, Claude searches them, the sites compared side by side', { skip }, async () => {
  const chips = frame().locator('.site-chip');
  assert.deepEqual((await frame().locator('.site-chip .site-txt b').allTextContents()), ['Pinroute', 'Kiwi.com', 'Expedia', 'eDreams', 'lastminute.com']);
  assert.equal(await frame().locator('.site-chip.on').count(), 1, 'Pinroute\'s own search to start with');
  await chips.filter({ hasText: 'Kiwi.com' }).click();
  await frame().locator('.site-chip.on', { hasText: 'Kiwi.com' }).waitFor();
  await chips.filter({ hasText: 'eDreams' }).click();
  await frame().locator('.site-chip.on', { hasText: 'eDreams' }).waitFor();
  assert.deepEqual((await draft()).draft.sites, ['pinroute', 'kiwi', 'edreams']);

  const before = await page.evaluate(() => window.__messages.length);
  await frame().locator('.toolbar').getByRole('button', { name: 'Find flights' }).click();
  await page.waitForFunction((n) => window.__messages.length > n, before);
  const msg = await lastMessage();
  assert.match(msg, /^Find flight deals for my new trip in Pinroute with my own flight-search connectors in Claude: Kiwi\.com, eDreams\./);
  assert.match(msg, /Kiwi\.com \(search-flight\) searches date ranges: .*nights_in_dst_from 13, nights_in_dst_to 16, adults 2/);
  assert.match(msg, /eDreams search exact dates: for each departure and arrival airport, search these date pairs, and the cheapest dates Kiwi\.com finds:\n- /);
  assert.match(msg, /From: (FRA, MUC|MUC, FRA)\./);
  assert.match(msg, /save_flight_deals: source exactly "Kiwi\.com" \/ "eDreams"/);
  assert.doesNotMatch(msg, /use only Pinroute's own tools/, 'this one message lets Claude use the traveller\'s connectors');
  await frame().locator('.sites .busy', { hasText: 'Claude is searching Kiwi.com, eDreams' }).waitFor();

  // what Claude would do: save Kiwi's fares, and say eDreams isn't connected
  const first = (await draft()).draft.compare[0];
  await client.callTool({ name: 'save_flight_deals', arguments: { country: first, deals: [{ from: 'MUC', to: 'BKK', depart: addDays(FROM, 2), return: addDays(FROM, 16), price: 320, currency: 'EUR', adults: 2, airline: 'Kiwi Air', stops: 1, source: 'Kiwi.com', link: 'https://www.kiwi.com/deep?x=1' }],
    sites: [{ site: 'kiwi', status: 'searched' }] } });
  await client.callTool({ name: 'save_flight_deals', arguments: { country: first, sites: [{ site: 'edreams', status: 'not_connected' }] } });
  await frame().locator('.connect', { hasText: 'eDreams isn\'t connected in your Claude yet' }).waitFor({ timeout: 20000 });
  assert.match(await frame().locator('.connect ol').textContent(), /Settings → Connectors/);
  assert.equal(await frame().locator('.site-chip.miss').textContent().then((t) => /eDreams.*Not connected/.test(t)), true);
  await frame().locator('.sites .busy').waitFor({ state: 'detached', timeout: 20000 });

  const cmp = frame().locator('.country').first().locator('.site-cmp');
  await cmp.waitFor();
  const rows = await cmp.locator('.sc-who .sc-name').allTextContents();
  assert.equal(rows[0], 'LetsFG', 'the cheapest site first, a source Claude used before by its own name');
  assert.ok(rows.includes('Kiwi.com'));
  assert.match(await cmp.locator('.sc-row.sc-win').textContent(), /LetsFG€\d+ less.*€150$/);
  await cmp.locator('.sc-row').nth(1).click();
  await frame().locator('.country').first().locator('.sc-row.sc-picked').nth(0).waitFor();
  assert.equal(await frame().locator('.country').first().locator('.eyebrow').first().textContent(), 'Your pick');
  await cmp.locator('.sc-row').first().click();
});

test('plans a trip with the best fare, then Claude plans the route', { skip }, async () => {
  await frame().locator('.banner').getByRole('button', { name: /with this flight/ }).click();
  await frame().locator('#app[data-screen="trip"]').waitFor();
  assert.match(await frame().locator('#sub').textContent(), /2 travellers · 14 nights/);
  assert.match(await frame().locator('#status').textContent(), /2 of 2 flights chosen/);
  const trip = await frame().locator('body').evaluate(() => window.__pinroute.view.trip);
  assert.equal(trip.ticket.source, 'LetsFG');
  await frame().locator('.row.leg').last().click();
  assert.match(await frame().locator('.ticket').textContent(), /In the return fare/);
  await frame().getByRole('button', { name: 'Ask Claude for route options' }).click();
  await page.waitForFunction(() => /^Plan the route for my Pinroute trip/.test(window.__messages.at(-1).content[0].text));
  assert.match(await lastMessage(), new RegExp(`trip_id "${trip.id}".*Suggest 2 or 3 routes.*suggest_routes.*keeps Bangkok first and ends with Bangkok with 0 nights, uses all 14 nights`));
  const bad = await client.callTool({ name: 'suggest_routes', arguments: { trip_id: trip.id, options: [{ name: 'Short', stops: [{ place: 'Bangkok', nights: 3 }, { place: 'Bangkok', nights: 0 }] }, { name: 'Also short', stops: [{ place: 'Bangkok', nights: 2 }, { place: 'Bangkok', nights: 0 }] }] } });
  assert.match(bad.content[0].text, /"Short" has 3 nights; the trip's flights leave room for 14/);
  await client.callTool({ name: 'suggest_routes', arguments: { trip_id: trip.id, options: [
    { name: 'Andaman islands', why: 'Beaches on the west coast', stops: [{ place: 'Bangkok', nights: 3 }, { place: 'Koh Lanta', nights: 6 }, { place: 'Ao Nang', nights: 5 }, { place: 'Bangkok', nights: 0 }] },
    { name: 'The north', why: 'Temples and mountains', stops: [{ place: 'Bangkok', nights: 4 }, { place: 'Chiang Mai', nights: 6 }, { place: 'Chiang Rai', nights: 4 }, { place: 'Bangkok', nights: 0 }] },
  ] } });
  await frame().locator('.callout').getByRole('button', { name: 'Refresh' }).click();
  await frame().locator('.route-opt').first().waitFor();
  assert.equal(await frame().locator('.route-opt').count(), 2, 'both routes side by side');
  assert.equal(await frame().locator('.stage .ghost').count(), 1, 'the other route faint on the map');
  assert.match(await frame().locator('.detail h2').textContent(), /Andaman islands/);
  await frame().locator('.stage .ghost .ghost-dot').dispatchEvent('click');
  await frame().locator('.detail h2', { hasText: 'The north' }).waitFor();
  assert.match(await frame().locator('.stage svg.stage-svg').getAttribute('aria-label'), /Chiang Mai/, 'the map shows the route picked');
  assert.equal(await frame().locator('.row.stop').count(), 0, 'the route is not changed until one is chosen');
  await frame().locator('.route-opt', { hasText: 'Andaman islands' }).click();
  await frame().getByRole('button', { name: 'Use this route' }).click();
  await frame().locator('.row.stop', { hasText: 'Koh Lanta' }).waitFor();
  assert.equal(await frame().locator('.callout').count(), 0, 'once planned, the route stands on its own');
  await frame().getByRole('button', { name: 'Compare routes (2)' }).waitFor();
  assert.match(await frame().locator('#status').textContent(), /2 of 4 flights chosen · 0 of 1 ferry or drive booked/);
});

test('I know where: a country, its best months with fares, then the flights of one month', { skip }, async () => {
  await frame().getByRole('button', { name: 'Home' }).click();
  await frame().locator('.home').waitFor();
  await frame().getByRole('button', { name: /I know where/ }).click();
  await frame().locator('#c-q').fill('jap');
  assert.equal(await frame().locator('.dp').count(), 1);
  await frame().getByRole('button', { name: /^Japan/ }).click();
  await frame().locator('.mgrid').waitFor();
  assert.equal(await frame().locator('.mcell').count(), 12);
  assert.match(await frame().locator('.nt-head h2').textContent(), /When is best for Japan\?/);
  // the weather by month, from Open-Meteo through the server, one column per month in the order of the fares
  await frame().locator('.clim .ccol').first().waitFor();
  assert.equal(await frame().locator('.clim .ccol').count(), 12);
  assert.deepEqual(await frame().locator('.clim .cmon').allTextContents(), await frame().locator('.mcell .mlbl').allTextContents());
  assert.match(await frame().locator('.clim .ccol').first().getAttribute('aria-label'), /^\w+: -?\d+° to -?\d+°C, \d+ mm of rain on \d+ days, [\d.]+ hours of sun a day/);
  assert.equal(await frame().locator('.clim .cfact').count(), 3, 'warmest, driest and sunniest; Japan has no beach tag, so no sea');
  await frame().getByRole('button', { name: 'Find flights' }).click();
  await frame().locator('.banner', { hasText: 'Cheapest good month' }).waitFor({ timeout: 30000 });
  const month = await frame().locator('.banner h3').textContent();
  await frame().locator('.banner button.primary').click();
  await frame().locator('.country').waitFor();
  assert.equal(await frame().locator('.country').count(), 1);
  assert.equal(await frame().locator('.country h3').textContent(), 'Japan');
  assert.ok(await frame().locator('.country .deal').count() >= 1, `fares for ${month}`);
  assert.equal(await frame().locator('.step[aria-current="step"]').textContent(), '3Flights');
});

test('the draft in the chat: a card with where it stands and Open planner', { skip }, async () => {
  const p = await openHost('plan_new_trip', {});
  const f = p.frameLocator('#planner');
  assert.equal(await f.locator('#name').textContent(), 'New trip: Japan');
  assert.match(await f.locator('#status').textContent(), /^Best deal: Japan from €/);
  assert.equal(await f.locator('.side svg.world.mini').count(), 1);
  await f.getByRole('button', { name: 'Open planner' }).click();
  await f.locator('#app[data-layout="app"] .country').waitFor();
  await p.close();
});

test('a new trip starts from the traveller\'s words; Claude fills it and the planner moves on', { skip }, async () => {
  const p = await openHost('open_planner', {});
  const f = p.frameLocator('#planner');
  await f.getByRole('button', { name: 'Open Pinroute' }).click();
  await f.locator('#start-words').fill('I want to go on a trip to Japan in April for two weeks');
  assert.equal(await f.locator('.way').count(), 2, 'setting it up by hand stays, as two small buttons');
  await f.getByRole('button', { name: 'Plan it with Claude' }).click();
  await p.waitForFunction(() => /^I want to plan a new trip in Pinroute\. In my words: "I want to go on a trip to Japan in April/.test(window.__messages?.at(-1)?.content[0].text));
  await f.locator('#words').waitFor();
  assert.equal(await f.locator('#words').inputValue(), 'I want to go on a trip to Japan in April for two weeks');
  assert.equal((await draft()).draft.step, 'prompt');
  await client.callTool({ name: 'save_new_trip_draft', arguments: { country: 'Japan', free_from: addDays(FROM, 30), free_until: addDays(FROM, 50), min_nights: 13, max_nights: 15 } });
  await f.locator('.country h3', { hasText: 'Japan' }).waitFor({ timeout: 30000 });
  assert.equal(await f.locator('.step[aria-current="step"]').textContent(), '3Flights', 'straight to the flights for Japan');
  await p.close();
});

test('the countries ticked to compare can be cleared at once', { skip }, async () => {
  await client.callTool({ name: 'plan_new_trip', arguments: { compare: ['Vietnam', 'Thailand', 'Japan'], step: 'where', way: 'when' } });
  const p = await openHost('plan_new_trip', {});
  const f = p.frameLocator('#planner');
  await f.getByRole('button', { name: 'Open planner' }).click();
  await f.locator('.picked').waitFor();
  assert.equal(await f.locator('.picked .token').count(), 3);
  await f.getByRole('button', { name: 'Remove Japan' }).click();
  await f.locator('.picked .token', { hasText: 'Japan' }).waitFor({ state: 'detached' });
  await f.getByRole('button', { name: 'Clear all' }).click();
  await f.locator('.picked').waitFor({ state: 'detached' });
  assert.deepEqual((await draft()).draft.compare, []);
  await p.close();
});
