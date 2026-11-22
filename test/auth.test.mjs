// Sign-in, as Claude meets it: open tools work without a token, the others answer 401 with the pointer to the
// sign-in service, valid tokens get the person's own data, and bad tokens are refused. A stand-in sign-in service
// publishes its keys the way WorkOS AuthKit does (RFC 8414 metadata with jwks_uri).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { startServer, connect, rpc, THAILAND_TRIP, KBV_BKK } from './helpers.mjs';

const PUBLIC = 'https://pinroute.test';
const RESOURCE = `${PUBLIC}/mcp`;
let issuer, idp, srv, keys, otherKeys;

before(async () => {
  keys = await generateKeyPair('RS256');
  otherKeys = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  idp = createServer((req, res) => {
    const send = (o) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(o));
    if (req.url === '/.well-known/oauth-authorization-server') return send({ issuer, jwks_uri: `${issuer}/oauth2/jwks`, authorization_endpoint: `${issuer}/oauth2/authorize`, token_endpoint: `${issuer}/oauth2/token` });
    if (req.url === '/oauth2/jwks') return send({ keys: [jwk] });
    res.writeHead(404).end();
  });
  await new Promise((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${idp.address().port}`;
  srv = await startServer(null, { AUTH_ISSUER: issuer, PUBLIC_URL: PUBLIC, MCP_SECRET: 'ignored-when-sign-in-is-on' });
});
after(() => { srv?.server.close(); idp?.close(); });

const token = (sub, { aud = RESOURCE, iss = issuer, exp = '10m', key = keys.privateKey, kid = 'k1' } = {}) =>
  new SignJWT({ sid: 'session_1' }).setProtectedHeader({ alg: 'RS256', kid }).setIssuer(iss).setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime(exp).sign(key);

test('with sign-in on, the address is /mcp: the secret path is not used', () => {
  assert.match(srv.url, /\/mcp$/);
});

test('lists tools and finds airports without signing in', async () => {
  const list = await rpc(srv.url, 'tools/list');
  assert.equal(list.status, 200);
  assert.match(list.text, /open_planner/);
  const airports = await rpc(srv.url, 'tools/call', { name: 'find_airports', arguments: { query: 'krabi' } });
  assert.equal(airports.status, 200);
  assert.match(airports.text, /KBV/);
});

test('answers every other tool with 401 and points Claude to the sign-in service', async () => {
  for (const name of ['list_trips', 'create_trip', 'open_planner', 'search_flights', 'delete_my_data']) {
    const r = await rpc(srv.url, 'tools/call', { name, arguments: {} });
    assert.equal(r.status, 401, name);
    const h = r.headers.get('www-authenticate');
    assert.match(h, /^Bearer /);
    assert.match(h, new RegExp(`resource_metadata="${PUBLIC}/\\.well-known/oauth-protected-resource/mcp"`));
    assert.match(h, /scope="openid"/, 'asks for sign-in only: no email or profile');
    assert.equal(JSON.parse(r.text).error, 'invalid_token');
  }
});

test('publishes protected resource metadata at both well-known paths', async () => {
  for (const p of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
    const m = await (await fetch(`${srv.base}${p}`)).json();
    assert.equal(m.resource, RESOURCE);
    assert.deepEqual(m.authorization_servers, [issuer]);
    assert.deepEqual(m.bearer_methods_supported, ['header']);
    assert.deepEqual(m.scopes_supported, ['openid']);
  }
});

test('keeps each person\'s trips to themselves', async () => {
  const ana = await connect(srv.url, await token('user_ana'));
  const ben = await connect(srv.url, await token('user_ben'));
  const t = (await ana.callTool({ name: 'create_trip', arguments: THAILAND_TRIP })).structuredContent.trip;
  assert.equal((await ana.callTool({ name: 'list_trips', arguments: {} })).structuredContent.trips.length, 1);
  assert.equal((await ben.callTool({ name: 'list_trips', arguments: {} })).structuredContent.trips.length, 0);
  for (const [name, args] of [['open_planner', { trip_id: t.id }], ['delete_trip', { trip_id: t.id }], ['update_trip', { trip_id: t.id, adults: 4 }],
    ['choose_flight', { trip_id: t.id, leg_key: KBV_BKK, summary: 'x', price: 1, currency: 'EUR' }]]) {
    const r = await ben.callTool({ name, arguments: args });
    assert.equal(r.isError, true, `${name} on someone else's trip`);
  }
  await ana.callTool({ name: 'save_local_picks', arguments: { place: 'Koh Lanta', picks: [{ name: 'Time for Lime', kind: 'food', why: 'Cooking class.', source_url: 'https://example.com/a' }] } });
  assert.equal((await ben.callTool({ name: 'get_local_picks', arguments: { place: 'Koh Lanta' } })).structuredContent.picks.length, 0);
  // Ben deleting his data leaves Ana's alone
  await ben.callTool({ name: 'create_trip', arguments: { name: 'Ben', start: THAILAND_TRIP.start, adults: 1, stops: [{ place: 'Ao Nang', nights: 1 }] } });
  await ben.callTool({ name: 'delete_my_data', arguments: { confirm: true } });
  assert.equal((await ana.callTool({ name: 'list_trips', arguments: {} })).structuredContent.trips.length, 1);
  assert.equal((await ana.callTool({ name: 'open_planner', arguments: { trip_id: t.id } })).structuredContent.picks['Koh Lanta'].length, 1);
  await ana.close(); await ben.close();
});

test('refuses expired, foreign and mis-addressed tokens with 401, even for open calls', async () => {
  const bad = {
    expired: await token('user_ana', { exp: Math.floor(Date.now() / 1000) - 600 }),
    'another audience': await token('user_ana', { aud: 'https://somewhere.else/mcp' }),
    'another issuer': await token('user_ana', { iss: 'https://evil.example' }),
    'another key': await token('user_ana', { key: otherKeys.privateKey }),
    'unknown key id': await token('user_ana', { key: otherKeys.privateKey, kid: 'k9' }),
    garbage: 'not-a-jwt',
  };
  for (const [why, t] of Object.entries(bad)) {
    const r = await rpc(srv.url, 'tools/list', {}, t);
    assert.equal(r.status, 401, why);
    assert.match(r.headers.get('www-authenticate'), /expired or is not valid/);
  }
});

test('says so when the sign-in service cannot be reached, instead of asking to sign in again', async () => {
  const down = await startServer(null, { AUTH_ISSUER: 'http://127.0.0.1:9', PUBLIC_URL: PUBLIC });
  const r = await rpc(down.url, 'tools/list', {}, await token('user_ana'));
  assert.equal(r.status, 503);
  assert.match(r.text, /cannot check sign-ins/);
  down.server.close();
});

test('the status page says sign-in is on', async () => {
  const t = await (await fetch(`${srv.base}/`)).text();
  assert.match(t, new RegExp(`Sign-in: on, through ${issuer}`));
  assert.match(t, /Address for Claude: https:\/\/127\.0\.0\.1:\d+\/mcp\n/);
  assert.doesNotMatch(t, /ignored-when-sign-in-is-on/);
});
