// Cloudflare Worker entry for the UT SSO token broker.
//
// Deploy:
//   npx wrangler secret put UT_OAUTH_CLIENT_SECRET   # paste the UT IAM secret
//   npx wrangler deploy
//
// The secret lives only in Cloudflare's secret store — never in git, never in
// .env, and never in the app bundle. All logic is in broker-core.mjs; this
// file is only the HTTP adapter.

import { MAX_BODY_BYTES, resolveConfig, route } from './broker-core.mjs';

const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // Answered before config resolution, on purpose. A broker deployed without
    // its secret should still be reachable and should say so — otherwise every
    // path returns 500 and "not deployed" is indistinguishable from "deployed
    // but misconfigured". Reports only whether the binding is present.
    if (request.method === 'GET' && pathname === '/healthz') {
      return json(200, { ok: true, configured: Boolean(env.UT_OAUTH_CLIENT_SECRET) });
    }

    let config;
    try {
      config = resolveConfig(env);
    } catch {
      // Misconfigured deploy — say so without echoing which binding is unset.
      console.error('broker misconfigured: UT_OAUTH_CLIENT_SECRET is not set');
      return json(500, { error: 'server_error' });
    }

    // Reject oversized bodies before buffering them.
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BODY_BYTES) {
      return json(413, { error: 'invalid_request', error_description: 'Body too large' });
    }

    let bodyText = '';
    if (request.method === 'POST') {
      bodyText = await request.text();
      if (bodyText.length > MAX_BODY_BYTES) {
        return json(413, { error: 'invalid_request', error_description: 'Body too large' });
      }
    }

    try {
      const { status, json: payload } = await route(request.method, pathname, bodyText, config);
      // Outcome only — never token material.
      console.log(`${request.method} ${pathname} -> ${status}${payload.error ? ` (${payload.error})` : ''}`);
      return json(status, payload);
    } catch (e) {
      console.error('broker error:', e.message);
      return json(500, { error: 'server_error' });
    }
  },
};
