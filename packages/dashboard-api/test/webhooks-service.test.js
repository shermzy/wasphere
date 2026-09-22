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
