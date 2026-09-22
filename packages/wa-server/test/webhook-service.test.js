const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { WebhookService } = require('../dist/webhooks/webhook.service');

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    return await callback(`http://127.0.0.1:${address.port}/internal/webhook-event`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function serviceFor(url) {
  const service = new WebhookService();
  service.dashboardUrl = url;
  return service;
}

test('callback registration rejects non-HTTP and self-referential endpoints', () => {
  const service = new WebhookService();
  assert.throws(() => service.setDashboardUrl('ftp://dashboard.example/file'), /HTTP\(S\)/);
  assert.throws(() => service.setDashboardUrl('http://wa-server:3001/api/webhooks/callback'), /HTTP\(S\)/);
});

test('native webhook delivery resolves only for 2xx', async () => {
  await withServer((req, res) => {
    res.writeHead(204);
    res.end();
  }, async (url) => {
    await serviceFor(url).fire('message.received', 'session-1', { messageId: 'message-1' });
  });
});

test('native webhook delivery rejects non-2xx with a bounded non-secret diagnostic', async () => {
  const secret = 'do-not-include-this-body';
  await withServer((req, res) => {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end(secret.repeat(10_000));
  }, async (url) => {
    await assert.rejects(
      () => serviceFor(url).fire('message.received', 'session-1', { messageId: 'message-1' }),
      (error) => {
        assert.match(error.message, /HTTP 503/);
        assert.ok(error.message.length < 200);
        assert.doesNotMatch(error.message, /do-not-include-this-body/);
        return true;
      },
    );
  });
});
