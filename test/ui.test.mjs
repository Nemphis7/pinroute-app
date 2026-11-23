// The planner inside a stand-in host, the way a traveller uses it: the trip card in the chat, then full screen,
// changing nights, choosing and booking flights, asking Claude for flights, picks and ferries and seeing what Claude
// saved, a flight whose date moved, and a host without full screen. Skipped where Playwright is missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect, THAILAND_TRIP, START, LAST_DAY, KBV_BKK, shortDay, addDays } from './helpers.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
const skip = !chromium && 'Playwright not installed';

let srv, client, browser, page, tripId, hostJs;
const OUT = `out|FRA|BKK|${START}`;
const LANTA = THAILAND_TRIP.stops.findIndex((x) => x.place === 'Koh Lanta');

async function openHost(opts) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
  p.on('pageerror', (e) => console.error('page error:', e.message));
  await p.goto(`${srv.base}/__host`);
  await p.evaluate(([u, id, o]) => window.startHost(u, { trip_id: id }, 'light', o), [srv.url, tripId, opts]);
  await p.frameLocator('#planner').locator('#strip .seg').first().waitFor();
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
  tripId = (await client.callTool({ name: 'create_trip', arguments: THAILAND_TRIP })).structuredContent.trip.id;
  browser = await chromium.launch();
  page = await openHost({ inline: [760, 400], full: [1100, 900] });
});
after(async () => { await browser?.close(); await client?.close(); srv?.server.close(); });

const frame = () => page.frameLocator('#planner');
const leg = (key) => frame().locator(`.row[data-leg="${key}"]`);
const lastMessage = () => page.evaluate(() => window.__messages.at(-1).content[0].text);
const lastContext = () => page.evaluate(() => window.__context.at(-1)?.content[0].text || '');
const server = async () => (await client.callTool({ name: 'open_planner', arguments: { trip_id: tripId } })).structuredContent;

test('in the chat: a trip card with the nights strip, what is settled, a map and one main action', { skip }, async () => {
  assert.equal(await frame().locator('#app').getAttribute('data-layout'), 'card');
  assert.equal(await frame().locator('#name').textContent(), 'Thailand island hop');
  assert.match(await frame().locator('#sub').textContent(), /2 travellers · 14 nights/);
  assert.equal(await frame().locator('#strip .seg').count(), 7, 'one segment per stay; the last stop has no nights');
  assert.match(await frame().locator('#strip .seg').nth(4).getAttribute('aria-label'), /^Koh Phi Phi, 3 nights/);
  assert.match(await frame().locator('#status').textContent(), /0 of 4 flights chosen · 0 of 5 ferries and drives booked/);
  assert.equal(await frame().locator('.side svg.map.mini').count(), 1);
  assert.equal(await frame().locator('button.primary').count(), 1, 'one main action');
  assert.ok(await frame().locator('#panes').isHidden());
});

test('opens full screen: the route on the left, the selected stop on the right', { skip }, async () => {
  await frame().getByRole('button', { name: 'Open planner' }).click();
  await frame().locator('#app[data-layout="app"]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.__modes), ['fullscreen']);
  assert.equal(await frame().locator('.row.stop').count(), 8);
  assert.equal(await frame().locator('.row.leg').count(), 9, 'out, seven between stops, home');
  assert.match(await leg(KBV_BKK).textContent(), new RegExp(`KBV → BKK · ${shortDay(LAST_DAY)}.*To choose`));
  assert.match(await frame().locator('.row.leg', { hasText: 'Ferry' }).first().textContent(), /To book/);
  assert.equal(await frame().locator('.detail h2').textContent(), 'Bangkok', 'a trip still ahead opens at its first stop');
  assert.equal(await frame().locator('.aside-map svg.map .pin').count(), 7, 'Bangkok twice, one pin');
});

test('changes nights in place, moves the dates, and tells Claude', { skip }, async () => {
  await frame().locator('.row.stop', { hasText: 'Koh Lanta' }).click();
  await frame().getByRole('button', { name: 'One night more' }).click();
  await frame().locator('.stepper .val', { hasText: '4 nights' }).waitFor();
  assert.equal((await server()).stops[LANTA].nights, 4);
  assert.match(await frame().locator('#sub').textContent(), /15 nights/);
  assert.match(await lastContext(), /changed Koh Lanta to 4 nights/);
  await frame().getByRole('button', { name: 'One night fewer' }).click();
  await frame().locator('.stepper .val', { hasText: '3 nights' }).waitFor();
  assert.equal((await server()).trip.end, LAST_DAY);
});

test('shows fares for a flight leg and saves the choice as a ticket', { skip }, async () => {
  await leg(KBV_BKK).click();
  await frame().getByRole('button', { name: 'Demo fares' }).click();
  await frame().locator('.fare').first().waitFor();
  assert.ok(await frame().locator('.fare').count() >= 5);
  await frame().locator('.fare').first().getByRole('button', { name: 'Choose' }).click();
  await frame().locator('.ticket').waitFor();
  assert.match(await frame().locator('.ticket').textContent(), /KBV.*BKK.*€\d+.*for 2/);
  assert.match(await leg(KBV_BKK).textContent(), /Chosen/);
  assert.match(await lastContext(), new RegExp(`chose .* for Ao Nang → Bangkok on ${LAST_DAY}`));
  assert.match(await frame().locator('#status').textContent(), /1 of 4 flights chosen/);
});

test('marks the flight booked, then removes it', { skip }, async () => {
  await frame().getByRole('button', { name: 'Mark booked', exact: true }).click();
  await frame().getByRole('button', { name: 'Booked', exact: true }).waitFor();
  assert.match(await leg(KBV_BKK).textContent(), /Booked/);
  assert.equal((await server()).legs.find((l) => l.key === KBV_BKK).booked, true);
  await frame().getByRole('button', { name: 'Booked', exact: true }).click();
  await frame().getByRole('button', { name: 'Mark booked', exact: true }).waitFor();
  await frame().getByRole('button', { name: 'Remove' }).click();
  await frame().getByRole('button', { name: 'Ask Claude to find flights' }).waitFor();
  assert.equal((await server()).legs.find((l) => l.key === KBV_BKK).chosen, null);
  assert.match(await leg(KBV_BKK).textContent(), /To choose/);
});

test('asks Claude to find flights and shows the one Claude saved', { skip }, async () => {
  await leg(OUT).click();
  await frame().getByRole('button', { name: 'Ask Claude to find flights' }).click();
  await page.waitForFunction(() => window.__messages.length > 0);
  const asked = await lastMessage();
  assert.match(asked, /^Find flights from .*\(FRA\) to Bangkok \(BKK or another airport nearby\) on .* for 2 adults, using my flight search tools\./);
  assert.ok(asked.includes(`choose_flight (trip_id "${tripId}", leg_key "${OUT}")`));
  await frame().getByText('Claude is searching with your flight tools').waitFor();
  // Claude would now search with the traveller's flight tools and save the pick itself
  const r = await client.callTool({ name: 'choose_flight', arguments: { trip_id: tripId, leg_key: OUT, summary: 'Thai Airways TG921, 13:30 FRA → 06:15 BKK', price: 1384, currency: 'EUR', source: 'Kiwi.com', link: 'https://www.kiwi.com/en/booking' } });
  assert.ok(!r.isError, JSON.stringify(r.content));
  await frame().getByRole('button', { name: 'Refresh' }).click();
  await frame().locator('.ticket').waitFor();
  assert.match(await frame().locator('.ticket').textContent(), /FRA13:30.*BKK06:15.*Thai Airways TG921 · via Kiwi\.com.*€1,384/);
  await frame().getByRole('button', { name: 'Booking page' }).click();
  await page.waitForFunction(() => window.__links.includes('https://www.kiwi.com/en/booking'));
});

test('asks Claude for local picks and shows them once saved', { skip }, async () => {
  await frame().locator('.row.stop', { hasText: 'Koh Lanta' }).click();
  await frame().getByRole('button', { name: 'Ask Claude for local picks' }).click();
  await page.waitForFunction(() => window.__messages.length > 1);
  assert.match(await lastMessage(), /save_local_picks \(place: "Koh Lanta"\)/);
  await client.callTool({ name: 'save_local_picks', arguments: { place: 'Koh Lanta', picks: [{ name: 'Time for Lime', kind: 'food', why: 'Cooking class and dinner on Klong Dao beach.', source_url: 'https://www.reddit.com/r/Thailand/' }] } });
  await frame().getByRole('button', { name: 'Refresh' }).click();
  await frame().locator('.picks', { hasText: 'Time for Lime' }).waitFor();
  assert.match(await frame().locator('.detail h3').textContent(), /Local picks \(1\)/);
  assert.match(await frame().locator('.row.stop', { hasText: 'Koh Lanta' }).textContent(), /1$/, 'the route shows how many picks');
  await frame().getByRole('button', { name: 'Source for Time for Lime' }).click();
  await page.waitForFunction(() => window.__links.includes('https://www.reddit.com/r/Thailand/'));
});

test('flags a chosen flight whose date moved, and clears it', { skip }, async () => {
  await client.callTool({ name: 'choose_flight', arguments: { trip_id: tripId, leg_key: KBV_BKK, summary: 'Thai AirAsia, 11:40 KBV → 12:55 DMK', price: 138, currency: 'EUR', source: 'LetsFG' } });
  await frame().locator('.row.stop', { hasText: 'Koh Lanta' }).click();
  await frame().getByRole('button', { name: 'One night more' }).click();
  await frame().locator('.stepper .val', { hasText: '4 nights' }).waitFor();
  const moved = `leg|KBV|BKK|${addDays(LAST_DAY, 1)}`;
  assert.match(await leg(moved).textContent(), /Date moved/);
  await leg(moved).click();
  assert.match(await frame().locator('.detail .note.warn').textContent(), new RegExp(`chosen for ${shortDay(LAST_DAY)}, before the dates moved: Thai AirAsia`));
  await frame().getByRole('button', { name: 'Remove it' }).click();
  await frame().locator('.detail .note.warn').waitFor({ state: 'detached' });
  assert.match(await leg(moved).textContent(), /To choose/);
  await frame().locator('.row.stop', { hasText: 'Koh Lanta' }).click();
  await frame().getByRole('button', { name: 'One night fewer' }).click();
  await frame().locator('.stepper .val', { hasText: '3 nights' }).waitFor();
});

test('a ferry: asks Claude how to get there, then marks it booked', { skip }, async () => {
  const ferry = (await server()).legs.find((l) => l.fromName === 'Koh Phi Phi' && l.toName === 'Koh Lanta');
  await leg(ferry.key).click();
  assert.match(await frame().locator('.detail .meta').first().textContent(), /^Ferry · .* · about \d+ km/);
  await frame().getByRole('button', { name: 'Ask Claude how to get there' }).click();
  await page.waitForFunction(() => /How do I get from Koh Phi Phi to Koh Lanta/.test(window.__messages.at(-1).content[0].text));
  assert.ok((await lastMessage()).includes(`mark_leg (trip_id "${tripId}", leg_key "${ferry.key}")`));
  await frame().getByRole('button', { name: 'Mark booked', exact: true }).click();
  await frame().getByRole('button', { name: 'Booked', exact: true }).waitFor();
  assert.match(await leg(ferry.key).textContent(), /Booked/);
  assert.match(await frame().locator('#status').textContent(), /1 of 5 ferries and drives booked/);
});

test('moves along the route with the arrow keys', { skip }, async () => {
  await frame().locator('.row.stop', { hasText: 'Khao Sok' }).click();
  await frame().locator('.row.stop', { hasText: 'Khao Sok' }).press('ArrowDown');
  assert.match(await frame().locator('.detail h2').textContent(), /^Khao Sok → Khao Lak$/);
  await page.keyboard.press('ArrowDown');
  assert.equal(await frame().locator('.detail h2').textContent(), 'Khao Lak');
});

test('back to chat returns to the card', { skip }, async () => {
  await frame().getByRole('button', { name: 'Back to chat' }).click();
  await frame().locator('#app[data-layout="card"]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.__modes), ['fullscreen', 'inline']);
});

test('a host without full screen shows the planner in place, one pane at a time', { skip }, async () => {
  const p = await openHost({ inline: [420, 1400], modes: ['inline'] });
  const f = p.frameLocator('#planner');
  assert.equal(await f.locator('#app').getAttribute('data-layout'), 'stacked');
  assert.ok(await f.locator('.list').isVisible());
  await f.locator('.row.stop', { hasText: 'Koh Lanta' }).click();
  await f.getByRole('button', { name: 'Route', exact: true }).waitFor();
  assert.ok(await f.locator('.list').isHidden());
  assert.equal(await f.locator('.detail h2').textContent(), 'Koh Lanta');
  await f.getByRole('button', { name: 'Route', exact: true }).click();
  assert.ok(await f.locator('.list').isVisible());
  await p.close();
});
