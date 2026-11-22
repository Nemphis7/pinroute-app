// Starts the server in-process on a free port with a throwaway database, and connects an MCP client to it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'pinroute-'));
process.env.FLIGHT_PROVIDER ||= 'demo';

const { createApp } = await import('../src/server.mjs');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

export async function startServer(extraRoutes, env = {}) {
  const { app, path } = createApp({ ...process.env, HOST: '127.0.0.1', ...env });
  if (extraRoutes) extraRoutes(app);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, url: `${base}${path}` };
}

export async function connect(url, token) {
  const client = new Client({ name: 'pinroute-test', version: '1.0.0' });
  const requestInit = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit }));
  return client;
}

// One raw JSON-RPC POST, to see HTTP statuses and headers the MCP client hides
export async function rpc(url, method, params = {}, token) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { status: r.status, headers: r.headers, text: await r.text() };
}

export const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
// Dates are relative to today, so searches never ask for a day that has passed
export const START = addDays(new Date().toISOString().slice(0, 10), 60);
export const LAST_DAY = addDays(START, 14);                 // Ao Nang → Bangkok, and the flight home
export const KBV_BKK = `leg|KBV|BKK|${LAST_DAY}`;
export const shortDay = (iso) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

// The route from Pinroute's Plan B, without anything personal in it
export const THAILAND_TRIP = {
  name: 'Thailand island hop', start: START, adults: 2, home_airport: 'FRA',
  stops: [
    { place: 'Bangkok', nights: 1 }, { place: 'Khao Sok', nights: 1 }, { place: 'Khao Lak', nights: 2 },
    { place: 'Koh Yao Noi', nights: 2 }, { place: 'Koh Phi Phi', nights: 3 }, { place: 'Koh Lanta', nights: 3 },
    { place: 'Ao Nang', nights: 2 }, { place: 'Bangkok', nights: 0 },
  ],
};
