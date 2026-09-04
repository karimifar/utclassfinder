// Local dev server for the UT SSO token broker.
//
// Production runs on Cloudflare Workers (worker.mjs); this is the same logic
// behind a Node http server so the exchange can be exercised from a local dev
// build without deploying. Both share broker-core.mjs.
//
// Run:
//   UT_OAUTH_CLIENT_SECRET=... node server/token-broker.mjs
//
// Then point the app at it with UT_OAUTH_BROKER_URL=http://<your-LAN-ip>:8787
// (a device on the same network cannot reach "localhost").

import http from 'node:http';
import { MAX_BODY_BYTES, resolveConfig, route } from './broker-core.mjs';

const PORT = Number(process.env.BROKER_PORT || 8787);

let config;
try {
  config = resolveConfig(process.env);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // Stop reading but leave the socket up, so the 413 can still be
        // written. Destroying here loses the response entirely.
        req.pause();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const send = (status, obj, closeConnection = false) => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    if (closeConnection) {
      // The request body was abandoned mid-stream, so this connection cannot
      // be reused; tear it down once the response is on the wire.
      headers.Connection = 'close';
      res.on('finish', () => req.destroy());
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(obj));
  };

  try {
    const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const bodyText = req.method === 'POST' ? await readBody(req) : '';
    const { status, json } = await route(req.method, pathname, bodyText, config);
    // Outcome only — never token material.
    console.log(`${req.method} ${pathname} -> ${status}${json.error ? ` (${json.error})` : ''}`);
    return send(status, json);
  } catch (e) {
    if (e.message === 'body too large') {
      return send(413, { error: 'invalid_request', error_description: 'Body too large' }, true);
    }
    console.error('broker error:', e.message);
    return send(500, { error: 'server_error' });
  }
});

server.listen(PORT, () => {
  console.log(`token broker listening on :${PORT} -> ${config.tokenEndpoint}`);
});
