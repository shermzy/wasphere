const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');

const { ProxyService } = require('../dist/workspaces/proxy.service');

function fakeRes() {
  const res = new EventEmitter();
  Object.assign(res, { statusCode: null, headersSent: false, writableEnded: false, body: '' });
  res.writeHead = (code) => { res.statusCode = code; res.headersSent = true; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.headersSent = true; res.body = JSON.stringify(obj); res.end(); };
  res.write = (c) => { res.body += c; };
  res.end = () => { res.writableEnded = true; };
  return res;
}

function service(url) {
  return new ProxyService({
    getDecryptedToken: async () => ({ waServerUrl: url, token: 'tok' }),
    assertAnyCapability: async () => {},
    assertProviderSession: async () => {},
  });
}

const req = () => ({
  method: 'POST',
  url: '/messages/text',
  headers: { 'content-type': 'application/json' },
  rawBody: Buffer.from('{"to":"x@g.us","text":"hi"}'),
});

test('send that the upstream answers after 12s returns its 2xx, not 502', async () => {
  const upstream = http.createServer((_q, r) => {
    setTimeout(() => { r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"ok":true}'); }, 12_000);
  });
  await new Promise((ok) => upstream.listen(0, '127.0.0.1', ok));
  const res = fakeRes();
  try {
    await service(`http://127.0.0.1:${upstream.address().port}`)
      .proxy('u', 'w', 'api/sessions/main/messages/text', req(), res);
  } finally {
    upstream.closeAllConnections?.();
    upstream.close();
  }
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '{"ok":true}');
});

test('refused connection still maps to 502 WA_SERVER_UNREACHABLE', async () => {
  const probe = http.createServer();
  await new Promise((ok) => probe.listen(0, '127.0.0.1', ok));
  const port = probe.address().port;
  await new Promise((ok) => probe.close(ok));
  const res = fakeRes();
  await service(`http://127.0.0.1:${port}`).proxy('u', 'w', 'api/sessions/main/messages/text', req(), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body, '{"error":"WA_SERVER_UNREACHABLE"}');
});
