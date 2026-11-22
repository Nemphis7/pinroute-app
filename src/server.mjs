// HTTP entry point: Streamable HTTP, stateless (every POST gets a fresh server), as in Claude's MCP Apps quickstart.
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { pathToFileURL } from 'node:url';
import { buildServer } from './app.mjs';
import { loadDotEnv } from './env.mjs';
import { flightProvider } from './providers/index.mjs';

// On Railway (it sets RAILWAY_PROJECT_ID) the server listens on all interfaces and accepts its public domain by itself
const onRailway = (env) => !!(env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_NAME);
export const defaultHost = (env = process.env) => env.HOST || (onRailway(env) ? '0.0.0.0' : '127.0.0.1');

export function createApp(env = process.env) {
  const host = defaultHost(env);
  const local = host === '127.0.0.1' || host === 'localhost';
  // Local: DNS-rebinding protection on. Hosted: only requests addressed to the public host name(s) are answered.
  const allowed = (env.ALLOWED_HOSTS || env.RAILWAY_PUBLIC_DOMAIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const app = createMcpExpressApp(local ? { host } : { host, ...(allowed.length ? { allowedHosts: allowed } : {}) });
  // Until sign-in is added, a long random MCP_SECRET in the path keeps strangers out: the URL itself is the password.
  const path = env.MCP_SECRET ? `/mcp/${env.MCP_SECRET}` : '/mcp';

  app.post(path, async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const notAllowed = (req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  app.get(path, notAllowed);
  app.delete(path, notAllowed);
  // A status page to check a deployment from a phone: says whether live fares are on, never shows a key or the secret
  app.get('/', (req, res) => {
    const p = flightProvider(env);
    res.type('text').send([
      'Pinroute MCP server is running.',
      `Flights: ${p.name}${p.name === 'Demo data' ? ' (AMADEUS_API_KEY is not set)' : ''}.`,
      `Address for Claude: https://${req.headers.host || '<this domain>'}${env.MCP_SECRET ? '/mcp/<your MCP_SECRET>' : '/mcp'}`,
    ].join('\n'));
  });
  return { app, path };
}

export function start({ port = Number(process.env.PORT ?? 3000), host = defaultHost(process.env) } = {}) {
  const { app, path } = createApp({ ...process.env, HOST: host });
  return new Promise((resolve, reject) => {
    const srv = app.listen(port, host, (err) => {
      if (err) return reject(err);
      const base = `http://${host === '0.0.0.0' ? 'localhost' : host}:${srv.address().port}`;
      resolve({ server: srv, url: `${base}${path}`, shown: `${base}${process.env.MCP_SECRET ? '/mcp/<MCP_SECRET>' : '/mcp'}` });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  loadDotEnv();
  // The log shows the address without the secret: logs are read in more places than the settings
  start().then(({ shown }) => console.log(`Pinroute MCP server on ${shown} (flights: ${flightProvider().name})`)).catch((e) => { console.error(e.message); process.exit(1); });
}
