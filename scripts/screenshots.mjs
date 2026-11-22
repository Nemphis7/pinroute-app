// Makes the Claude directory listing images from the real planner: 4 carousel screenshots (PNG, 1520 px wide,
// cropped to the app) and the icon as PNG. Sample trip; the Koh Lanta picks are real ones from Reddit, Instagram
// and travel guides. Needs Playwright with Chromium. Run: npm run screenshots   → listing/
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'pinroute-shots-'));
process.env.FLIGHT_PROVIDER = 'amadeus';             // the badge reads as on the live server; no search is made
process.env.AMADEUS_API_KEY = 'not-used-for-screenshots';
const { chromium } = createRequire(import.meta.url)('playwright');
const { createApp } = await import('../src/server.mjs');
const { ICON_SVG } = await import('../src/pages.mjs');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

const OUT = new URL('../listing/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BG = { light: '#faf9f5', dark: '#262624' };

const hostJs = (await build({ entryPoints: [new URL('../test/host/host.js', import.meta.url).pathname], bundle: true, format: 'iife', platform: 'browser', write: false })).outputFiles[0].text;
const { app, path } = createApp({ ...process.env, HOST: '127.0.0.1' });
app.get('/__host', (req, res) => res.type('html').send('<!doctype html><meta charset="utf-8"><body style="margin:0;padding:24px"><script src="/__host.js"></script>'));
app.get('/__host.js', (req, res) => res.type('js').send(hostJs));
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const client = new Client({ name: 'screenshots', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${path}`)));
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); if (r.isError) throw new Error(r.content[0].text); return r.structuredContent; };

// ---- the sample trip
const trip = (await call('create_trip', {
  name: 'Thailand island hop', start: '2027-02-04', adults: 2, home_airport: 'FRA',
  stops: [{ place: 'Bangkok', nights: 1 }, { place: 'Khao Sok', nights: 1 }, { place: 'Khao Lak', nights: 2 }, { place: 'Koh Yao Noi', nights: 2 },
    { place: 'Koh Phi Phi', nights: 3 }, { place: 'Koh Lanta', nights: 3 }, { place: 'Ao Nang', nights: 2 }, { place: 'Bangkok', nights: 0 }],
})).trip;
const R = 'https://www.reddit.com/r/ThailandTourism/comments/';
await call('save_local_picks', { place: 'Koh Lanta', picks: [
  { name: 'Kantiang Bay', kind: 'beach', area: 'South', why: 'About a kilometre of sand between jungle hills, calm even in windy weather; snorkel at the south end.', source_url: `${R}1qhzv4w/which_beaches_in_koh_lanta_are_goodbest_for/` },
  { name: 'Lanta Old Town', kind: 'activity', area: 'East coast', why: 'Century-old stilt-house trading port; seafood lunch over the water.', source_url: 'https://www.instagram.com/p/C5TUVsmRpQ7/' },
  { name: 'Three Sisters', kind: 'food', why: 'One of the best Thai meals for under ฿200; Reddit\'s favourite Penang curry. Arrive early.', source_url: `${R}17b7cyo/five_days_in_koh_lanta` },
  { name: 'Mu Ko Lanta National Park', kind: 'view', area: 'Southern tip', why: 'Lighthouse headland, a 1.7 km forest trail and a beach with lifeguards. Opens 08:30.', source_url: 'https://www.visitthailandtoday.com/guides/things-to-do-in-koh-lanta' },
  { name: 'Sabai Sabai Viewpoint & Lounge', kind: 'drink', why: 'Hillside sunset drinks with two resident dogs; be there before sunset.', source_url: 'https://www.instagram.com/reel/C9XRpChsq9M/' },
] });
const legs = Object.fromEntries((await call('open_planner', { trip_id: trip.id })).legs.map((l) => [`${l.from}-${l.to}`, l.key]));
await call('choose_flight', { trip_id: trip.id, leg_key: legs['FRA-BKK'], summary: 'Thai Airways, direct, 13:30 FRA → 06:15 BKK', price: 1384, currency: 'EUR', source: 'Amadeus Travel Builder' });
await call('choose_flight', { trip_id: trip.id, leg_key: legs['KBV-BKK'], summary: 'Thai AirAsia, 11:40 KBV → 12:55 DMK', price: 138, currency: 'EUR', source: 'LetsFG' });

// ---- the planner in a stand-in host, as Claude shows it inline
const browser = await chromium.launch();
async function open(theme) {
  const page = await browser.newPage({ viewport: { width: 820, height: 2600 }, deviceScaleFactor: 2, colorScheme: theme });
  await page.goto(`${base}/__host`);
  await page.evaluate(([u, id, t, bg]) => { document.body.style.background = bg; return window.startHost(u, { trip_id: id }, t); }, [`${base}${path}`, trip.id, theme, BG[theme]]);
  const frame = page.frameLocator('#planner');
  await frame.locator('.stop').nth(7).waitFor();
  await frame.locator('li.stop', { hasText: 'Koh Lanta' }).getByText('Kantiang Bay').waitFor();
  const h = await frame.locator('#app').evaluate((el) => el.getBoundingClientRect().height + 24);
  await page.evaluate((hh) => { document.getElementById('planner').style.height = `${hh}px`; }, h);
  return { page, frame };
}
// The part of the planner from one element to another, with a margin, cropped to the planner's width
async function shot(page, first, last, file) {
  const ifr = await page.locator('#planner').boundingBox();
  const a = await first.boundingBox(), b = await last.boundingBox();
  const top = Math.max(ifr.y, a.y - 6), bottom = b.y + b.height + 6;
  await page.screenshot({ path: join(OUT, file), clip: { x: ifr.x, y: top, width: ifr.width, height: bottom - top } });
  console.log(`listing/${file}`);
}

const stop = (f, i) => f.locator('li.stop').nth(i);
const light = await open('light');
await shot(light.page, light.frame.locator('header.top'), stop(light.frame, 2), '1-route.png');
await shot(light.page, stop(light.frame, 5), stop(light.frame, 5), '2-local-picks.png');
await shot(light.page, stop(light.frame, 6), light.frame.locator('li.leg[data-leg^="home|"]'), '3-flights.png');
const dark = await open('dark');
await shot(dark.page, dark.frame.locator('header.top'), stop(dark.frame, 3), '4-route-dark.png');

// ---- icon: 512 and 1024 px
const ip = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await ip.setContent(`<body style="margin:0;background:transparent">${ICON_SVG.replace('<svg ', '<svg width="512" height="512" ')}</body>`);
await ip.screenshot({ path: join(OUT, 'icon-512.png'), omitBackground: true, clip: { x: 0, y: 0, width: 512, height: 512 } });
const ip2 = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 2 });
await ip2.setContent(`<body style="margin:0;background:transparent">${ICON_SVG.replace('<svg ', '<svg width="512" height="512" ')}</body>`);
await ip2.screenshot({ path: join(OUT, 'icon-1024.png'), omitBackground: true, clip: { x: 0, y: 0, width: 512, height: 512 } });
writeFileSync(join(OUT, 'icon.svg'), ICON_SVG);
console.log('listing/icon-512.png, listing/icon-1024.png, listing/icon.svg');

await browser.close(); await client.close(); server.close();
