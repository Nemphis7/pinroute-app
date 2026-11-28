// Flights the traveller booked themselves, in the planner: starting a new trip from them (read by Claude from a pasted
// booking, or filled in), and adding one to a leg of a trip. What Claude would save is saved by the test.
// SHOTS=<dir> also saves screenshots there. Skipped where Playwright is missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect, addDays, START } from './helpers.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
const skip = !chromium && 'Playwright not installed';

let srv, client, browser, page, hostJs;
const OUT = addDays(START, 14), BACK = addDays(OUT, 14);
const frame = () => page.frameLocator('#planner');
const lastMessage = () => page.evaluate(() => window.__messages.at(-1).content[0].text);
const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }); };

async function openHost(tool, args, opts = {}) {
  const p = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: process.env.SHOTS ? 2 : 1 });
  p.on('pageerror', (e) => console.error('page error:', e.message));
  await p.goto(`${srv.base}/__host`);
  await p.evaluate(([u, a, o]) => window.startHost(u, a, 'light', o), [srv.url, args, { inline: [760, 420], full: [1100, 900], tool, ...opts }]);
  await p.frameLocator('#planner').locator('#app[data-screen]').waitFor();
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
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await client?.close(); srv?.server.close(); });

test('the new-trip start: a quiet link opens the panel; Claude reads the pasted booking and the trip opens', { skip }, async () => {
  await client.callTool({ name: 'plan_new_trip', arguments: { reset: true, way: 'prompt', home_airports: ['FRA'] } });
  page = await openHost('plan_new_trip', {}, { modes: ['inline', 'fullscreen'] });
  await page.evaluate(() => window.__bridge.setHostContext({ theme: 'light', displayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'], locale: 'en-GB' }));
  await page.evaluate(() => { document.getElementById('planner').style.cssText = 'width:1100px;height:900px;border:0;display:block'; });
  await frame().getByRole('button', { name: 'Start from your flights' }).click();
  await frame().locator('.own').waitFor();
  await frame().locator('.own textarea').fill(`Lufthansa LH 772 FRA-BKK ${OUT} 21:55, arr 14:30 next day. Return TG 920 BKK-FRA ${BACK} 23:45 arr 06:10. Ref XK7P2Q`);
  await shot('new-trip-booked-panel');
  await frame().getByRole('button', { name: 'Read it with Claude' }).click();
  await page.waitForFunction(() => window.__messages.length > 0);
  const msg = await lastMessage();
  assert.match(msg, /add_booked_flight, without trip_id/);
  assert.match(msg, /LH 772 FRA-BKK/);
  assert.match(msg, /Don't search for flights/);
  // Claude saves what it read; the open planner follows to the trip
  const r = await client.callTool({ name: 'add_booked_flight', arguments: {
    out: { from: 'FRA', to: 'BKK', date: OUT, departs: '21:55', arrives: '14:30', arrive_date: addDays(OUT, 1), number: 'LH 772' },
    back: { from: 'BKK', to: 'FRA', date: BACK, departs: '23:45', arrives: '06:10', number: 'TG 920' }, booking_ref: 'XK7P2Q' } });
  assert.ok(!r.isError, r.content?.[0]?.text);
  await frame().locator('#app[data-screen="trip"]').waitFor({ timeout: 20000 });
  assert.match(await frame().locator('#status').textContent(), /2 of 2 flights/);
  await frame().locator('.row.leg').first().click();
  await frame().locator('.ticket').waitFor();
  assert.match(await frame().locator('.ticket').textContent(), /FRA21:55.*BKK14:30.*Lufthansa LH.772.*Your booking/);
  assert.match(await frame().locator('.pill').first().textContent(), /Booked/);
  assert.equal(await frame().getByRole('button', { name: 'Find flights' }).count(), 0, 'no search for a booked flight');
  await shot('trip-booked-flight');
  await page.close();
});

test('the Flights step: flights filled in by hand start the trip', { skip }, async () => {
  await client.callTool({ name: 'plan_new_trip', arguments: { reset: true, way: 'where', step: 'flights', country: 'Vietnam', compare: ['Vietnam'], home_airports: ['FRA'] } });
  page = await openHost('plan_new_trip', {});
  await page.evaluate(() => window.__bridge.setHostContext({ theme: 'light', displayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'], locale: 'en-GB' }));
  await page.evaluate(() => { document.getElementById('planner').style.cssText = 'width:1100px;height:900px;border:0;display:block'; });
  await frame().locator('.toolbar').waitFor();
  await frame().getByRole('button', { name: 'Start from your flights' }).click();
  await frame().getByText('Or fill it in yourself').click();
  const f = (side, k) => frame().locator(`#own-new-${side}-${k}`);
  await f('out', 'number').fill('qr 70');
  await f('out', 'from').fill('fra');
  await f('out', 'to').fill('SGN');
  await f('out', 'date').fill(OUT);
  await f('out', 'departs').fill('21:10');
  await f('out', 'arrives').fill('13:40');
  await f('out', 'plus').selectOption('1');
  await f('back', 'number').fill('VN 37');
  await f('back', 'from').fill('HAN');
  await f('back', 'to').fill('FRA');
  await f('back', 'date').fill(BACK);
  await f('back', 'departs').fill('23:30');
  await f('back', 'arrives').fill('06:05');
  await shot('flights-step-filled-in');
  await frame().getByRole('button', { name: 'Plan around these flights' }).click();
  await frame().locator('#app[data-screen="trip"]').waitFor();
  const v = await frame().locator('body').evaluate(() => window.__pinroute.view);
  assert.equal(v.trip.start, addDays(OUT, 1));
  assert.equal(v.trip.end, BACK);
  assert.ok(v.legs.filter((l) => l.kind === 'out' || l.kind === 'home').every((l) => l.booked && l.chosen.own));
  assert.equal(v.legs.find((l) => l.kind === 'out').chosen.summary, 'Qatar Airways QR 70, 21:10 FRA → 13:40 SGN (+1)');
  await page.close();
});

test('a leg of a trip: "I already have this flight", filled in, saves it booked', { skip }, async () => {
  const t = (await client.callTool({ name: 'create_trip', arguments: { name: 'Two cities', start: START, adults: 2, home_airport: 'FRA',
    stops: [{ place: 'Bangkok', nights: 3 }, { place: 'Chiang Mai', nights: 4 }] } })).structuredContent;
  const leg = t.legs.find((l) => l.kind === 'flight');
  page = await openHost('open_planner', { trip_id: t.trip.id });
  await frame().getByRole('button', { name: 'Open planner' }).click();
  await frame().locator(`.row[data-leg="${leg.key}"]`).click();
  await frame().getByRole('button', { name: 'I already have this flight' }).click();
  await frame().locator('.own textarea').fill('FD 3433 10:40');
  await frame().getByRole('button', { name: 'Read it with Claude' }).click();
  await page.waitForFunction(() => window.__messages.length > 0);
  assert.match(await lastMessage(), new RegExp(`leg_key "${leg.key.replace(/\|/g, '\\|')}"`));
  await frame().getByText('Or fill it in yourself').click();
  const id = `#own-leg-${leg.key.replace(/[^\w]/g, '-')}-out`;
  assert.equal(await frame().locator(`${id}-date`).inputValue(), leg.date, 'the leg\'s day to start from');
  assert.equal(await frame().locator(`${id}-from`).count(), 0, 'the airports are the leg\'s');
  await frame().locator(`${id}-number`).fill('FD 3433');
  await frame().locator(`${id}-departs`).fill('10:40');
  await frame().locator(`${id}-arrives`).fill('11:55');
  await shot('leg-filled-in');
  await frame().getByRole('button', { name: 'Save as booked' }).click();
  await frame().locator('.ticket').waitFor();
  assert.match(await frame().locator('.ticket').textContent(), /BKK10:40.*CNX11:55.*Your booking/);
  const v = (await client.callTool({ name: 'open_planner', arguments: { trip_id: t.trip.id } })).structuredContent;
  assert.equal(v.legs.find((l) => l.key === leg.key).booked, true);
  await page.close();
});
