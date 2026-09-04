// Platform-agnostic core of the UT SSO token broker.
//
// UT's Enterprise Authentication OP does not support public clients. Its
// discovery document advertises token_endpoint_auth_methods_supported as
// client_secret_basic / client_secret_post / client_secret_jwt /
// private_key_jwt — "none" is absent — so a native app can neither complete
// the code exchange on its own nor safely hold the secret needed to do it.
//
// This module is the one place that secret is used. The app runs the
// authorization-code + PKCE flow in the system browser as usual, then POSTs
// {code, code_verifier} here instead of to UT directly; we attach client
// authentication and forward. PKCE still binds every exchange to the app
// instance that started it — the broker adds client auth and nothing else.
// It holds no state and never logs codes, tokens, or the secret.
//
// No HTTP wiring lives here, so the same logic serves both the Cloudflare
// Worker (worker.mjs) and the local Node dev server (token-broker.mjs).

export const DEFAULT_CLIENT_ID = 'cola-class-finder-oidc';
export const DEFAULT_TOKEN_ENDPOINT =
  'https://enterprise.login.utexas.edu/idp/profile/oidc/token';
// The only redirect URI registered with UT IAM. Pinned here rather than taken
// from the request so a stolen code cannot be exchanged against a different
// redirect target through us.
export const DEFAULT_REDIRECT_URI = 'utclassfinder://redirect';

/** Bodies are two short strings; anything larger is not a real exchange. */
export const MAX_BODY_BYTES = 8 * 1024;

/**
 * Read config from a plain env bag — process.env under Node, the bindings
 * object under Workers. Throws if the secret is missing, since a broker
 * without one can only ever return invalid_client.
 */
export function resolveConfig(env = {}) {
  const clientSecret = env.UT_OAUTH_CLIENT_SECRET;
  if (!clientSecret) throw new Error('UT_OAUTH_CLIENT_SECRET is required');
  return {
    clientId: env.UT_OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID,
    clientSecret,
    tokenEndpoint: env.UT_OAUTH_TOKEN_ENDPOINT || DEFAULT_TOKEN_ENDPOINT,
    redirectUri: env.UT_OAUTH_REDIRECT_URI || DEFAULT_REDIRECT_URI,
  };
}

/**
 * Build an HTTP Basic credential for client_secret_basic.
 *
 * Both halves are percent-encoded before base64. RFC 6749 §2.3.1 requires it,
 * and UT's IdP is Shibboleth's OIDC OP, which parses the header through Nimbus
 * — Nimbus percent-decodes both halves, so an unencoded secret containing a
 * reserved character would arrive corrupted. Today's secret is alphanumeric,
 * which makes the encoding a no-op; this matters at rotation, when a generated
 * secret may well contain "+", "/" or "=".
 */
export function basicAuthHeader(clientId, clientSecret) {
  const credential = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
  // btoa is available on Workers and on Node >=16.
  return `Basic ${btoa(credential)}`;
}

/** Forward a form-encoded grant to UT's token endpoint with client auth. */
async function forwardToUt(form, config) {
  let res;
  try {
    res = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: basicAuthHeader(config.clientId, config.clientSecret),
      },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    // Network/TLS failure reaching UT. 502 distinguishes this from a 400 the
    // IdP actually returned, so the app can tell "try again" from "re-auth".
    return {
      status: 502,
      json: { error: 'upstream_unreachable', error_description: 'Could not reach the UT IdP' },
    };
  }

  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return {
      status: 502,
      json: { error: 'upstream_error', error_description: 'Non-JSON response from IdP' },
    };
  }
}

/** Require string fields of sane length; returns the offending name or null. */
function firstInvalidField(body, fields) {
  for (const f of fields) {
    const v = body?.[f];
    if (typeof v !== 'string' || !v.trim() || v.length > 4096) return f;
  }
  return null;
}

export async function handleExchange(body, config) {
  const bad = firstInvalidField(body, ['code', 'code_verifier']);
  if (bad) {
    return {
      status: 400,
      json: { error: 'invalid_request', error_description: `Missing or invalid field: ${bad}` },
    };
  }
  return forwardToUt(
    {
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
      code: body.code,
      code_verifier: body.code_verifier,
    },
    config,
  );
}

/**
 * Route one request. `bodyText` is the raw request body; callers are
 * responsible for enforcing MAX_BODY_BYTES while reading it.
 *
 * There is deliberately no /refresh here. The app never calls a UT API with
 * the access token — sign-in only proves EID identity — so there is nothing to
 * keep fresh, and requesting offline_access would mean storing a
 * long-lived refresh token on-device for no gain. See AuthContext.tsx.
 */
export async function route(method, pathname, bodyText, config) {
  if (method === 'GET' && pathname === '/healthz') {
    return { status: 200, json: { ok: true } };
  }
  if (method !== 'POST' || pathname !== '/exchange') {
    return { status: 404, json: { error: 'not_found' } };
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return {
      status: 400,
      json: { error: 'invalid_request', error_description: 'Body must be JSON' },
    };
  }
  return handleExchange(body, config);
}
