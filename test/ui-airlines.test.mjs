// The planner names airlines, not their codes, wherever a fare shows: the deals for a new trip and a trip's flights,
// full screen on a computer and on a phone, and in place on a host without full screen; a long name wraps instead of
// widening the planner. Fares come from a stand-in Travelpayouts API (which sends "VJ") and from Claude with codes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect, addDays, START } from './helpers.mjs';
import { fakeTravelpayouts } from './fake-travelpayouts.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
const skip = !chromium && 'Playwright not installed';

let fake, srv, client, browser, hostJs, tripId;
const FROM = `${addDays(START, 30).slice(0, 7)}-01`;
// a long name on purpose: it has to wrap in a 390 px phone
const LONG = { from: 'FRA', to: 'BKK', depart: addDays(FROM, 3), return: addDays(FROM, 14), price: 1180, currency: 'EUR', airline: '8M',
  out: '8M 602, 09:30 FRA → 06:10 BKK', back: '8M 603, 22:15 BKK → 07:05 FRA', stops: 1, source: 'Kiwi.com' };

async function openHost(args, opts) {
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1200, height: 1000 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${srv.base}/__host`);
  await page.evaluate(([u, a, o]) => window.startHost(u, a, 'light', o), [srv.url, args, opts]);
  const f = page.frameLocator('#planner');
  await f.locator('#app[data-screen]').waitFor();
  return { page, f };
}
// Nothing in the planner is wider than its frame
const fits = (page) => page.frameLocator('#planner').locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
// An element ends inside the planner's width
const inside = (loc) => loc.evaluate((el) => el.getBoundingClientRect().right <= document.documentElement.clientWidth + 1);
const NO_CODE = /(^|[\s·(])(VJ|8M|TG)( ·|,|$)/m;           // a bare code where the name belongs

before(async () => {
  if (!chromium) return;
  fake = await fakeTravelpayouts();
  hostJs = (await build({ entryPoints: [new URL('./host/host.js', import.meta.url).pathname], bundle: true, format: 'iife', platform: 'browser', write: false })).outputFiles[0].text;
  srv = await startServer((app) => {
    app.get('/__host', (req, res) => res.type('html').send('<!doctype html><meta charset="utf-8"><body style="margin:0"><script src="/__host.js"></script>'));
    app.get('/__host.js', (req, res) => res.type('js').send(hostJs));
  }, { TRAVELPAYOUTS_API_URL: fake.url, TRAVELPAYOUTS_TOKEN: 'tp-test' });
  client = await connect(srv.url);
  await client.callTool({ name: 'plan_new_trip', arguments: { free_from: FROM, free_until: addDays(FROM, 27), adults: 2, home_airports: ['FRA'], compare: ['Vietnam', 'Thailand'], step: 'flights' } });
  await client.callTool({ name: 'scan_flight_deals', arguments: { country: 'Vietnam' } });
  await client.callTool({ name: 'save_flight_deals', arguments: { country: 'Thailand', deals: [LONG] } });
  const deal = (await client.callTool({ name: 'plan_new_trip', arguments: {} })).structuredContent.deals['764'][0];
  tripId = (await client.callTool({ name: 'start_trip_from_flight', arguments: { deal_id: deal.id, name: 'Long name' } })).structuredContent.trip.id;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await client?.close(); srv?.server.close(); fake?.close(); });

for (const [label, opts] of [
  ['full screen on a computer', { inline: [760, 420], full: [1100, 900] }],
  ['full screen on a phone', { inline: [390, 420], full: [390, 800], viewport: { width: 390, height: 844 } }],
  ['in place on a host without full screen', { inline: [420, 1600], modes: ['inline'] }],
]) {
  test(`deals name their airline, ${label}`, { skip }, async () => {
    const { page, f } = await openHost({}, { ...opts, tool: 'plan_new_trip' });
    if (!opts.modes) await f.getByRole('button', { name: 'Open planner' }).click();
    const vietnam = f.locator('.country', { hasText: 'Vietnam' });
    await vietnam.locator('.deal.main').waitFor();
    assert.match(await vietnam.locator('.deal.main').textContent(), /VietJet Air · /);
    const thailand = f.locator('.country', { hasText: 'Thailand' });
    assert.match(await thailand.locator('.deal.main').textContent(), /Myanmar Airways International · 1 change/);
    assert.doesNotMatch(await f.locator('.nt').innerText(), NO_CODE);
    assert.ok(await fits(page), 'nothing wider than the planner');
    await page.close();
  });

  test(`a trip's flights name their airline, ${label}`, { skip }, async () => {
    const { page, f } = await openHost({ trip_id: tripId }, opts);
    if (!opts.modes) await f.getByRole('button', { name: 'Open planner' }).click();
    await f.locator('#app[data-screen="trip"] .row.stop').first().waitFor({ state: 'attached' });
    const leg = f.locator('.row.leg').first();
    if (!(await leg.isVisible())) await f.getByRole('button', { name: 'Route', exact: true }).click();   // one pane at a time
    await leg.click();
    const stub = f.locator('.detail .ticket').first();
    await stub.waitFor();
    assert.match(await stub.textContent(), /Myanmar Airways International 8M\u00a0602 · via Kiwi\.com/);
    assert.ok(await inside(stub), 'the long name wraps inside the flight');
    await page.close();
  });
}

test('the card in the chat stays as it was: no airline on it, nothing wider than the card', { skip }, async () => {
  const { page, f } = await openHost({}, { inline: [390, 420], full: [1100, 900], tool: 'plan_new_trip' });
  await f.locator('#app[data-layout="card"]').waitFor();
  assert.match(await f.locator('#app').innerText(), /Best deal: /);
  assert.doesNotMatch(await f.locator('#app').innerText(), NO_CODE);
  assert.ok(await fits(page));
  await page.close();
});
