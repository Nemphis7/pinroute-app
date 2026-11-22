// Sign-in. Pinroute is an OAuth resource server: a sign-in service (WorkOS AuthKit, or any OAuth server that issues
// JWT access tokens) signs people in, Claude sends their token with every request, and this file checks it.
// Nothing here is on until AUTH_ISSUER is set, so a server without sign-in keeps working as before.
import { createRemoteJWKSet, jwtVerify } from 'jose';

// The address people add in Claude. PUBLIC_URL wins; on Railway the generated domain is used.
export function publicUrl(env = process.env) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, '');
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${env.PORT || 3000}`;
}

export function authConfig(env = process.env) {
  const issuer = (env.AUTH_ISSUER || '').trim().replace(/\/+$/, '');
  if (!issuer) return null;
  const base = publicUrl(env);
  const resource = `${base}/mcp`;
  return {
    issuer,
    base,
    resource,
    audience: (env.AUTH_AUDIENCE || resource).split(',').map((s) => s.trim()).filter(Boolean),
    jwksUrl: env.AUTH_JWKS_URL || null,
    metadataUrl: `${base}/.well-known/oauth-protected-resource/mcp`,
  };
}

// Pinroute needs only to know who is signing in, not their email or profile: Claude asks for this scope alone
// (plus offline_access, which it adds itself for refresh tokens), so the consent screen stays short.
export const SCOPES = ['openid'];

// RFC 9728 protected resource metadata: tells Claude which sign-in service issues tokens for this server
export const resourceMetadata = (cfg) => ({
  resource: cfg.resource,
  authorization_servers: [cfg.issuer],
  scopes_supported: SCOPES,
  bearer_methods_supported: ['header'],
  resource_name: 'Pinroute',
  resource_documentation: `${cfg.base}/help`,
});

// The challenge that makes Claude show its Connect card, then retry the same call with a token
export const challenge = (cfg, why = 'Sign in to Pinroute to use this tool') =>
  `Bearer error="invalid_token", error_description="${why}", resource_metadata="${cfg.metadataUrl}", scope="${SCOPES.join(' ')}"`;

// Where the issuer publishes its signing keys: AUTH_JWKS_URL, or its RFC 8414 / OpenID discovery document
const keySets = new Map();
async function keysFor(cfg) {
  if (keySets.has(cfg.issuer)) return keySets.get(cfg.issuer);
  const found = (async () => {
    if (cfg.jwksUrl) return createRemoteJWKSet(new URL(cfg.jwksUrl));
    const u = new URL(cfg.issuer);
    const path = u.pathname === '/' ? '' : u.pathname;
    const docs = [`${u.origin}/.well-known/oauth-authorization-server${path}`, `${cfg.issuer}/.well-known/openid-configuration`];
    for (const doc of docs) {
      try {
        const r = await fetch(doc, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) continue;
        const m = await r.json();
        if (m.jwks_uri) return createRemoteJWKSet(new URL(m.jwks_uri), { timeoutDuration: 5000 });
      } catch { /* try the next one */ }
    }
    throw Object.assign(new Error(`Could not find the signing keys of ${cfg.issuer}. Set AUTH_JWKS_URL.`), { unavailable: true });
  })();
  keySets.set(cfg.issuer, found);
  found.catch(() => keySets.delete(cfg.issuer));         // try again on the next request
  return found;
}

export const bearer = (req) => {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return m ? m[1].trim() : null;
};

// Resolves to { sub } for a valid token. A bad or expired token rejects with { invalid: true } (answer 401, so
// Claude refreshes or signs in again); a sign-in service that can't be reached rejects with { unavailable: true }.
export async function verifyToken(cfg, token) {
  const keys = await keysFor(cfg);
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: [cfg.issuer, `${cfg.issuer}/`], audience: cfg.audience, clockTolerance: 30 });
    if (!payload.sub) throw Object.assign(new Error('The token names no user.'), { code: 'ERR_JWT_CLAIM_VALIDATION_FAILED' });
    return { sub: String(payload.sub) };
  } catch (e) {
    // Token problems (expired, wrong audience, bad signature, unknown key) versus key-fetch problems (timeout)
    const bad = /^ERR_(JWT_|JWS_|JOSE_ALG_NOT_ALLOWED|JOSE_NOT_SUPPORTED|JWKS_NO_MATCHING_KEY|JWKS_MULTIPLE_MATCHING_KEYS)/.test(e.code || '');
    throw Object.assign(new Error(e.message), bad ? { invalid: true } : { unavailable: true });
  }
}

// Which JSON-RPC messages need a signed-in person: every tool call except the open ones.
export const OPEN_TOOLS = new Set(['find_airports']);
export function needsSignIn(body) {
  for (const m of Array.isArray(body) ? body : [body]) {
    if (m && m.method === 'tools/call' && !OPEN_TOOLS.has(m.params?.name)) return true;
  }
  return false;
}
