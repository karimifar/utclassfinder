// Run with: npm run test:broker
//
// These cover the broker's own logic against a stubbed UT token endpoint. The
// live checks against the real IdP (that the secret authenticates, that "none"
// is rejected) are not here — they need the real secret and are documented in
// TECHNICAL.md instead.

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  basicAuthHeader,
  handleExchange,
  resolveConfig,
  route,
} from '../broker-core.mjs';

const config = {
  clientId: 'cola-class-finder-oidc',
  clientSecret: 'test-secret',
  tokenEndpoint: 'https://idp.example/token',
  redirectUri: 'utclassfinder://redirect',
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub fetch, recording the single call it receives. */
function stubFetch(response) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  return calls;
}

const jsonResponse = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

describe('resolveConfig', () => {
  it('throws when the secret is absent', () => {
    assert.throws(() => resolveConfig({}), /UT_OAUTH_CLIENT_SECRET is required/);
  });

  it('falls back to the compiled-in defaults', () => {
    const c = resolveConfig({ UT_OAUTH_CLIENT_SECRET: 's' });
    assert.equal(c.clientId, 'cola-class-finder-oidc');
    assert.equal(c.redirectUri, 'utclassfinder://redirect');
    assert.match(c.tokenEndpoint, /enterprise\.login\.utexas\.edu/);
  });

  it('lets the environment override each default', () => {
    const c = resolveConfig({
      UT_OAUTH_CLIENT_SECRET: 's',
      UT_OAUTH_CLIENT_ID: 'other',
      UT_OAUTH_TOKEN_ENDPOINT: 'https://staging/token',
      UT_OAUTH_REDIRECT_URI: 'other://cb',
    });
    assert.equal(c.clientId, 'other');
    assert.equal(c.tokenEndpoint, 'https://staging/token');
    assert.equal(c.redirectUri, 'other://cb');
  });
});

describe('basicAuthHeader', () => {
  it('percent-encodes both halves before base64', () => {
    // Nimbus (Shibboleth's OIDC OP) percent-decodes the header, so a secret
    // containing reserved characters must go out encoded or it arrives wrong.
    const header = basicAuthHeader('id', 'a+b/c=d');
    const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString('utf8');
    assert.equal(decoded, 'id:a%2Bb%2Fc%3Dd');
  });

  it('is a no-op for alphanumeric credentials', () => {
    const header = basicAuthHeader('cola-class-finder-oidc', 'abc123');
    const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString('utf8');
    assert.equal(decoded, 'cola-class-finder-oidc:abc123');
  });
});

describe('handleExchange', () => {
  it('rejects a missing code_verifier without calling upstream', async () => {
    const calls = stubFetch(jsonResponse(200, {}));
    const { status, json } = await handleExchange({ code: 'abc' }, config);
    assert.equal(status, 400);
    assert.equal(json.error, 'invalid_request');
    assert.match(json.error_description, /code_verifier/);
    assert.equal(calls.length, 0);
  });

  it('rejects an over-long field', async () => {
    const calls = stubFetch(jsonResponse(200, {}));
    const { status } = await handleExchange({ code: 'x'.repeat(4097), code_verifier: 'v' }, config);
    assert.equal(status, 400);
    assert.equal(calls.length, 0);
  });

  it('sends the grant with client auth and the pinned redirect_uri', async () => {
    const calls = stubFetch(jsonResponse(200, { id_token: 'jwt', access_token: 'at' }));
    const { status, json } = await handleExchange(
      { code: 'the-code', code_verifier: 'the-verifier' },
      config,
    );

    assert.equal(status, 200);
    assert.equal(json.id_token, 'jwt');
    assert.equal(calls.length, 1);

    const [{ url, init }] = calls;
    assert.equal(url, 'https://idp.example/token');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, basicAuthHeader(config.clientId, config.clientSecret));

    const form = new URLSearchParams(init.body);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('code'), 'the-code');
    assert.equal(form.get('code_verifier'), 'the-verifier');
    assert.equal(form.get('redirect_uri'), 'utclassfinder://redirect');
  });

  it('ignores a client-supplied redirect_uri', async () => {
    // The redirect target is pinned server-side; a stolen code must not be
    // redeemable against an attacker's callback through us.
    const calls = stubFetch(jsonResponse(200, { id_token: 'jwt' }));
    await handleExchange(
      { code: 'c', code_verifier: 'v', redirect_uri: 'evil://steal' },
      config,
    );
    const form = new URLSearchParams(calls[0].init.body);
    assert.equal(form.get('redirect_uri'), 'utclassfinder://redirect');
  });

  it('passes an IdP error through with its status', async () => {
    stubFetch(jsonResponse(400, { error: 'invalid_grant', error_description: 'Invalid grant' }));
    const { status, json } = await handleExchange({ code: 'c', code_verifier: 'v' }, config);
    assert.equal(status, 400);
    assert.equal(json.error, 'invalid_grant');
  });

  it('turns a non-JSON upstream reply into 502', async () => {
    stubFetch(new Response('<html>gateway</html>', { status: 200 }));
    const { status, json } = await handleExchange({ code: 'c', code_verifier: 'v' }, config);
    assert.equal(status, 502);
    assert.equal(json.error, 'upstream_error');
  });

  it('turns an unreachable IdP into 502 rather than a crash', async () => {
    stubFetch(new TypeError('network down'));
    const { status, json } = await handleExchange({ code: 'c', code_verifier: 'v' }, config);
    assert.equal(status, 502);
    assert.equal(json.error, 'upstream_unreachable');
  });
});

describe('route', () => {
  it('answers healthz', async () => {
    const { status, json } = await route('GET', '/healthz', '', config);
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true });
  });

  it('404s unknown paths and wrong methods', async () => {
    assert.equal((await route('POST', '/nope', '{}', config)).status, 404);
    assert.equal((await route('GET', '/exchange', '', config)).status, 404);
    // /refresh was removed deliberately — the app never uses the access token.
    assert.equal((await route('POST', '/refresh', '{}', config)).status, 404);
  });

  it('rejects a non-JSON body', async () => {
    const { status, json } = await route('POST', '/exchange', 'not-json', config);
    assert.equal(status, 400);
    assert.match(json.error_description, /must be JSON/);
  });
});
