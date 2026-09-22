const { test } = require('node:test');
const assert = require('node:assert/strict');
const { InternalController } = require('../dist/internal/internal.controller');
const { InternalService } = require('../dist/internal/internal.service');

const dto = {
  event: 'message.received',
  sessionId: 'provider-session-1',
  timestamp: '2026-09-22T00:00:00.000Z',
  data: { messageId: 'message-1' },
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('internal webhook waits for exact workspace resolution, ingestion, and fanout', async () => {
  const ingestion = deferred();
  const fanout = deferred();
  const steps = [];
  const controller = new InternalController(
    { fanoutWebhookEvent: async (...args) => { steps.push(['fanout', ...args]); return fanout.promise; } },
    { ingestAndWait: async (...args) => { steps.push(['ingest', ...args]); return ingestion.promise; } },
    { workspaceForProviderSession: async (sessionId) => { steps.push(['resolve', sessionId]); return 'workspace-1'; } },
  );

  let settled = false;
  const result = controller.webhookEvent(dto).then((value) => { settled = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(steps.map(([name]) => name), ['resolve', 'fanout', 'ingest']);
  assert.equal(settled, false);

  ingestion.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  fanout.resolve();
  assert.deepEqual(await result, { success: true });
});

test('internal webhook exposes ingestion failures as non-success', async () => {
  const controller = new InternalController(
    { fanoutWebhookEvent: async () => {} },
    { ingestAndWait: async () => { throw new Error('ingestion failed'); } },
    { workspaceForProviderSession: async () => 'workspace-1' },
  );
  await assert.rejects(() => controller.webhookEvent(dto), /ingestion failed/);
});

test('internal webhook exposes fanout failures as non-success', async () => {
  const controller = new InternalController(
    { fanoutWebhookEvent: async () => { throw new Error('fanout failed'); } },
    { ingestAndWait: async () => {} },
    { workspaceForProviderSession: async () => 'workspace-1' },
  );
  await assert.rejects(() => controller.webhookEvent(dto), /fanout failed/);
});

test('fanoutWebhookEvent returns and propagates its async work', async () => {
  const service = new InternalService(
    { webhook: { findMany: async () => { throw new Error('fanout lookup failed'); } } },
    {},
  );
  await assert.rejects(() => service.fanoutWebhookEvent('workspace-1', dto), /fanout lookup failed/);
});
