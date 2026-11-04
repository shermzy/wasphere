const test = require('node:test');
const assert = require('node:assert/strict');
const { WebhooksService } = require('../dist/webhooks/webhooks.service');

const workspaceId = 'workspace-a';
const userId = 'operator';
const oldSecret = 'old-secret-' .repeat(4);

function withoutSecret(value) {
  const { signingSecret, ...metadata } = value;
  return metadata;
}

function webhook(overrides = {}) {
  return {
    id: 'webhook-1',
    workspaceId,
    name: 'Alerts',
    url: 'https://example.com/webhook',
    events: ['poll.vote'],
    isActive: true,
    retryMax: 3,
    failureCount: 0,
    createdAt: new Date('2026-09-22T00:00:00.000Z'),
    lastDeliveredAt: null,
    lastFailedAt: null,
    signingSecret: oldSecret,
    ...overrides,
  };
}

function setup() {
  const state = { createArgs: null, listArgs: null, updateArgs: null };
  const prisma = {
    workspaceMember: { findUnique: async () => ({ id: 'membership-1' }) },
    webhook: {
      create: async (args) => {
        state.createArgs = args;
        const created = webhook(args.data);
        return args.select.signingSecret ? created : withoutSecret(created);
      },
      findFirst: async () => webhook(),
      findMany: async (args) => {
        state.listArgs = args;
        return [withoutSecret(webhook())];
      },
      update: async (args) => {
        state.updateArgs = args;
        const updated = webhook(args.data);
        return args.select.signingSecret ? updated : withoutSecret(updated);
      },
    },
    auditLog: { create: async () => {} },
  };
  return { service: new WebhooksService(prisma), state };
}

test('list never selects or returns signing secrets', async () => {
  const { service, state } = setup();
  const result = await service.list(userId, workspaceId);
  assert.equal(state.listArgs.select.signingSecret, undefined);
  assert.equal(Object.hasOwn(result[0], 'signingSecret'), false);
});

function deactivationSetup(failureCount, updateManyCount = 1) {
  const state = { updateMany: [] };
  const prisma = {
    webhook: {
      update: async () => ({ failureCount, name: 'Mirror', workspaceId }),
      updateMany: async (args) => {
        state.updateMany.push(args);
        return { count: updateManyCount };
      },
    },
  };
  const service = new WebhooksService(prisma);
  state.errors = [];
  state.warnings = [];
  service.logger = {
    error: (line) => state.errors.push(line),
    warn: (line) => state.warnings.push(line),
  };
  return { service, state };
}

async function withAlertSink(url, result, run) {
  const delivery = require('../dist/common/webhook-delivery');
  const realDeliver = delivery.deliverWebhook;
  const realUrl = process.env.WEBHOOK_ALERT_URL;
  const sent = [];
  delivery.deliverWebhook = async (...args) => {
    sent.push(args);
    return result;
  };
  if (url) process.env.WEBHOOK_ALERT_URL = url;
  else delete process.env.WEBHOOK_ALERT_URL;
  try {
    await run(sent);
  } finally {
    delivery.deliverWebhook = realDeliver;
    if (realUrl === undefined) delete process.env.WEBHOOK_ALERT_URL;
    else process.env.WEBHOOK_ALERT_URL = realUrl;
  }
}

const delivered = { statusCode: 204, success: true, blocked: false, error: null };

test('the 49th failure neither deactivates, logs nor alerts', async () => {
  const { service, state } = deactivationSetup(49);
  await withAlertSink('https://alerts.example/hook', delivered, async (sent) => {
    await service.recordDelivery('webhook-1', false);
    assert.equal(sent.length, 0);
  });
  assert.equal(state.updateMany.length, 0);
  assert.equal(state.errors.length, 0);
});

test('the 50th failure deactivates, logs an error and sends one alert naming the webhook', async () => {
  const { service, state } = deactivationSetup(50);
  await withAlertSink('https://alerts.example/hook', delivered, async (sent) => {
    await service.recordDelivery('webhook-1', false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], 'https://alerts.example/hook');
    const body = JSON.parse(sent[0][1]);
    assert.match(body.content, /webhook\.deactivated id=webhook-1 name="Mirror"/);
    assert.equal(body.text, body.content);
  });
  assert.deepEqual(state.updateMany[0], {
    where: { id: 'webhook-1', isActive: true },
    data: { isActive: false },
  });
  assert.equal(state.errors.length, 1);
  assert.match(state.errors[0], /webhook\.deactivated id=webhook-1 .*failures=50/);
});

test('a failure after the switch-off does not alert again', async () => {
  const { service, state } = deactivationSetup(51, 0);
  await withAlertSink('https://alerts.example/hook', delivered, async (sent) => {
    await service.recordDelivery('webhook-1', false);
    assert.equal(sent.length, 0);
  });
  assert.equal(state.errors.length, 0);
});

test('with no alert destination the 50th failure still deactivates and logs', async () => {
  const { service, state } = deactivationSetup(50);
  await withAlertSink(undefined, delivered, async (sent) => {
    await service.recordDelivery('webhook-1', false);
    assert.equal(sent.length, 0);
  });
  assert.equal(state.updateMany.length, 1);
  assert.equal(state.errors.length, 1);
  assert.match(state.warnings[0], /WEBHOOK_ALERT_URL is not set/);
});

test('a failed alert is logged and does not throw into fan-out', async () => {
  const { service, state } = deactivationSetup(50);
  const failed = { statusCode: 500, success: false, blocked: false, error: 'HTTP 500' };
  await withAlertSink('https://alerts.example/hook', failed, async () => {
    await service.recordDelivery('webhook-1', false);
  });
  assert.equal(state.errors.length, 2);
  assert.match(state.errors[1], /alert failed id=webhook-1 status=500/);
});
