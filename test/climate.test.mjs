// Weather by month: the server averages Open-Meteo's daily history by month, adds the sea for coasts, and keeps
// the answer so a country is looked up once. Open-Meteo here is the stand-in from fake-openmeteo.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, connect, openMeteo } from './helpers.mjs';
import { monthly, monthlySea, _clearClimateCache } from '../src/climate.mjs';

let srv, client;
before(async () => { srv = await startServer(); client = await connect(srv.url); });
after(async () => { await client.close(); srv.server.close(); });

test('daily values become monthly averages, rain as a total per average month', () => {
  const daily = { time: ['2020-01-01', '2020-01-02', '2021-01-01', '2021-07-01'], temperature_2m_max: [10, 12, 14, 30], temperature_2m_min: [0, 2, 4, 20],
    precipitation_sum: [5, 0, 3, 0.4], sunshine_duration: [3600 * 4, 3600 * 6, 3600 * 5, 3600 * 12] };
  const m = monthly(daily, 2);
  assert.deepEqual(m[0], { hi: 12, lo: 2, rain: 4, wet: 1, sun: 5 });
  assert.deepEqual(m[6], { hi: 30, lo: 20, rain: 0, wet: 0, sun: 12 });
  assert.equal(m[3], null);
  assert.deepEqual(monthlySea({ time: ['2020-08-01T00:00', '2020-08-01T12:00'], sea_surface_temperature: [27, 28] }).slice(7, 8), [27.5]);
  assert.equal(monthlySea({ time: ['2020-08-01T00:00'], sea_surface_temperature: [null] }), null, 'inland: no sea');
});

test('country_weather: twelve months, the sea for a beach country, and asked of Open-Meteo once', async () => {
  _clearClimateCache();
  const before = openMeteo.calls.length;
  const r = await client.callTool({ name: 'country_weather', arguments: { country: 'Thailand' } });
  assert.ok(!r.isError, r.content[0].text);
  const c = r.structuredContent.climate;
  assert.equal(c.months.length, 12);
  assert.ok(c.months[3].hi > c.months[0].hi, 'April is hotter than January in Bangkok');
  assert.ok(c.months[7].rain > c.months[0].rain * 5, 'the wet season');
  assert.equal(typeof c.months[3].sea, 'number');
  assert.match(r.content[0].text, /^Weather by month, Thailand near BKK\. Averages \d{4}–\d{4}.*Jan \d+ to \d+°C, \d+ mm rain on \d+ days, [\d.]+ h sun a day, sea \d+°C;.*Warmest \w{3}, driest \w{3}, sunniest \w{3}\.$/);
  const asked = openMeteo.calls.slice(before);
  assert.deepEqual(asked.map((x) => x.path).sort(), ['/v1/archive', '/v1/marine']);
  assert.match(asked.find((x) => x.path === '/v1/archive').query.daily, /sunshine_duration/);
  await client.callTool({ name: 'country_weather', arguments: { country: 'Thailand' } });
  _clearClimateCache();   // memory gone, as after a restart: the database still has it
  await client.callTool({ name: 'country_weather', arguments: { country: 'thailand' } });
  assert.equal(openMeteo.calls.length, before + 2, 'kept, in memory and in the database');
});

test('country_weather: an inland place has no sea, an area goes by its airport, and bad input is refused', async () => {
  const sw = (await client.callTool({ name: 'country_weather', arguments: { country: 'Japan', airport: 'cts' } })).structuredContent;
  assert.equal(sw.place, 'Sapporo');
  assert.ok(sw.climate.months[0].hi < 5, 'Sapporo winters are cold');
  assert.ok(sw.climate.months.every((m) => m.sea === null), 'Japan has no beach tag: the sea is not looked up');
  assert.match((await client.callTool({ name: 'country_weather', arguments: { country: 'Atlantis' } })).content[0].text, /Atlantis/);
  assert.match((await client.callTool({ name: 'country_weather', arguments: { country: 'Japan', airport: 'QQQ' } })).content[0].text, /No airport with the code QQQ/);
});
