// Getting around the planner full screen: Back, Home, New trip and Trips along the top on a computer, as tabs at the
// bottom on a phone, and the list of trips. Runs in the stand-in host; skipped where Playwright is missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect, addDays, START } from './helpers.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
const skip = !chromium && 'Playwright not installed';

let srv, client, browser, hostJs;
const today = new Date().toISOString().slice(0, 10);

async function openHost(args, full) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${srv.base}/__host`);
  await page.evaluate(([u, a, o]) => window.startHost(u, a, 'light', o), [srv.url, args, { inline: [760, 420], full }]);
  const f = page.frameLocator('#planner');
  await f.locator('#app[data-screen]').waitFor();
  return { page, f };
}

before(async () => {
  if (!chromium) return;
  hostJs = (await build({ entryPoints: [new URL('./host/host.js', import.meta.url).pathname], bundle: true, format: 'iife', platform: 'browser', write: false })).outputFiles[0].text;
  srv = await startServer((app) => {
    app.get('/__host', (req, res) => res.type('html').send('<!doctype html><meta charset="utf-8"><body style="margin:0"><script src="/__host.js"></script>'));
    app.get('/__host.js', (req, res) => res.type('js').send(hostJs));
  });
  client = await connect(srv.url);
  const make = (name, start, place) => client.callTool({ name: 'create_trip', arguments: { name, start, adults: 2, stops: [{ place, nights: 4 }] } });
  await make('Later in the year', addDays(START, 60), 'Ao Nang');
  await make('On the road', addDays(today, -1), 'Koh Lanta');
  await make('Long ago', '2025-01-10', 'Bangkok');
  await make('Soon', START, 'Krabi');
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await client?.close(); srv?.server.close(); });

test('on a computer: Home, New trip and Trips along the top, and Back retraces the way', { skip }, async () => {
  const { page, f } = await openHost({}, [1100, 800]);
  await f.getByRole('button', { name: 'Open Pinroute' }).click();
  await f.locator('#app[data-layout="app"] .home').waitFor();
  const places = f.getByRole('navigation', { name: 'Pinroute' });
  assert.deepEqual(await places.getByRole('button').allTextContents(), ['Home', 'New trip', 'Trips']);
  assert.equal(await places.locator('[aria-current="page"]').textContent(), 'Home');
  assert.equal(await f.getByRole('button', { name: 'Back', exact: true }).isDisabled(), true, 'nowhere to go back to yet');
  assert.equal(await f.locator('#tabs').isHidden(), true, 'no bottom tabs on a computer');

  await places.getByRole('button', { name: 'New trip' }).click();
  await f.locator('.nt').waitFor();
  assert.equal(await places.locator('[aria-current="page"]').textContent(), 'New trip');
  assert.equal(await f.locator('.bar .steps .step').count(), 3, 'the steps sit under the bar');

  await f.locator('#trips-tab').click();
  await f.locator('#trips-menu .mi').first().waitFor();
  const items = await f.locator('#trips-menu .mi-t').allTextContents();
  assert.deepEqual(items, ['On the road', 'Soon', 'Later in the year', 'Long ago'], 'under way first, then what comes next, then the past');
  assert.match(await f.locator('#trips-menu .mi').first().textContent(), /Under way$/);
  await page.keyboard.press('Escape');
  await f.locator('#trips-menu').waitFor({ state: 'detached' });

  await f.locator('#trips-tab').click();
  await f.getByRole('menuitem', { name: /^Soon/ }).click();
  await f.locator('#app[data-screen="trip"]').waitFor();
  assert.equal(await f.locator('#trips-tab').getAttribute('aria-current'), 'page');
  assert.match(await f.locator('#trips-tab').textContent(), /^Soon$/, 'on a trip, the tab carries its name');

  await f.getByRole('button', { name: 'Back', exact: true }).click();
  await f.locator('.nt').waitFor();
  await f.locator('body').press('Alt+ArrowLeft');
  await f.locator('.home').waitFor();
  assert.equal(await f.getByRole('button', { name: 'Back', exact: true }).isDisabled(), true, 'back at the start');
  await page.close();
});

test('on a phone: Back, the title and the way out on top; Home, New trip and Trips as tabs at the bottom', { skip }, async () => {
  const { page, f } = await openHost({}, [390, 760]);
  await f.getByRole('button', { name: 'Open Pinroute' }).click();
  await f.locator('#app[data-layout="app"] .home').waitFor();
  assert.equal(await f.locator('.bar-title').textContent(), 'Pinroute');
  assert.equal(await f.locator('#tabs .tab.bottom').count(), 3);
  assert.equal(await f.locator('.bar .places').count(), 0, 'the places move to the bottom');
  const box = await f.locator('#tabs').boundingBox();
  assert.ok(box.y + box.height >= 755, 'the tabs sit at the bottom of the screen');

  await f.locator('#tabs').getByRole('button', { name: 'Trips' }).click();
  await f.getByRole('menuitem', { name: /^On the road/ }).click();
  await f.locator('#app[data-screen="trip"]').waitFor();
  assert.equal(await f.locator('.bar-title').textContent(), 'On the road');
  assert.equal(await f.locator('#name').isHidden(), true, 'the title is not repeated below the bar');
  await f.getByRole('button', { name: 'Back', exact: true }).click();
  await f.locator('.home').waitFor();
  await page.close();
});

test('in the chat: a trip card also leads to all trips', { skip }, async () => {
  const trips = (await client.callTool({ name: 'list_trips', arguments: {} })).structuredContent.trips;
  const { page, f } = await openHost({ trip_id: trips[0].id }, [1100, 800]);
  await f.getByRole('button', { name: 'All trips' }).click();
  await f.locator('#app[data-layout="app"] .home').waitFor();
  await f.getByRole('button', { name: 'Back', exact: true }).click();
  await f.locator('#app[data-screen="trip"]').waitFor();
  await page.close();
});
