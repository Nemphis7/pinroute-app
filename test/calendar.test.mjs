// A trip in the traveller's own calendar: the .ics events, the secret subscription link and the planner's dialog.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect, THAILAND_TRIP, KBV_BKK, START, LAST_DAY, addDays } from './helpers.mjs';
import { tripCalendar, timesIn, calendarLinks } from '../src/calendar.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }

let srv, client, tripId, browser, hostJs;
const call = async (name, args = {}) => client.callTool({ name, arguments: args });
const local = (url) => url.replace('https://pinroute.example', srv.base);
const unfold = (s) => s.replace(/\r\n /g, '');
const events = (ics) => unfold(ics).split('BEGIN:VEVENT').slice(1).map((e) => Object.fromEntries(e.split('\r\n').filter((l) => l.includes(':')).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)])));

before(async () => {
  srv = await startServer((app) => {
    if (!chromium) return;
    app.get('/__host', (req, res) => res.type('html').send('<!doctype html><meta charset="utf-8"><body style="margin:0"><script src="/__host.js"></script>'));
    app.get('/__host.js', (req, res) => res.type('js').send(hostJs));
  }, { PUBLIC_URL: 'https://pinroute.example' });
  client = await connect(srv.url);
  tripId = (await call('create_trip', THAILAND_TRIP)).structuredContent.trip.id;
  await call('choose_flight', { trip_id: tripId, leg_key: KBV_BKK, summary: 'FD 3214, 18:05 KBV → 19:30 BKK', price: 120, currency: 'EUR', link: 'https://airasia.example/b' });
  await call('mark_leg', { trip_id: tripId, leg_key: KBV_BKK, booked: true, note: 'Ref ABC123' });
  const lanta = addDays(START, 9);
  await call('save_local_picks', { place: 'Koh Lanta', picks: [
    { name: 'Four island snorkel', kind: 'activity', why: 'A day on the boat', source_url: 'https://example.com/a', book_url: 'https://gyg.example/t', date: lanta, time: '09:00–16:00' },
    { name: 'Mango sticky rice stall', kind: 'food', why: 'Best on the island', source_url: 'https://example.com/b' },
  ] });
});
after(async () => { await browser?.close(); await client?.close(); srv?.server.close(); });

test('times are read from flight lines and notes', () => {
  assert.deepEqual(timesIn('Qatar Airways QR 70, 21:10 FRA → 13:40 SGN'), { dep: [21, 10], arr: [13, 40], plus: null });
  assert.deepEqual(timesIn('09:30-11:05 (+1)'), { dep: [9, 30], arr: [11, 5], plus: 1 });
  assert.deepEqual(timesIn('ferry leaves 08.30'), { dep: [8, 30], arr: null, plus: null });
  assert.equal(timesIn('Thai Airways, FRA → BKK'), null);
});

test('calendar_link gives Apple, Google and file links, and the calendar has every stop, leg and dated activity', async () => {
  const r = await call('calendar_link', { trip_id: tripId });
  const { links } = r.structuredContent;
  assert.match(links.ics, /^https:\/\/pinroute\.example\/calendar\/[\w-]{20,}\.ics$/);
  assert.equal(links.webcal, links.ics.replace('https:', 'webcal:'));
  assert.equal(links.google, `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(links.webcal)}`);
  assert.match(r.content[0].text, /Apple Calendar.*\n.*Google Calendar/);
  assert.deepEqual((await call('calendar_link', { trip_id: tripId })).structuredContent.links, links, 'the link stays the same');

  const res = await fetch(local(links.ics));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/calendar/);
  const ics = await res.text();
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'lines are folded');
  const ev = events(ics);
  const stays = ev.filter((e) => e.SUMMARY.startsWith('📍'));
  assert.equal(stays.length, 7, 'one per stop with nights');
  assert.equal(stays[0]['DTSTART;VALUE=DATE'], START.replace(/-/g, ''));
  assert.equal(stays[0]['DTEND;VALUE=DATE'], addDays(START, 1).replace(/-/g, ''));
  const kbv = ev.find((e) => e.SUMMARY.includes('KBV → BKK'));
  assert.equal(kbv.DTSTART, `${LAST_DAY.replace(/-/g, '')}T180500`);
  assert.equal(kbv.DTEND, `${LAST_DAY.replace(/-/g, '')}T193000`);
  assert.match(kbv.DESCRIPTION, /Booked: Ref ABC123/);
  assert.equal(kbv.URL, 'https://airasia.example/b');
  assert.ok(ev.some((e) => e.SUMMARY.startsWith('⛴️ Ferry')), 'ferries');
  assert.ok(ev.some((e) => e.SUMMARY === '✈️ Flight FRA → BKK' && e['DTSTART;VALUE=DATE']), 'a flight with no times is all day');
  const snorkel = ev.find((e) => e.SUMMARY === '🎟️ Four island snorkel');
  assert.equal(snorkel.DTSTART, `${addDays(START, 9).replace(/-/g, '')}T090000`);
  assert.equal(snorkel.URL, 'https://gyg.example/t');
  assert.ok(!ev.some((e) => e.SUMMARY.includes('Mango')), 'undated picks are not events');
  assert.match(stays.find((e) => e.SUMMARY.includes('Koh Lanta')).DESCRIPTION, /Mango sticky rice stall/);
  assert.equal(new Set(ev.map((e) => e.UID)).size, ev.length, 'every event has its own UID');
});

test('the subscribed calendar follows changes, and a new link or "stop" ends the old one', async () => {
  const { links } = (await call('calendar_link', { trip_id: tripId })).structuredContent;
  await call('set_nights', { trip_id: tripId, stop: 0, nights: 2 });
  const ev = events(await (await fetch(local(links.ics))).text());
  assert.equal(ev.find((e) => e.SUMMARY === '📍 Bangkok')['DTEND;VALUE=DATE'], addDays(START, 2).replace(/-/g, ''));
  await call('set_nights', { trip_id: tripId, stop: 0, nights: 1 });

  const fresh = (await call('calendar_link', { trip_id: tripId, action: 'new' })).structuredContent.links;
  assert.notEqual(fresh.ics, links.ics);
  assert.equal((await fetch(local(links.ics))).status, 404);
  assert.equal((await fetch(local(fresh.ics))).status, 200);
  await call('calendar_link', { trip_id: tripId, action: 'stop' });
  assert.equal((await fetch(local(fresh.ics))).status, 404);
  assert.equal((await fetch(`${srv.base}/calendar/not-a-token.ics`)).status, 404);
});

test('hotels saved for a stop name its event', () => {
  const trip = { id: 'trp_x', name: 'Test', start: '2027-03-01', adults: 2, home: null, stops: [{ place: 'Hoi An', nights: 3, iata: 'DAD', lat: 15.88, lon: 108.33 }],
    stays: { 'stay|Hoi An|2027-03-01|2027-03-04': { name: 'Anantara Hoi An', price: 420, currency: 'EUR', booked: true, link: 'https://booking.example/h' } } };
  const [e] = events(tripCalendar(trip));
  assert.equal(e.SUMMARY, '📍 Hoi An · Anantara Hoi An');
  assert.match(e.LOCATION, /^Anantara Hoi An\\, Hoi An\\, Vietnam$/);
  assert.match(e.DESCRIPTION, /Hotel: Anantara Hoi An\\, EUR 420 \(booked\)/);
  assert.equal(e.URL, 'https://booking.example/h');
});

test('without a public address there is no link', () => {
  assert.equal(calendarLinks('abcdefghijklmnopqrstuv', {}), null);
  assert.match(calendarLinks('abcdefghijklmnopqrstuv', { RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' }).ics, /^https:\/\/x\.up\.railway\.app\/calendar\//);
});

test('the planner adds a trip to Apple or Google Calendar', { skip: !chromium && 'Playwright not installed' }, async () => {
  hostJs = (await build({ entryPoints: [new URL('./host/host.js', import.meta.url).pathname], bundle: true, format: 'iife', platform: 'browser', write: false })).outputFiles[0].text;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${srv.base}/__host`);
  await page.evaluate(([u, a]) => window.startHost(u, a, 'light', { inline: [760, 420], full: [1100, 900], tool: 'open_planner' }), [srv.url, { trip_id: tripId }]);
  const f = page.frameLocator('#planner');
  await f.locator('#app[data-screen]').waitFor();
  await f.getByRole('button', { name: /^Open (planner|Pinroute)$/ }).click();
  await f.locator('#app[data-layout="app"]').waitFor();
  await f.locator('#trip-cal').click();
  const dlg = f.getByRole('dialog', { name: 'Add to your calendar' });
  await dlg.locator('#cal-apple').waitFor();
  const links = (await call('calendar_link', { trip_id: tripId })).structuredContent.links;
  assert.equal(await dlg.locator('#cal-url').inputValue(), links.ics);
  await dlg.locator('#cal-apple').click();
  await dlg.locator('#cal-google').click();
  await page.waitForFunction(() => window.__links.length >= 2);
  assert.deepEqual(await page.evaluate(() => window.__links.slice(-2)), [links.webcal, links.google]);
  await dlg.getByRole('button', { name: 'Done' }).click();
  await dlg.waitFor({ state: 'detached' });
  await page.close();
});
