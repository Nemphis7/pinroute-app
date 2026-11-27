// Looking after trips in the planner (rename, details, other flights, delete) and the quick chat at the start,
// in the stand-in host. Skipped where Playwright is missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect, addDays, START } from './helpers.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
const skip = !chromium && 'Playwright not installed';

let srv, client, browser, hostJs, tripId;
const FROM = addDays(START, 10);
const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).structuredContent;

async function open(tool, args) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${srv.base}/__host`);
  await page.evaluate(([u, a, t]) => window.startHost(u, a, 'light', { inline: [760, 420], full: [1100, 900], tool: t }), [srv.url, args, tool]);
  const f = page.frameLocator('#planner');
  await f.locator('#app[data-screen]').waitFor();
  await f.getByRole('button', { name: /^Open (planner|Pinroute)$/ }).click();
  await f.locator('#app[data-layout="app"]').waitFor();
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
  await call('plan_new_trip', { free_from: FROM, free_until: addDays(FROM, 21), home_airports: ['FRA'], adults: 2, compare: ['Thailand'], step: 'flights' });
  const fare = { from: 'FRA', to: 'BKK', depart: addDays(FROM, 1), arrive: addDays(FROM, 2), return: addDays(FROM, 14), price: 1200, currency: 'EUR', adults: 2, airline: 'Thai Airways', source: 'LetsFG' };
  await call('save_flight_deals', { country: 'Thailand', deals: [fare, { ...fare, depart: addDays(FROM, 4), arrive: addDays(FROM, 5), return: addDays(FROM, 18), price: 1100, airline: 'Qatar Airways' }] });
  const deals = (await call('plan_new_trip')).deals['764'];
  tripId = (await call('start_trip_from_flight', { deal_id: deals.find((x) => x.price === 1200).id })).trip.id;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await client?.close(); srv?.server.close(); });

test('the trip menu renames a trip and changes its details', { skip }, async () => {
  const { page, f } = await open('open_planner', { trip_id: tripId });
  await f.getByRole('button', { name: 'Trip', exact: true }).click();
  await f.getByRole('menuitem', { name: 'Rename and details…' }).click();
  const dlg = f.getByRole('dialog', { name: 'Rename and details' });
  assert.match(await dlg.textContent(), /Your flights are for /);
  await dlg.locator('#ed-name').fill('Thailand with Ella');
  await dlg.locator('#ed-adults').fill('3');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await dlg.waitFor({ state: 'detached' });
  await f.locator('#name', { hasText: 'Thailand with Ella' }).waitFor();
  const t = (await call('open_planner', { trip_id: tripId })).trip;
  assert.deepEqual([t.name, t.adults], ['Thailand with Ella', 3]);
  await page.close();
});

test('Change flights moves the trip to another saved fare', { skip }, async () => {
  const { page, f } = await open('open_planner', { trip_id: tripId });
  await f.getByRole('button', { name: 'Trip', exact: true }).click();
  await f.getByRole('menuitem', { name: 'Change flights…' }).click();
  const dlg = f.getByRole('dialog', { name: 'Change flights' });
  await dlg.locator('.fare-row').first().waitFor();
  assert.equal(await dlg.locator('.fare-row').count(), 1, 'the fare the trip has is not offered again');
  assert.match(await dlg.locator('.fare-row').textContent(), /Qatar Airways.*\(\+1\)|\(\+1\).*Qatar Airways/s);
  await dlg.getByRole('button', { name: 'Use this fare' }).click();
  await dlg.waitFor({ state: 'detached' });
  const t = (await call('open_planner', { trip_id: tripId })).trip;
  assert.equal(t.ticket.airline, 'Qatar Airways');
  assert.equal(t.start, addDays(FROM, 5));
  await page.close();
});

test('a trip can be deleted from the start screen, after a question', { skip }, async () => {
  const { page, f } = await open('open_planner', {});
  await f.getByRole('button', { name: 'Delete Thailand with Ella' }).click();
  const dlg = f.getByRole('dialog', { name: 'Delete "Thailand with Ella"?' });
  await dlg.getByRole('button', { name: 'Keep' }).click();
  await dlg.waitFor({ state: 'detached' });
  assert.equal((await call('list_trips')).trips.length, 1);
  await f.getByRole('button', { name: 'Delete Thailand with Ella' }).click();
  await f.getByRole('dialog').getByRole('button', { name: 'Delete trip' }).click();
  await f.getByRole('dialog').waitFor({ state: 'detached' });
  await f.locator('.home .empty').waitFor();
  assert.equal((await call('list_trips')).trips.length, 0);
  await page.close();
});

test('what the traveller has in mind goes to Claude, and the planner follows what Claude sets', { skip }, async () => {
  const { page, f } = await open('plan_new_trip', { way: 'where', step: 'country' });
  await f.locator('#wish').fill('Indonesia, but only Sulawesi');
  await f.getByRole('button', { name: 'Ask Claude to set this up' }).click();
  await page.waitForFunction(() => window.__messages.length > 0);
  const asked = await page.evaluate(() => window.__messages.at(-1).content[0].text);
  assert.match(asked, /^Here is what I have in mind for my new trip in Pinroute: "Indonesia, but only Sulawesi"\. Set up my Pinroute draft to match with save_new_trip_draft \(the planner is open and follows\): the country \(country\)/);
  assert.match(asked, /show_answer \(key "new\|wish"\)/);
  assert.equal((await call('plan_new_trip')).draft.wishes, 'Indonesia, but only Sulawesi', 'saved before Claude answers');
  await call('save_new_trip_draft', { country: 'Indonesia', focus: [{ country: 'Indonesia', area: 'Sulawesi', airports: ['UPG', 'MDC'] }] });
  await f.locator('.nt-head h2', { hasText: 'When is best for Sulawesi, Indonesia?' }).waitFor({ timeout: 30000 });

  await f.getByRole('button', { name: 'Start over' }).click();
  await f.getByRole('dialog').getByRole('button', { name: 'Start over' }).click();
  await f.getByRole('dialog').waitFor({ state: 'detached' });
  const d = (await call('plan_new_trip')).draft;
  assert.deepEqual([d.wishes, d.focus, d.country], ['', {}, null]);
  await page.close();
});
