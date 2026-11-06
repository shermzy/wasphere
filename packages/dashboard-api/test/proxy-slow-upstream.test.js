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

test('keep-alive: reused socket (no connect event) still gets the 30s header window', async () => {
  const upstream = http.createServer((_q, r) => {
    setTimeout(() => { r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"ok":true}'); }, 12_000);
  });
  await new Promise((ok) => upstream.listen(0, '127.0.0.1', ok));
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const origRequest = http.request;
  const reused = [];
  http.request = (opts, cb) => {
    const r = origRequest.call(http, { ...opts, agent }, cb);
    r.on('socket', (s) => reused.push(!s.connecting));
    return r;
  };
  const svc = service(`http://127.0.0.1:${upstream.address().port}`);
  try {
    for (let i = 0; i < 2; i++) {
      const res = fakeRes();
      await svc.proxy('u', 'w', 'api/sessions/main/messages/text', req(), res);
      assert.equal(res.statusCode, 200, `request ${i + 1}`);
    }
  } finally {
    http.request = origRequest;
    agent.destroy();
    upstream.closeAllConnections?.();
    upstream.close();
  }
  assert.deepEqual(reused, [false, true], 'second request must reuse the socket');
});

test('client closing before the upstream answers destroys the upstream request', async () => {
  let upstreamClosed;
  const closed = new Promise((ok) => { upstreamClosed = ok; });
  const upstream = http.createServer((q, _r) => { q.on('close', upstreamClosed); });
  await new Promise((ok) => upstream.listen(0, '127.0.0.1', ok));
  const res = fakeRes();
  const p = service(`http://127.0.0.1:${upstream.address().port}`)
    .proxy('u', 'w', 'api/sessions/main/messages/text', req(), res);
  setTimeout(() => res.emit('close'), 300);
  try {
    await p;
    await closed;
  } finally {
    upstream.closeAllConnections?.();
    upstream.close();
  }
});
