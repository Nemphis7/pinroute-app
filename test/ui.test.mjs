// The planner inside a stand-in host: it loads the trip, shows fares from the server and saves a choice, asks Claude
// to find flights and shows the one Claude saved, asks Claude for local picks and shows them once saved.
// Skipped where Playwright is missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect, THAILAND_TRIP, START, LAST_DAY, KBV_BKK, shortDay } from './helpers.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
const SHOTS = process.env.SCREENSHOT_DIR || null;

let srv, client, browser, page, tripId, hostJs;
const LEG = KBV_BKK;
const OUT = `out|FRA|BKK|${START}`;

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
  page = await browser.newPage({ viewport: { width: 800, height: 1600 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${srv.base}/__host`);
  await page.evaluate(([u, id]) => window.startHost(u, { trip_id: id }), [srv.url, tripId]);
});
after(async () => { await browser?.close(); await client?.close(); srv?.server.close(); });

const frame = () => page.frameLocator('#planner');

test('shows the trip: name, eight stops, flight and ferry legs', { skip: !chromium && 'Playwright not installed' }, async () => {
  await frame().locator('.stop').nth(7).waitFor();
  assert.equal(await frame().locator('#name').textContent(), 'Thailand island hop');
  assert.equal(await frame().locator('.stop').count(), 8);
  assert.match(await frame().locator('#source').textContent(), /Demo fares/);
  assert.match(await frame().locator(`li.leg[data-leg="${LEG}"]`).textContent(), new RegExp(`Ao Nang → Bangkok · flight KBV → BKK · ${shortDay(LAST_DAY)}`));
  assert.match(await frame().locator('li.leg', { hasText: 'Koh Phi Phi → Koh Lanta' }).textContent(), /by road or ferry/);
});

test('shows fares from the server and saves a choice', { skip: !chromium && 'Playwright not installed' }, async () => {
  const leg = frame().locator(`li.leg[data-leg="${LEG}"]`);
  await leg.getByRole('button', { name: 'Demo fares' }).click();
  await leg.locator('.fare').first().waitFor();
  assert.ok(await leg.locator('.fare').count() >= 5);
  await leg.locator('.fare').first().getByRole('button', { name: 'Choose' }).click();
  await leg.locator('.chosen').waitFor();
  assert.match(await leg.locator('.chosen').textContent(), /^Chosen: .*KBV → .* BKK · €.* · via Demo data/);
  await page.waitForFunction(() => window.__context.length > 0);      // sent to Claude right after the save
  const ctx = await page.evaluate(() => window.__context.map((c) => c.content[0].text));
  assert.match(ctx[0], new RegExp(`chose .* for Ao Nang → Bangkok on ${LAST_DAY}`));
  await leg.locator('.fare').first().getByRole('button', { name: 'Check on Google Flights' }).click();
  await page.waitForFunction(() => window.__links.length > 0);        // links open through the host, asynchronously
  assert.match((await page.evaluate(() => window.__links))[0], /^https:\/\/www\.google\.com\/travel\/flights\?q=/);
});

test('asks Claude to find flights and shows the one Claude saved', { skip: !chromium && 'Playwright not installed' }, async () => {
  const leg = frame().locator(`li.leg[data-leg="${OUT}"]`);
  await leg.getByRole('button', { name: 'Ask Claude', exact: true }).click();
  await page.waitForFunction(() => window.__messages.length > 0);
  const asked = await page.evaluate(() => window.__messages[0].content[0].text);
  assert.match(asked, /^Find flights from .*\(FRA\) to Bangkok \(BKK or another airport nearby\) on .* for 2 adults, using my flight search tools\./);
  assert.ok(asked.includes(`choose_flight (trip_id "${tripId}", leg_key "${OUT}")`));
  await leg.getByText('Claude is searching with your flight tools').waitFor();
  // Claude would now search with the traveller's flight tools and save the pick itself
  const r = await client.callTool({ name: 'choose_flight', arguments: { trip_id: tripId, leg_key: OUT, summary: 'Thai Airways TG921, 13:30 FRA → 06:15 BKK', price: 1384, currency: 'EUR', source: 'Kiwi.com', link: 'https://www.kiwi.com/en/booking' } });
  assert.ok(!r.isError, JSON.stringify(r.content));
  await leg.getByRole('button', { name: 'Refresh' }).click();
  await leg.locator('.chosen').waitFor();
  assert.match(await leg.locator('.chosen').textContent(), /Thai Airways TG921.* · via Kiwi\.com/);
  await leg.locator('.chosen').getByRole('button', { name: 'Booking page' }).click();
  await page.waitForFunction(() => window.__links.includes('https://www.kiwi.com/en/booking'));
});

test('asks Claude for local picks and shows them once saved', { skip: !chromium && 'Playwright not installed' }, async () => {
  const lanta = frame().locator('li.stop', { hasText: 'Koh Lanta' });
  await lanta.getByRole('button', { name: 'Ask Claude for local picks' }).click();
  await page.waitForFunction(() => window.__messages.length > 1);
  const asked = await page.evaluate(() => window.__messages.at(-1).content[0].text);
  assert.match(asked, /Koh Lanta/);
  assert.match(asked, /save_local_picks \(place: "Koh Lanta"\)/);
  // Claude would now research and call this tool itself
  await client.callTool({ name: 'save_local_picks', arguments: { place: 'Koh Lanta', picks: [{ name: 'Time for Lime', kind: 'food', why: 'Cooking class and dinner on Klong Dao beach.', source_url: 'https://www.reddit.com/r/Thailand/' }] } });
  await lanta.getByRole('button', { name: 'Refresh' }).click();
  await lanta.getByText('Time for Lime').waitFor();
  assert.match(await lanta.locator('.picks').textContent(), /Local picks \(1\)/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/planner-light.png`, fullPage: true });
});

test('offers full screen when the host allows it', { skip: !chromium && 'Playwright not installed' }, async () => {
  await frame().getByRole('button', { name: 'Full screen' }).click();
  await page.waitForFunction(() => window.__modes.length > 0);
  assert.deepEqual(await page.evaluate(() => window.__modes), ['fullscreen']);
});
