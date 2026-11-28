// Departure airports picked on a map, and one fare's dates compared across departure and arrival airports, in the
// stand-in host. Skipped where Playwright is missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect, addDays, START } from './helpers.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
const skip = !chromium && 'Playwright not installed';

let srv, client, browser, page, hostJs;
const f = () => page.frameLocator('#planner');
const draft = async () => (await client.callTool({ name: 'plan_new_trip', arguments: {} })).structuredContent;

before(async () => {
  if (!chromium) return;
  hostJs = (await build({ entryPoints: [new URL('./host/host.js', import.meta.url).pathname], bundle: true, format: 'iife', platform: 'browser', write: false })).outputFiles[0].text;
  srv = await startServer((app) => {
    app.get('/__host', (req, res) => res.type('html').send('<!doctype html><meta charset="utf-8"><body style="margin:0"><script src="/__host.js"></script>'));
    app.get('/__host.js', (req, res) => res.type('js').send(hostJs));
  });
  client = await connect(srv.url);
  const from = addDays(START, 10);
  await client.callTool({ name: 'plan_new_trip', arguments: { free_from: from, free_until: addDays(from, 21), home_airports: ['FRA'], compare: ['Vietnam'], step: 'when' } });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${srv.base}/__host`);
  await page.evaluate(([u]) => window.startHost(u, {}, 'light', { inline: [760, 420], full: [1100, 900], tool: 'plan_new_trip' }), [srv.url]);
  await f().getByRole('button', { name: 'Open planner' }).click();
  await f().locator('#w-from').waitFor();
});
after(async () => { await browser?.close(); await client?.close(); srv?.server.close(); });

test('picks departure airports on a map: around the main airport, the bigger ones in range ticked', { skip }, async () => {
  await f().getByRole('button', { name: 'Pick on a map' }).click();
  const dialog = f().getByRole('dialog', { name: 'Departure airports' });
  await dialog.locator('.am-svg').waitFor();
  await dialog.locator('.am-row').first().waitFor();
  assert.equal(await dialog.locator('.am-row.have .code').first().textContent(), 'FRA');
  assert.equal(await dialog.locator('.am-row input:checked:not(:disabled)').count(), 3, 'the three busiest in range are ticked');
  assert.ok(await dialog.locator('.am-dot').count() >= 8);

  await dialog.locator('#am-km').fill('400');
  await dialog.locator('#am-km').dispatchEvent('change');
  await dialog.locator('.am-row .code', { hasText: 'AMS' }).waitFor();
  await dialog.locator('#am-AMS').check();
  assert.equal(await dialog.locator('.am-foot button.primary').textContent(), 'Add 4 airports');

  const before = await dialog.locator('.am-row .code').allTextContents();
  const box = await dialog.locator('.am-svg').boundingBox();
  await dialog.locator('.am-svg').click({ position: { x: box.width * 0.2, y: box.height * 0.5 } });
  await page.waitForFunction((b) => {
    const rows = [...document.querySelector('#planner').contentDocument.querySelectorAll('.am-row .code')].map((e) => e.textContent);
    return rows.length && rows.join() !== b.join();
  }, before);
  assert.ok(await dialog.locator('#am-AMS:checked').count() === 1 || !(await dialog.locator('#am-AMS').count()), 'a tick stays while its airport is in range');

  await dialog.locator('.am-foot button.primary').click();
  await dialog.waitFor({ state: 'detached' });
  await f().locator('.token').nth(2).waitFor();
  const homes = (await draft()).draft.homes;
  assert.equal(homes[0], 'FRA', 'the main airport stays first');
  assert.ok(homes.length >= 3 && homes.length <= 6, homes.join());
});

test('Escape closes the map without adding anything', { skip }, async () => {
  const n = (await draft()).draft.homes.length;
  await f().getByRole('button', { name: 'Pick on a map' }).click();
  await f().getByRole('dialog').locator('.am-row').first().waitFor();
  await f().locator('#am-close').press('Escape');
  await f().getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal((await draft()).draft.homes.length, n);
});

test('compares the same dates from every departure airport to the airports chosen, cheapest marked', { skip }, async () => {
  await f().locator('.step', { hasText: 'Flights' }).click();
  await f().locator('.country').first().getByRole('button', { name: 'Find flights' }).click();
  await f().locator('.country .deal.main').waitFor({ timeout: 30000 });
  const block = f().locator('details.compare');
  await block.locator('summary').click();
  const homes = (await draft()).draft.homes;
  assert.equal(await block.locator('tbody tr').count(), homes.length, 'one row per departure airport');
  assert.ok(await block.locator('thead .mx-h').count() >= 3, 'the main arrival airports of the country');
  const on = Math.min(4, homes.length);
  assert.equal(await block.getByRole('button', { name: /^Compare/ }).textContent(), `Compare ${on} route${on === 1 ? '' : 's'}`);

  await block.locator('thead .mx-h', { hasText: 'HAN' }).click();
  await block.getByRole('button', { name: `Compare ${on * 2} routes` }).click();
  await block.locator('td.win').waitFor({ timeout: 30000 });
  assert.ok(await block.locator('td button.mx-c').count() >= on * 2 - 1, 'a price on (almost) every route switched on');
  assert.match(await block.locator('td.win').textContent(), /^€\d/);
  assert.match(await block.textContent(), /\d+ of 50 searches left today/);

  const other = block.locator('td:not(.win) button.mx-c').first();
  await other.click();
  await block.locator('td.picked:not(.win)').waitFor();
  assert.equal(await block.locator('.deal').count(), 1, 'the fare picked in the table, ready to plan with');
});
