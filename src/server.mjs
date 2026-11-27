// HTTP entry point: Streamable HTTP, stateless (every POST gets a fresh server), as in Claude's MCP Apps quickstart.
// With AUTH_ISSUER set, people sign in (OAuth) and each one gets their own trips; tool calls that need an account are
// answered with 401 before the MCP SDK runs, which makes Claude show its Connect card and retry after sign-in.
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { pathToFileURL } from 'node:url';
import { buildServer, VERSION } from './app.mjs';
import { loadDotEnv } from './env.mjs';
import { flightProvider } from './providers/index.mjs';
import { linksOn as bookingLinksOn } from './hotels.mjs';
import { authConfig, resourceMetadata, challenge, bearer, verifyToken, needsSignIn } from './auth.mjs';
import { helpPage, privacyPage, ICON_SVG } from './pages.mjs';
import { LOCAL, tripByCalendar, getPicks } from './store.mjs';
import { tripCalendar, TOKEN } from './calendar.mjs';
import { schedule } from './trips.mjs';

// On Railway (it sets RAILWAY_PROJECT_ID) the server listens on all interfaces and accepts its public domain by itself
const onRailway = (env) => !!(env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_NAME);
export const defaultHost = (env = process.env) => env.HOST || (onRailway(env) ? '0.0.0.0' : '127.0.0.1');

const rpcError = (message, code = -32000) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

export function createApp(env = process.env) {
  const host = defaultHost(env);
  const local = host === '127.0.0.1' || host === 'localhost';
  const auth = authConfig(env);
  // Local: DNS-rebinding protection on. Hosted: only requests addressed to the public host name(s) are answered.
  const named = env.PUBLIC_URL ? [new URL(env.PUBLIC_URL).hostname] : [];
  const allowed = [...new Set([...(env.ALLOWED_HOSTS || env.RAILWAY_PUBLIC_DOMAIN || '').split(','), ...named].map((s) => s.trim()).filter(Boolean))];
  const app = createMcpExpressApp(local ? { host } : { host, ...(allowed.length ? { allowedHosts: allowed } : {}) });
  // With sign-in, the address is /mcp for everyone. Without it, a long random MCP_SECRET in the path keeps strangers
  // out: the URL itself is the password.
  const path = !auth && env.MCP_SECRET ? `/mcp/${env.MCP_SECRET}` : '/mcp';

  const unauthorized = (res, why) => res.status(401).set('WWW-Authenticate', challenge(auth, why)).json({ error: 'invalid_token', error_description: why || 'Sign in to Pinroute to use this tool' });

  app.post(path, async (req, res) => {
    try {
      let owner = auth ? null : LOCAL;               // null: not signed in, only the open tools work
      if (auth) {
        const token = bearer(req);
        if (token) {
          try { owner = (await verifyToken(auth, token)).sub; } catch (e) {
            if (e.invalid) return unauthorized(res, 'Your Pinroute sign-in has expired or is not valid');
            console.error('Sign-in check failed:', e.message);
            return res.status(503).json(rpcError('Pinroute cannot check sign-ins right now. Try again in a minute.'));
          }
        }
        if (!owner && needsSignIn(req.body)) return unauthorized(res);
      }
      const server = buildServer({ owner, env });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('MCP request failed:', e.message);       // never the body: it can hold someone's trip
      if (!res.headersSent) res.status(500).json(rpcError('Pinroute had an internal error. Try again.', -32603));
    }
  });
  const notAllowed = (req, res) => res.status(405).json(rpcError('Method not allowed.'));
  app.get(path, notAllowed);
  app.delete(path, notAllowed);

  // RFC 9728: where Claude learns which sign-in service issues tokens for this server
  if (auth) {
    const prm = (req, res) => res.set('Access-Control-Allow-Origin', '*').json(resourceMetadata(auth));
    app.get('/.well-known/oauth-protected-resource', prm);
    app.get('/.well-known/oauth-protected-resource/mcp', prm);
  }

  // A trip's calendar, for the calendar apps subscribed to it. The secret token in the address is the key, as with
  // a private calendar address in Google Calendar: calendar apps can't sign in. calendar_link makes, renews or stops it.
  app.get('/calendar/:file', (req, res) => {
    const m = /^(.+)\.ics$/.exec(req.params.file);
    const found = m && TOKEN.test(m[1]) ? tripByCalendar(m[1]) : null;
    if (!found) return res.status(404).type('text').send('No calendar at this address. The link may have been renewed or switched off in Pinroute.');
    const { owner, trip } = found;
    const picks = Object.fromEntries(schedule(trip).map((s) => [s.place, getPicks(owner, s.place)]));
    const name = String(trip.name).replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-') || 'trip';
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `inline; filename="${name}.ics"`, 'Cache-Control': 'private, max-age=300', 'X-Robots-Tag': 'noindex' }).send(tripCalendar(trip, picks));
  });

  // Public pages for people and for the directory listing
  app.get('/help', (req, res) => res.type('html').send(helpPage(env)));
  app.get('/privacy', (req, res) => res.type('html').send(privacyPage(env)));
  app.get('/icon.svg', (req, res) => res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(ICON_SVG));

  // A status page to check a deployment from a phone: says whether live fares and sign-in are on, never shows a key
  app.get('/', (req, res) => {
    const p = flightProvider(env);
    const site = `https://${req.headers.host || '<this domain>'}`;
    res.type('text').send([
      `Pinroute MCP server ${VERSION} is running.`,
      `Flights: ${p.name}${p.name === 'Demo data' ? ' (AMADEUS_API_KEY is not set)' : ''}.`,
      `Recent prices (Aviasales via Travelpayouts): ${env.TRAVELPAYOUTS_TOKEN ? 'on' : 'off (TRAVELPAYOUTS_TOKEN is not set)'}. Partner links: ${env.TRAVELPAYOUTS_MARKER ? `on${env.TRAVELPAYOUTS_TRS ? '' : ' (marker only; TRAVELPAYOUTS_TRS is not set)'}` : 'off (TRAVELPAYOUTS_MARKER is not set)'}.`,
      `Hotels (Booking.com links): partner links ${bookingLinksOn(env) ? 'on' : 'off (BOOKING_LINK_TEMPLATE or BOOKING_AID is not set)'}.`,
      `Sign-in: ${auth ? `on, through ${auth.issuer}` : env.MCP_SECRET ? 'off; the address is protected by MCP_SECRET' : 'off'}.`,
      `Address for Claude: ${site}${auth || !env.MCP_SECRET ? '/mcp' : '/mcp/<your MCP_SECRET>'}`,
      `Help: ${site}/help · Privacy: ${site}/privacy`,
    ].join('\n'));
  });
  return { app, path, auth };
}

export function start({ port = Number(process.env.PORT ?? 3000), host = defaultHost(process.env) } = {}) {
  const { app, path, auth } = createApp({ ...process.env, HOST: host });
  return new Promise((resolve, reject) => {
    const srv = app.listen(port, host, (err) => {
      if (err) return reject(err);
      const base = `http://${host === '0.0.0.0' ? 'localhost' : host}:${srv.address().port}`;
      resolve({ server: srv, url: `${base}${path}`, shown: `${base}${path === '/mcp' ? '/mcp' : '/mcp/<MCP_SECRET>'}`, auth });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  loadDotEnv();
  // The log shows the address without the secret: logs are read in more places than the settings
  start().then(({ shown, auth }) => console.log(`Pinroute MCP server ${VERSION} on ${shown} (flights: ${flightProvider().name}; recent prices: ${process.env.TRAVELPAYOUTS_TOKEN ? 'on' : 'off'}; partner links: ${process.env.TRAVELPAYOUTS_MARKER ? 'on' : 'off'}; sign-in: ${auth ? 'on' : 'off'})`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
