// Building the route on the map: tapping a place adds it where it fits best and saves the route, the legs between the
// stops show as flight, ferry or road, a stop can move, change its nights or go, Claude can add places to tap, and Done
// goes back to the route. Skipped where Playwright is missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect, THAILAND_TRIP } from './helpers.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
const skip = !chromium && 'Playwright not installed';

let srv, client, browser, page, tripId;
before(async () => {
  if (!chromium) return;
  const hostJs = (await build({ entryPoints: [new URL('./host/host.js', import.meta.url).pathname], bundle: true, format: 'iife', platform: 'browser', write: false })).outputFiles[0].text;
  srv = await startServer((app) => {
    app.get('/__host', (req, res) => res.type('html').send('<!doctype html><meta charset="utf-8"><body style="margin:0"><script src="/__host.js"></script>'));
    app.get('/__host.js', (req, res) => res.type('js').send(hostJs));
  });
  client = await connect(srv.url);
  tripId = (await client.callTool({ name: 'create_trip', arguments: THAILAND_TRIP })).structuredContent.trip.id;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${srv.base}/__host`);
  await page.evaluate(([u, id]) => window.startHost(u, { trip_id: id }, 'light', { inline: [760, 400], full: [1280, 900] }), [srv.url, tripId]);
  await frame().locator('#strip .seg').first().waitFor();
  await frame().getByRole('button', { name: 'Open planner' }).click();
  await frame().locator('#app[data-layout="app"]').waitFor();
});
after(async () => { await browser?.close(); await client?.close(); srv?.server.close(); });

const frame = () => page.frameLocator('#planner');
const route = async () => (await client.callTool({ name: 'open_planner', arguments: { trip_id: tripId } })).structuredContent.stops.map((x) => `${x.place}:${x.nights}`).join(' > ');
const saved = async (want) => { for (let i = 0; i < 40; i++) { if ((await route()) === want) return; await page.waitForTimeout(150); } assert.equal(await route(), want); };
const lastContext = () => page.evaluate(() => window.__context.at(-1)?.content[0].text || '');
const START = 'Bangkok:1 > Khao Sok:1 > Khao Lak:2 > Koh Yao Noi:2 > Koh Phi Phi:3 > Koh Lanta:3 > Ao Nang:2';

test('opens from the route: places to tap, the numbered stops and what each leg is', { skip }, async () => {
  await frame().locator('#build-open').click();
  await frame().locator('#app[data-build="true"]').waitFor();
  await frame().locator('.bm .cand').first().waitFor();
  assert.ok(await frame().locator('.detail').isHidden(), 'the stop details make way');
  assert.equal(await frame().locator('.bl-stop').count(), 8);
  assert.equal(await frame().locator('.bm .bstop').count(), 7, 'Bangkok twice, one pin');
  assert.equal(await frame().locator('.bm .bstop', { hasText: 'Bangkok' }).locator('.num').textContent(), '1·8');
  assert.ok(await frame().locator('.bm .cand[aria-label="Add Koh Samui"]').count());
  assert.equal(await frame().locator('.bm .cand[aria-label="Add Koh Lanta"]').count(), 0, 'a place on the route is a stop, not a place to add');
  assert.deepEqual(await frame().locator('.bl-leg').evaluateAll((els) => els.map((e) => e.className.replace('bl-leg m-', ''))), ['flight', 'road', 'ferry', 'ferry', 'ferry', 'ferry', 'flight']);
  assert.match(await frame().locator('.bl-sum').textContent(), /8 stops · 14 nights.*2 flights, 4 ferries, 1 drive/);
});

test('tapping a place adds it where it fits best, draws its legs and saves the route', { skip }, async () => {
  await frame().locator('.bm .cand[aria-label="Add Koh Samui"]').press('Enter');
  await frame().locator('.bl-stop', { hasText: 'Koh Samui' }).waitFor();
  assert.equal(await frame().locator('.bm .bleg').count(), 8);
  await saved(`${START} > Koh Samui:2 > Bangkok:0`);
  assert.match(await frame().locator('.bl-sum').textContent(), /9 stops · 16 nights/);
  await frame().locator('.bl-save', { hasText: 'Saved' }).waitFor();
  await page.waitForFunction(() => /changed the route of "Thailand island hop".*Koh Samui \(2 nights\) → Bangkok \(0 nights\)/.test(window.__context.at(-1)?.content[0].text || ''), null, { timeout: 5000 });
  assert.match(await lastContext(), /on the map/);
});

test('a stop picked on the map: nights, earlier or later, remove, and undo', { skip }, async () => {
  await frame().locator('.bm .bstop[aria-label$="Khao Sok"]').press('Enter');
  const row = frame().locator('.bl-stop.sel');
  assert.match(await row.textContent(), /Khao Sok/);
  await row.getByRole('button', { name: 'One night more in Khao Sok' }).click();
  await row.getByRole('button', { name: 'Later' }).click();
  await saved('Bangkok:1 > Khao Lak:2 > Khao Sok:2 > Koh Yao Noi:2 > Koh Phi Phi:3 > Koh Lanta:3 > Ao Nang:2 > Koh Samui:2 > Bangkok:0');
  await frame().locator('.bl-stop.sel').getByRole('button', { name: 'Remove' }).click();
  await saved('Bangkok:1 > Khao Lak:2 > Koh Yao Noi:2 > Koh Phi Phi:3 > Koh Lanta:3 > Ao Nang:2 > Koh Samui:2 > Bangkok:0');
  assert.ok(await frame().locator('.bm .cand[aria-label="Add Khao Sok"]').count(), 'a stop taken out is a place to tap again');
  await frame().getByRole('button', { name: 'Undo' }).click();
  await saved('Bangkok:1 > Khao Lak:2 > Khao Sok:2 > Koh Yao Noi:2 > Koh Phi Phi:3 > Koh Lanta:3 > Ao Nang:2 > Koh Samui:2 > Bangkok:0');
  assert.equal(await frame().locator('.bl-stop').last().locator('.bl-tools').count(), 0);
  // The end of the route stays last
  await frame().locator('.bl-stop').last().locator('.bl-name').click();
  assert.ok(await frame().locator('.bl-stop.sel').getByRole('button', { name: 'Later' }).isDisabled());
});

test('a place found by name joins the route', { skip }, async () => {
  await frame().locator('#bl-q').fill('Chiang M');
  await frame().locator('.bl-found .row', { hasText: 'Chiang Mai' }).first().click();
  await frame().locator('.bl-stop', { hasText: 'Chiang Mai' }).waitFor();
  for (let i = 0; i < 40 && !/Chiang Mai:2/.test(await route()); i++) await page.waitForTimeout(150);
  assert.match(await route(), /^Bangkok:1 > Chiang Mai:2 > /, 'next to Bangkok, where it adds the least travel');
});

test('Claude adds places to tap; the map picks them up', { skip }, async () => {
  await frame().getByRole('button', { name: 'Ask Claude for places' }).click();
  const msg = await page.evaluate(() => window.__messages.at(-1).content[0].text);
  assert.match(msg, new RegExp(`save_route_ideas.*${tripId}|${tripId}.*save_route_ideas`));
  assert.match(msg, /use only Pinroute's own tools/);
  await client.callTool({ name: 'save_route_ideas', arguments: { trip_id: tripId, places: [{ place: 'Khanom', lat: 9.2, lon: 99.86, why: 'Quiet beaches and pink dolphins' }] } });
  await frame().locator('.bm .cand.from-claude[aria-label="Add Khanom"]').waitFor({ timeout: 15000 });
});

test('Done goes back to the route, which shows the stops added on the map', { skip }, async () => {
  await frame().locator('#bl-done').click();
  await frame().locator('#app[data-build="false"]').waitFor();
  await frame().locator('.row.stop', { hasText: 'Koh Samui' }).waitFor();
  assert.ok(await frame().locator('.panes .stage:not(.bm)').isVisible());
});
