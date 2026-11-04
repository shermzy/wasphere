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

function createDto(signingSecret) {
  return {
    name: 'Alerts',
    url: 'https://example.com/webhook',
    events: ['poll.vote'],
    ...(signingSecret === undefined ? {} : { signingSecret }),
  };
}

test('create generates a secure secret when none is supplied and stores a custom secret when supplied', async () => {
  const generated = setup();
  const generatedResult = await generated.service.create(userId, workspaceId, createDto());
  assert.match(generatedResult.signingSecret, /^[0-9a-f]{64}$/);
  assert.equal(generated.state.createArgs.data.signingSecret, generatedResult.signingSecret);

  const custom = setup();
  const supplied = '  operator-secret-123456789012345678901234  ';
  const customResult = await custom.service.create(userId, workspaceId, createDto(supplied));
  assert.equal(custom.state.createArgs.data.signingSecret, supplied.trim());
  assert.equal(customResult.signingSecret, supplied.trim());
});

test('create rejects secrets outside the trimmed length range and rejects control characters', async () => {
  const short = setup();
  await assert.rejects(
    () => short.service.create(userId, workspaceId, createDto('x'.repeat(31))),
    /between 32 and 256/,
  );

  const control = setup();
  await assert.rejects(
    () => control.service.create(userId, workspaceId, createDto(`${'x'.repeat(32)}\n`)),
    /control characters/,
  );
  assert.equal(control.state.createArgs, null);
});

test('list never selects or returns signing secrets', async () => {
  const { service, state } = setup();
  const result = await service.list(userId, workspaceId);
  assert.equal(state.listArgs.select.signingSecret, undefined);
  assert.equal(Object.hasOwn(result[0], 'signingSecret'), false);
});

test('omitting signingSecret on update preserves the current secret and does not reveal it', async () => {
  const { service, state } = setup();
  const result = await service.update(userId, workspaceId, 'webhook-1', { name: 'Renamed' });
  assert.equal(state.updateArgs.data.signingSecret, undefined);
  assert.equal(state.updateArgs.select.signingSecret, undefined);
  assert.equal(Object.hasOwn(result, 'signingSecret'), false);
});

test('rotating signingSecret stores and returns only the new secret once', async () => {
  const { service, state } = setup();
  const supplied = '  rotated-secret-123456789012345678901234  ';
  const result = await service.update(userId, workspaceId, 'webhook-1', { signingSecret: supplied });
  assert.equal(state.updateArgs.data.signingSecret, supplied.trim());
  assert.equal(state.updateArgs.select.signingSecret, true);
  assert.equal(result.signingSecret, supplied.trim());
  assert.notEqual(result.signingSecret, oldSecret);
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
