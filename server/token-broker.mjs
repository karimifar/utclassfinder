// UT SSO token broker.
//
// UT's Enterprise Authentication OP does not support public clients
// (token_endpoint_auth_method "none"), so the OAuth token exchange must be
// authenticated with a client secret — which a native app cannot hold.
// This service is the one place the secret lives: the app completes the
// authorization-code + PKCE flow in the system browser as usual, then POSTs
// the resulting {code, code_verifier} here instead of to UT directly. We
// attach the secret (client_secret_basic) and forward to UT's token endpoint.
//
// PKCE still binds every exchange to the app instance that started it; the
// broker adds client authentication, nothing more. It holds no state and
// never logs codes, tokens, or the secret.
//
// Run locally:
//   UT_OAUTH_CLIENT_SECRET=... node server/token-broker.mjs
//
// Deployment target (Cloudflare Worker / Lambda) can reuse handleExchange /
// handleRefresh unchanged; only the HTTP wiring at the bottom is Node-specific.

import http from 'node:http';

const PORT = Number(process.env.BROKER_PORT || 8787);
const CLIENT_ID = process.env.UT_OAUTH_CLIENT_ID || 'cola-class-finder-oidc';
const CLIENT_SECRET = process.env.UT_OAUTH_CLIENT_SECRET;
const TOKEN_ENDPOINT =
  process.env.UT_OAUTH_TOKEN_ENDPOINT ||
  'https://enterprise.login.utexas.edu/idp/profile/oidc/token';
// The only redirect URI registered with UT IAM. Pinned here so a stolen code
// can't be exchanged against a different redirect target through us.
const REDIRECT_URI = process.env.UT_OAUTH_REDIRECT_URI || 'utclassfinder://redirect';

const MAX_BODY_BYTES = 8 * 1024;

if (!CLIENT_SECRET) {
  console.error('UT_OAUTH_CLIENT_SECRET is required');
  process.exit(1);
}

/** Forward a form-encoded grant to UT's token endpoint with client auth. */
async function forwardToUt(form) {
  const basic = Buffer.from(
    `${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`,
  ).toString('base64');
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: 'upstream_error', error_description: 'Non-JSON response from IdP' };
  }
  return { status: res.status, json };
}

/** Require string fields of sane length; returns null with a 400 otherwise. */
function requireFields(body, fields) {
  for (const f of fields) {
    const v = body?.[f];
    if (typeof v !== 'string' || !v.trim() || v.length > 4096) return f;
  }
  return null;
}

async function handleExchange(body) {
  const missing = requireFields(body, ['code', 'code_verifier']);
  if (missing) {
    return { status: 400, json: { error: 'invalid_request', error_description: `Missing or invalid field: ${missing}` } };
  }
  return forwardToUt({
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    code: body.code,
    code_verifier: body.code_verifier,
  });
}

async function handleRefresh(body) {
  const missing = requireFields(body, ['refresh_token']);
  if (missing) {
    return { status: 400, json: { error: 'invalid_request', error_description: `Missing or invalid field: ${missing}` } };
  }
  return forwardToUt({
    grant_type: 'refresh_token',
    refresh_token: body.refresh_token,
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const send = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      return send(200, { ok: true });
    }
    if (req.method !== 'POST' || !['/exchange', '/refresh'].includes(req.url)) {
      return send(404, { error: 'not_found' });
    }

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(400, { error: 'invalid_request', error_description: 'Body must be JSON' });
    }

    const { status, json } =
      req.url === '/exchange' ? await handleExchange(body) : await handleRefresh(body);
    // Log outcome only — never token material.
    console.log(`${req.url} -> ${status}${json.error ? ` (${json.error})` : ''}`);
    return send(status, json);
  } catch (e) {
    console.error('broker error:', e.message);
    return send(500, { error: 'server_error' });
  }
});

server.listen(PORT, () => {
  console.log(`token broker listening on :${PORT} -> ${TOKEN_ENDPOINT}`);
});
