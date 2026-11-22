// Starts the server in-process on a free port with a throwaway store, and connects an MCP client to it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), 'pinroute-')), 'store.json');
process.env.FLIGHT_PROVIDER ||= 'demo';

const { createApp } = await import('../src/server.mjs');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

export async function startServer(extraRoutes) {
  const { app, path } = createApp({ ...process.env, HOST: '127.0.0.1' });
  if (extraRoutes) extraRoutes(app);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, url: `${base}${path}` };
}

export async function connect(url) {
  const client = new Client({ name: 'pinroute-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

// The route from Pinroute's Plan B, without anything personal in it
export const THAILAND_TRIP = {
  name: 'Thailand island hop', start: '2026-11-14', adults: 2, home_airport: 'FRA',
  stops: [
    { place: 'Bangkok', nights: 1 }, { place: 'Khao Sok', nights: 1 }, { place: 'Khao Lak', nights: 2 },
    { place: 'Koh Yao Noi', nights: 2 }, { place: 'Koh Phi Phi', nights: 3 }, { place: 'Koh Lanta', nights: 3 },
    { place: 'Ao Nang', nights: 2 }, { place: 'Bangkok', nights: 0 },
  ],
};
