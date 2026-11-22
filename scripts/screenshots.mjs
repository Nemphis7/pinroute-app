// Makes the Claude directory listing images from the real planner: 4 carousel screenshots (PNG, 2× scale, cropped to
// the app) and the icon as PNG. Sample trip; the Koh Lanta picks are real ones from Reddit, Instagram and travel
// guides. Needs Playwright with Chromium. Run: npm run screenshots   → listing/
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'pinroute-shots-'));
process.env.FLIGHT_PROVIDER = 'amadeus';             // labels read as on the live server; no search is made
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
app.get('/__host', (req, res) => res.type('html').send('<!doctype html><meta charset="utf-8"><body style="margin:0"><script src="/__host.js"></script>'));
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
  { name: 'Three Sisters', kind: 'food', why: 'One of the best Thai meals for under ฿200; Reddit’s favourite Penang curry. Arrive early.', source_url: `${R}17b7cyo/five_days_in_koh_lanta` },
  { name: 'Mu Ko Lanta National Park', kind: 'view', area: 'Southern tip', why: 'Lighthouse headland, a 1.7 km forest trail and a beach with lifeguards. Opens 08:30.', source_url: 'https://www.visitthailandtoday.com/guides/things-to-do-in-koh-lanta' },
] });
const legs = Object.fromEntries((await call('open_planner', { trip_id: trip.id })).legs.map((l) => [`${l.from}-${l.to}-${l.mode}`, l.key]));
await call('choose_flight', { trip_id: trip.id, leg_key: legs['FRA-BKK-flight'], summary: 'Thai Airways, 13:30 FRA → 06:15 BKK', price: 1384, currency: 'EUR', source: 'Amadeus Travel Builder' });
await call('mark_leg', { trip_id: trip.id, leg_key: legs['FRA-BKK-flight'], booked: true });
await call('choose_flight', { trip_id: trip.id, leg_key: legs['KBV-BKK-flight'], summary: 'Thai AirAsia, 11:40 KBV → 12:55 DMK', price: 138, currency: 'EUR', source: 'LetsFG' });
const ferries = Object.keys(legs).filter((k) => /-(ferry|road)$/.test(k));
for (const k of ferries.slice(0, 2)) await call('mark_leg', { trip_id: trip.id, leg_key: legs[k], booked: true });

// ---- the planner in a stand-in host, as Claude shows it: the card inline, the planner full screen
const browser = await chromium.launch();
async function open(theme) {
  const page = await browser.newPage({ viewport: { width: 1160, height: 1000 }, deviceScaleFactor: 2, colorScheme: theme });
  await page.goto(`${base}/__host`);
  await page.evaluate(([u, id, t, bg]) => { document.body.style.background = bg; return window.startHost(u, { trip_id: id }, t, { inline: [760, 400], full: [1100, 720] }); }, [`${base}${path}`, trip.id, theme, BG[theme]]);
  const frame = page.frameLocator('#planner');
  await frame.locator('#strip .seg').first().waitFor();
  return { page, frame };
}
const shot = async (page, file) => { await page.waitForTimeout(300); await page.locator('#planner').screenshot({ path: join(OUT, file) }); console.log(`listing/${file}`); };

const light = await open('light');
// The card, cropped to its content
const cardH = await light.frame.locator('#app').evaluate((el) => Math.ceil(el.getBoundingClientRect().height));
await light.page.evaluate((h) => { document.getElementById('planner').style.height = `${h}px`; }, cardH);
await shot(light.page, '3-card.png');
await light.frame.getByRole('button', { name: 'Open planner' }).click();
await light.frame.locator('#app[data-layout="app"]').waitFor();
await light.frame.locator('.row.stop', { hasText: 'Koh Lanta' }).click();
await shot(light.page, '1-planner.png');
await light.frame.locator(`.row[data-leg="${legs['KBV-BKK-flight']}"]`).click();
await shot(light.page, '2-flight.png');
const dark = await open('dark');
await dark.frame.getByRole('button', { name: 'Open planner' }).click();
await dark.frame.locator('#app[data-layout="app"]').waitFor();
await dark.frame.locator(`.row[data-leg="${legs['KBV-KBV-ferry']}"]`).click();
await shot(dark.page, '4-ferry-dark.png');

// ---- icon: 512 and 1024 px
for (const [scale, file] of [[1, 'icon-512.png'], [2, 'icon-1024.png']]) {
  const ip = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: scale });
  await ip.setContent(`<body style="margin:0;background:transparent">${ICON_SVG.replace('<svg ', '<svg width="512" height="512" ')}</body>`);
  await ip.screenshot({ path: join(OUT, file), omitBackground: true, clip: { x: 0, y: 0, width: 512, height: 512 } });
}
writeFileSync(join(OUT, 'icon.svg'), ICON_SVG);
console.log('listing/icon-512.png, listing/icon-1024.png, listing/icon.svg');

await browser.close(); await client.close(); server.close();
