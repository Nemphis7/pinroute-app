// The planner with Travelpayouts on: recent prices for the deals and the months, Aviasales partner links on fares and
// flight legs, and the note that Pinroute may earn a commission. Stand-in host and a stand-in Travelpayouts API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect, addDays, START } from './helpers.mjs';
import { fakeTravelpayouts } from './fake-travelpayouts.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
const skip = !chromium && 'Playwright not installed';

let fake, srv, client, browser, page, hostJs;
const f = () => page.frameLocator('#planner');
const FROM = `${addDays(START, 30).slice(0, 7)}-01`;

before(async () => {
  if (!chromium) return;
  fake = await fakeTravelpayouts();
  hostJs = (await build({ entryPoints: [new URL('./host/host.js', import.meta.url).pathname], bundle: true, format: 'iife', platform: 'browser', write: false })).outputFiles[0].text;
  srv = await startServer((app) => {
    app.get('/__host', (req, res) => res.type('html').send('<!doctype html><meta charset="utf-8"><body style="margin:0"><script src="/__host.js"></script>'));
    app.get('/__host.js', (req, res) => res.type('js').send(hostJs));
  }, { TRAVELPAYOUTS_API_URL: fake.url, TRAVELPAYOUTS_TOKEN: 'tp-test', AVIASALES_PRICES: 'on', TRAVELPAYOUTS_MARKER: '123456', TRAVELPAYOUTS_TRS: '987' });
  client = await connect(srv.url);
  await client.callTool({ name: 'plan_new_trip', arguments: { free_from: FROM, free_until: addDays(FROM, 27), adults: 2, home_airports: ['FRA'], compare: ['Vietnam', 'Thailand'], step: 'flights' } });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${srv.base}/__host`);
  await page.evaluate(([u]) => window.startHost(u, {}, 'light', { inline: [760, 420], full: [1100, 900], tool: 'plan_new_trip' }), [srv.url]);
  await f().getByRole('button', { name: 'Open planner' }).click();
  await f().locator('.country').first().waitFor();
});
after(async () => { await browser?.close(); await client?.close(); srv?.server.close(); fake?.close(); });

test('deals from recent prices first, live airline fares second, and the commission said plainly', { skip }, async () => {
  const bar = f().locator('.toolbar');
  assert.deepEqual((await bar.locator('.acts button').allTextContents()).map((t) => t.trim()), ['Find flights']);
  assert.match(await f().locator('.foot').last().textContent(), /Pinroute may earn a commission on a booking\. The price you pay is the same\./);
  await bar.getByRole('button', { name: 'Find flights' }).click();
  await f().locator('.country .deal.main').nth(1).waitFor({ timeout: 30000 });
  await bar.getByRole('button', { name: 'Find flights' }).waitFor();  // both look-ups done: recent prices, then airline fares
  const main = f().locator('.country .deal.main').first();
  assert.match(await main.textContent(), /via Aviasales · a recent price, check it before booking/);
  await main.getByRole('button', { name: 'Check on Aviasales' }).click();
  await page.waitForFunction(() => window.__links.length > 0);
  assert.match(await page.evaluate(() => window.__links.at(-1)), /^https:\/\/aviasales\.tp\.st\//, 'the fare opens as a partner link');
});

test('the cheapest window from each departure day, and a tap checks that window live', { skip }, async () => {
  const strip = f().locator('.country').first().locator('.wstrip');
  await strip.waitFor({ timeout: 30000 });
  assert.ok(await strip.locator('button.win').count() >= 5, 'many departure days, not two or three dates');
  assert.ok(await strip.locator('button.win.low').count() >= 1, 'the cheapest marked');
  const w = strip.locator('button.win').nth(1);
  const title = await w.getAttribute('title');
  const [, out] = title.match(/^(\w{3} \d+ \w{3})/) || [];
  assert.ok(out, title);
  const left = async () => (await client.callTool({ name: 'plan_new_trip', arguments: {} })).structuredContent.flights.searchesLeft;
  const before = await left();
  await w.click();
  for (let i = 0; i < 50 && (await left()) === before; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(await left(), before - 1, 'one live search for that window');
});

test('the best time to go fills every month from one look-up', { skip }, async () => {
  await client.callTool({ name: 'plan_new_trip', arguments: { country: 'Japan' } });
  await f().getByRole('button', { name: 'Home' }).click();
  await f().locator('.home').waitFor();
  await f().getByRole('button', { name: 'Continue' }).click();
  await f().locator('.mgrid').waitFor();
  await f().getByRole('button', { name: 'Find flights' }).click();
  await f().locator('.banner', { hasText: 'Cheapest good month' }).waitFor({ timeout: 30000 });
  await f().getByRole('button', { name: 'Find flights' }).waitFor({ timeout: 30000 });   // recent prices, then airline fares for the good months
  const priced = await f().locator('.mcell .mprice').allTextContents();
  assert.ok(priced.filter((t) => /^€/.test(t)).length >= 11, priced.join(' '));
  assert.equal(fake.calls.filter((c) => c.path === '/aviasales/v3/grouped_prices' && c.query.group_by !== 'departure_at').length, 1, 'one look-up for the year by month');
});

test('a flight search links to Aviasales for its route and date', { skip }, async () => {
  const t = (await client.callTool({ name: 'create_trip', arguments: { name: 'Hop', start: START, adults: 2, stops: [{ place: 'Krabi', nights: 2 }, { place: 'Bangkok', nights: 1 }] } })).structuredContent;
  const p2 = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  await p2.goto(`${srv.base}/__host`);
  await p2.evaluate(([u, id]) => window.startHost(u, { trip_id: id }, 'light', { inline: [760, 420], full: [1100, 900] }), [srv.url, t.trip.id]);
  const g = p2.frameLocator('#planner');
  await g.getByRole('button', { name: 'Open planner' }).click();
  await g.locator('.row.leg').first().click();
  await g.getByRole('button', { name: 'Find flights' }).click();
  await g.locator('.quotes').waitFor();
  await g.locator('.quotes').getByRole('button', { name: /Aviasales/ }).click();
  await p2.waitForFunction(() => window.__links.length > 0);
  const made = fake.calls.filter((c) => c.path === '/links/v1/create').flatMap((c) => c.body.links.map((x) => x.url));
  assert.ok(made.some((u) => u.startsWith(`https://www.aviasales.com/search/KBV${addDays(START, 2).slice(8, 10)}${addDays(START, 2).slice(5, 7)}BKK`)), made.join(' '));
  assert.match(await g.locator('.detail').textContent(), /Pinroute may earn a commission/);
  await p2.close();
});
