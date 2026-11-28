// Tours and activities on a stop of the planner: found with Amadeus, shown as cards with GetYourGuide and Klook
// links, and one kept with the stop's local picks. Skipped where Playwright is missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect, THAILAND_TRIP } from './helpers.mjs';
import { fakeAmadeus } from './fake-amadeus.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
const skip = !chromium && 'Playwright not installed';

let am, srv, client, browser, page, tripId;
before(async () => {
  if (!chromium) return;
  am = await fakeAmadeus();
  const hostJs = (await build({ entryPoints: [new URL('./host/host.js', import.meta.url).pathname], bundle: true, format: 'iife', platform: 'browser', write: false })).outputFiles[0].text;
  srv = await startServer((app) => {
    app.get('/__host', (req, res) => res.type('html').send('<!doctype html><meta charset="utf-8"><body style="margin:0"><script src="/__host.js"></script>'));
    app.get('/__host.js', (req, res) => res.type('js').send(hostJs));
  }, { AMADEUS_API_KEY: 'am-test', AMADEUS_GATEWAY_URL: am.url });
  client = await connect(srv.url);
  tripId = (await client.callTool({ name: 'create_trip', arguments: THAILAND_TRIP })).structuredContent.trip.id;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${srv.base}/__host`);
  await page.evaluate(([u, id]) => window.startHost(u, { trip_id: id }, 'light', { inline: [760, 400], full: [1100, 900] }), [srv.url, tripId]);
  await page.frameLocator('#planner').locator('#strip .seg').first().waitFor();
});
after(async () => { await browser?.close(); await client?.close(); srv?.server.close(); am?.close(); });
const frame = () => page.frameLocator('#planner');

test('finds tours at a stop, shows them as cards to keep or skip, and keeps one in the plan for the stay', { skip }, async () => {
  await frame().getByRole('button', { name: 'Open planner' }).click();
  await frame().locator('.row.stop', { hasText: 'Koh Lanta' }).click();
  await frame().getByRole('button', { name: 'Find tours in Koh Lanta' }).click();
  const front = frame().locator('.pickdeck .dcard.front');
  await front.waitFor();
  assert.match(await frame().locator('.pickdeck .block-head').textContent(), /8 to go/);
  assert.match(await front.textContent(), /Tour.*Tour 30.*from €70 pp · 3 hours.*Experience authentic culture & food\./);
  assert.match(await front.textContent(), /4\.7 \(475\)/);
  await front.getByRole('button', { name: 'GetYourGuide' }).click();
  await page.waitForFunction(() => window.__links.some((l) => l.startsWith('https://www.getyourguide.com/s/?q=Tour%2030%20Koh%20Lanta')));
  await frame().getByRole('button', { name: 'Keep Tour 30' }).click();
  await frame().locator('.plan .plan-item', { hasText: 'Tour 30' }).waitFor();
  const picks = (await client.callTool({ name: 'get_local_picks', arguments: { place: 'Koh Lanta' } })).structuredContent.picks;
  assert.deepEqual(picks.map((p) => [p.name, p.kind, p.price_from, p.status]), [['Tour 30', 'activity', 70, 'keep']]);
  // Skipped with the arrow key, and back with Undo
  const next = (await frame().locator('.pickdeck .dcard.front .dname').textContent()).trim();
  await frame().locator('.pickdeck .dcard.front').focus();
  await frame().locator('.pickdeck .dcard.front').press('ArrowLeft');
  await frame().locator('.pickdeck .block-head', { hasText: '6 to go' }).waitFor();
  await frame().getByRole('button', { name: `Undo: ${next}` }).click();
  await frame().locator('.pickdeck .dcard.front', { hasText: next }).waitFor();
});
