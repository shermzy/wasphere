const { test } = require('node:test');
const assert = require('node:assert/strict');
const { InternalService } = require('../dist/internal/internal.service');

const dto = {
  event: 'message.received',
  sessionId: 'provider-session-1',
  timestamp: '2026-09-22T00:00:00.000Z',
  data: { messageId: 'message-1' },
};

test('fan-out delivers to active webhooks and logs each subscribed inactive one as skipped', async () => {
  const hook = (id, isActive, events) => ({ id, isActive, events, url: 'https://example.com', signingSecret: 's', retryMax: 1 });
  const service = new InternalService(
    {
      webhook: {
        findMany: async () => [
          hook('active', true, ['message.received']),
          hook('off', false, ['message.received']),
          hook('off-wildcard', false, ['*']),
          hook('off-other-event', false, ['poll.vote']),
        ],
      },
    },
    { recordDelivery: async () => {} },
  );
  const warnings = [];
  const delivered = [];
  service.logger = { warn: (line) => warnings.push(line), log: () => {}, error: () => {} };
  service.deliverWithRetry = async (_workspaceId, wh) => { delivered.push(wh.id); };

  await service.runFanout('workspace-1', dto);

  assert.deepEqual(delivered, ['active']);
  assert.deepEqual(warnings, [
    '[Fanout] webhook.skipped_inactive id=off event=message.received',
    '[Fanout] webhook.skipped_inactive id=off-wildcard event=message.received',
  ]);
});
