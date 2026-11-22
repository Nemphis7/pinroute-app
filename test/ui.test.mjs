// The planner inside a stand-in host: it loads the trip, searches flights through the server, saves a choice,
// tells Claude about it, asks Claude for local picks and shows them once saved. Skipped where Playwright is missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect, THAILAND_TRIP } from './helpers.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
const SHOTS = process.env.SCREENSHOT_DIR || null;

let srv, client, browser, page, tripId, hostJs;
const LEG = 'leg|KBV|BKK|2026-11-28';

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
  assert.match(await frame().locator(`li.leg[data-leg="${LEG}"]`).textContent(), /Ao Nang → Bangkok · flight KBV → BKK · Sat 28 Nov/);
  assert.match(await frame().locator('li.leg', { hasText: 'Koh Phi Phi → Koh Lanta' }).textContent(), /by road or ferry/);
});

test('finds flights through the server and saves a choice', { skip: !chromium && 'Playwright not installed' }, async () => {
  const leg = frame().locator(`li.leg[data-leg="${LEG}"]`);
  await leg.getByRole('button', { name: 'Find flights' }).click();
  await leg.locator('.fare').first().waitFor();
  assert.ok(await leg.locator('.fare').count() >= 5);
  await leg.locator('.fare').first().getByRole('button', { name: 'Choose' }).click();
  await leg.locator('.chosen').waitFor();
  assert.match(await leg.locator('.chosen').textContent(), /^Chosen: .*KBV → .* BKK · €/);
  await page.waitForFunction(() => window.__context.length > 0);      // sent to Claude right after the save
  const ctx = await page.evaluate(() => window.__context.map((c) => c.content[0].text));
  assert.match(ctx[0], /chose .* for Ao Nang → Bangkok on 2026-11-28/);
  await leg.locator('.fare').first().getByRole('button', { name: 'Check on Google Flights' }).click();
  await page.waitForFunction(() => window.__links.length > 0);        // links open through the host, asynchronously
  assert.match((await page.evaluate(() => window.__links))[0], /^https:\/\/www\.google\.com\/travel\/flights\?q=/);
});

test('asks Claude for local picks and shows them once saved', { skip: !chromium && 'Playwright not installed' }, async () => {
  const lanta = frame().locator('li.stop', { hasText: 'Koh Lanta' });
  await lanta.getByRole('button', { name: 'Ask Claude for local picks' }).click();
  await page.waitForFunction(() => window.__messages.length > 0);
  const asked = await page.evaluate(() => window.__messages[0].content[0].text);
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
