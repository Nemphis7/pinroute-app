// Typing on a phone: Claude's composer and the keyboard cover the bottom of the planner, so a field the traveller taps
// moves to the top of its pane, the bottom tabs step aside, and the host's safe areas stay clear. Runs in the stand-in
// host; skipped where Playwright is missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { startServer, connect } from './helpers.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
const skip = !chromium && 'Playwright not installed';

let srv, client, browser, hostJs;
const SAFE = { top: 20, right: 0, bottom: 80, left: 0 };

async function openHost(full, context) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${srv.base}/__host`);
  await page.evaluate(([u, o]) => window.startHost(u, {}, 'light', o), [srv.url, { inline: [390, 420], full, context }]);
  const f = page.frameLocator('#planner');
  await f.locator('#app[data-screen]').waitFor();
  await f.getByRole('button', { name: 'Open Pinroute' }).click();
  await f.locator('#app[data-layout="app"] .home').waitFor();
  await f.getByRole('button', { name: /I know when/ }).click();
  await f.locator('#w-air').waitFor();
  return { page, f };
}
const until = async (check, ms = 2000) => { const end = Date.now() + ms; while (!(await check()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return check(); };

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

test('on a phone, full screen: the bar and the tabs stay clear of what the host keeps for itself', { skip }, async () => {
  const { page, f } = await openHost([390, 760], { platform: 'mobile', safeAreaInsets: SAFE });
  const bar = await f.locator('#bar').boundingBox();
  assert.ok(bar.y >= SAFE.top, 'the bar starts below the top safe area');
  const tabs = await f.locator('#tabs').boundingBox();
  const btn = await f.locator('#tabs .tab.bottom').first().boundingBox();
  assert.ok(tabs.y + tabs.height >= 755, 'the tabs reach the bottom');
  assert.ok(btn.y + btn.height <= 760 - SAFE.bottom, 'the tab buttons sit above the bottom safe area');
  await page.close();
});

test('on a phone: a tapped field moves to the top of its pane and the tabs step aside until typing ends', { skip }, async () => {
  const { page, f } = await openHost([390, 760], { platform: 'mobile', safeAreaInsets: SAFE });
  const field = f.locator('#w-air');
  // A field low on the screen, where the composer and the keyboard would be
  await f.locator('#body').evaluate((b) => { b.scrollTop = 0; });
  const before = await field.boundingBox();
  await field.evaluate((el) => el.focus({ preventScroll: true }));   // so only the planner moves it
  assert.equal(await f.locator('#app').getAttribute('data-typing'), 'true');
  assert.equal(await f.locator('#tabs').isHidden(), true, 'the tabs step aside while typing');
  const top = async () => (await field.boundingBox()).y - (await f.locator('#body').boundingBox()).y;
  assert.ok(await until(async () => (await top()) <= 40), `the field moves to the top of its pane (was ${before.y}, now ${await top()} below the pane's top)`);

  await field.fill('Munich');
  await f.getByRole('option', { name: /MUC/ }).waitFor();
  assert.ok((await top()) <= 40, 'typing keeps the field where it is');

  await field.blur();
  assert.ok(await until(async () => (await f.locator('#app').getAttribute('data-typing')) === null), 'typing ends with the focus');
  assert.equal(await f.locator('#tabs').isVisible(), true, 'the tabs come back');
  await page.close();
});

test('on a computer: focusing a field leaves the page where it is', { skip }, async () => {
  const { page, f } = await openHost([1100, 800]);
  await f.locator('#body').evaluate((b) => { b.scrollTop = 0; });
  await f.locator('#w-air').evaluate((el) => el.focus({ preventScroll: true }));   // only the planner could move it now
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(await f.locator('#app').getAttribute('data-typing'), null);
  assert.equal(await f.locator('#body').evaluate((b) => b.scrollTop), 0);
  await page.close();
});
