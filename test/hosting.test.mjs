// Hosting defaults on Railway: listens on all interfaces, answers only its public domain, keeps the secret out of
// the status page, and stores trips on the attached volume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, defaultHost } from '../src/server.mjs';

const RAILWAY = { RAILWAY_PROJECT_ID: 'p1', RAILWAY_PUBLIC_DOMAIN: 'pinroute-test.up.railway.app', MCP_SECRET: 's3cret-path', FLIGHT_PROVIDER: 'demo' };

function call(port, path, host, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = request({ host: '127.0.0.1', port, path, method: body ? 'POST' : 'GET',
      headers: { Host: host, ...(data && { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(data) }) } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('on Railway: all interfaces, its own domain only, secret kept off the status page', async () => {
  assert.equal(defaultHost(RAILWAY), '0.0.0.0');
  assert.equal(defaultHost({}), '127.0.0.1');
  const { app, path } = createApp(RAILWAY);
  assert.equal(path, '/mcp/s3cret-path');
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = srv.address().port;
  try {
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    const ok = await call(port, path, RAILWAY.RAILWAY_PUBLIC_DOMAIN, list);
    assert.equal(ok.status, 200);
    assert.match(ok.text, /open_planner/);
    const other = await call(port, path, 'someone-else.example', list);
    assert.equal(other.status, 403, 'requests for another host name are refused');
    const wrong = await call(port, '/mcp', RAILWAY.RAILWAY_PUBLIC_DOMAIN, list);
    assert.equal(wrong.status, 404, 'without the secret there is nothing to talk to');
    const home = await call(port, '/', RAILWAY.RAILWAY_PUBLIC_DOMAIN);
    assert.match(home.text, /Flights: Demo data \(AMADEUS_API_KEY is not set\)/);
    assert.match(home.text, /https:\/\/pinroute-test\.up\.railway\.app\/mcp\/<your MCP_SECRET>/);
    assert.doesNotMatch(home.text, /s3cret-path/);
  } finally { srv.close(); }
});

test('trips go to the attached volume', () => {
  const vol = mkdtempSync(join(tmpdir(), 'vol-'));
  const store = new URL('../src/store.mjs', import.meta.url).href;
  const env = { ...process.env, RAILWAY_VOLUME_MOUNT_PATH: vol };
  delete env.DATA_FILE;
  execFileSync(process.execPath, ['--input-type=module', '-e', `const s = await import(${JSON.stringify(store)}); s.putTrip({ id: 'trp_x', name: 'x', start: '2026-12-01', adults: 1, stops: [] });`], { env });
  assert.ok(existsSync(join(vol, 'store.json')));
});
