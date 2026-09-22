const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');

const { StartConversationDto } = require('../dist/inbox/dto/start-conversation.dto');
const { InboxEventsService } = require('../dist/inbox/inbox-events.service');
const { InboxService } = require('../dist/inbox/inbox.service');

const originalFetch = global.fetch;

after(() => {
  global.fetch = originalFetch;
});

function response(body, status = 201) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function harness({ sessionError } = {}) {
  const calls = { fetch: [], member: [], provider: [], token: [], audit: [], events: [], messages: [], conversations: [] };
  const tx = {
    contact: {
      upsert: async ({ where, create }) => ({ id: 'contact-1', ...create, ...where['workspaceId_jid'] }),
    },
    conversation: {
      upsert: async ({ where, create }) => {
        calls.conversations.push({ operation: 'upsert', where, create });
        return { id: 'conversation-1', ...create };
      },
      update: async (args) => {
        calls.conversations.push({ operation: 'update', ...args });
        return args;
      },
    },
    message: {
      upsert: async (args) => {
        calls.messages.push(args);
        return { id: 'message-1', ...args.create };
      },
    },
  };
  const prisma = {
    workspaceMember: {
      findUnique: async (args) => {
        calls.member.push(args);
        return { id: 'membership-1' };
      },
    },
    $transaction: async (callback) => callback(tx),
    auditLog: { create: async ({ data }) => { calls.audit.push(data); return data; } },
  };
  const workspaces = {
    assertProviderSession: async (userId, workspaceId, sessionId) => {
      calls.provider.push({ userId, workspaceId, sessionId });
      if (sessionError) throw sessionError;
    },
    getDecryptedToken: async (userId, workspaceId) => {
      calls.token.push({ userId, workspaceId });
      return { waServerUrl: 'https://wa.example/', token: 'test-token' };
    },
  };
  const events = { emit: (event) => calls.events.push(event) };
  return { service: new InboxService(prisma, workspaces, events), calls };
}

async function validationErrors(payload) {
  const dto = plainToInstance(StartConversationDto, payload);
  return { dto, errors: await validate(dto, { whitelist: true, forbidNonWhitelisted: true }) };
}

test('start DTO validates the text/template discriminator and bounded template fields', async () => {
  const valid = await validationErrors({
    kind: 'template',
    sessionId: 'meta-1',
    to: '+1 (234) 567-890',
    templateName: 'approved_template',
    languageCode: 'en_US',
    bodyParams: ['Alice'],
  });
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.dto.to, '1234567890');

  for (const payload of [
    { sessionId: 'baileys-1', to: '1234567890', text: 'legacy shape' },
    { kind: 'template', sessionId: 'meta-1', to: '1234567890', languageCode: 'en_US' },
    { kind: 'template', sessionId: 'meta-1', to: '1234567890', templateName: 'approved_template', languageCode: '   ' },
    { kind: 'template', sessionId: 'meta-1', to: '1234567890', templateName: 'approved_template', languageCode: 'en_US', bodyParams: ['   '] },
    { kind: 'template', sessionId: 'meta-1', to: '1234567890', templateName: 'approved_template', languageCode: 'en_US', text: 'fallback' },
    { kind: 'template', sessionId: 'meta-1', to: '1234567890', name: 'alias', languageCode: 'en_US' },
    { kind: 'template', sessionId: 'meta-1', to: '1234567890', templateName: 'approved_template', languageCode: 'en_US', bodyParams: Array.from({ length: 21 }, () => 'x') },
  ]) {
    const result = await validationErrors(payload);
    assert.ok(result.errors.length > 0, JSON.stringify(payload));
  }
});

test('template new-chat sends the exact template request and persists a safe shape', async () => {
  const { service, calls } = harness();
  global.fetch = async (url, init) => {
    calls.fetch.push({ url, init });
    return response({ messageId: 'wa-template-1' });
  };

  const result = await service.startConversation('user-a', 'workspace-a', {
    kind: 'template',
    sessionId: 'meta-1',
    to: '+1 (234) 567-890',
    templateName: 'approved_template',
    languageCode: 'en_US',
    bodyParams: ['Alice', '42'],
  });

  assert.deepEqual(result, { conversationId: 'conversation-1' });
  assert.equal(calls.provider[0].workspaceId, 'workspace-a');
  assert.equal(calls.provider[0].sessionId, 'meta-1');
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.fetch[0].url, 'https://wa.example/api/sessions/meta-1/messages/template');
  assert.deepEqual(JSON.parse(calls.fetch[0].init.body), {
    to: '1234567890',
    name: 'approved_template',
    languageCode: 'en_US',
    bodyParams: ['Alice', '42'],
  });
  assert.equal(calls.messages[0].create.workspaceId, 'workspace-a');
  assert.equal(calls.messages[0].create.conversationId, 'conversation-1');
  assert.equal(calls.messages[0].create.type, 'text');
  assert.equal(calls.messages[0].create.body, '📋 Template: approved_template — Alice, 42');
  assert.deepEqual(calls.messages[0].create.payload, {
    templateName: 'approved_template',
    languageCode: 'en_US',
    bodyParams: ['Alice', '42'],
  });
  assert.ok(!JSON.stringify(calls.messages[0].create).includes('test-token'));
  assert.deepEqual(calls.audit[0], {
    workspaceId: 'workspace-a',
    sessionId: 'meta-1',
    method: 'POST',
    endpoint: '/inbox/conversations',
    statusCode: 200,
  });
  assert.deepEqual(calls.events, [{ type: 'message.new', workspaceId: 'workspace-a', conversationId: 'conversation-1' }]);
});

test('text starts retain the existing text endpoint and never downgrade templates', async () => {
  const text = harness();
  global.fetch = async (url, init) => {
    text.calls.fetch.push({ url, init });
    return response({ messageId: 'wa-text-1' });
  };
  await text.service.startConversation('user-a', 'workspace-a', {
    kind: 'text',
    sessionId: 'baileys-1',
    to: '1234567890',
    text: 'Hello',
  });
  assert.equal(text.calls.fetch[0].url, 'https://wa.example/api/sessions/baileys-1/messages/text');
  assert.deepEqual(JSON.parse(text.calls.fetch[0].init.body), { to: '1234567890', text: 'Hello' });
  assert.equal(text.calls.messages[0].create.body, 'Hello');
  assert.equal(text.calls.messages[0].create.payload, undefined);

  const template = harness();
  let fetches = 0;
  global.fetch = async () => { fetches += 1; return response({ messageId: 'should-not-send' }); };
  await assert.rejects(
    () => template.service.startConversation('user-a', 'workspace-a', {
      kind: 'template',
      sessionId: 'meta-1',
      to: '1234567890',
      languageCode: 'en_US',
      text: 'must not downgrade',
    }),
    /Template starts require/,
  );
  assert.equal(fetches, 0);
});

test('workspace/session recheck blocks a template send before transport', async () => {
  const { service, calls } = harness({ sessionError: new Error('Session not found in this workspace') });
  let fetches = 0;
  global.fetch = async () => { fetches += 1; return response({ messageId: 'should-not-send' }); };

  await assert.rejects(
    () => service.startConversation('user-a', 'workspace-a', {
      kind: 'template',
      sessionId: 'foreign-session',
      to: '1234567890',
      templateName: 'approved_template',
      languageCode: 'en_US',
      bodyParams: [],
    }),
    /Session not found in this workspace/,
  );
  assert.deepEqual(calls.member[0].where, { workspaceId_userId: { workspaceId: 'workspace-a', userId: 'user-a' } });
  assert.deepEqual(calls.provider[0], { userId: 'user-a', workspaceId: 'workspace-a', sessionId: 'foreign-session' });
  assert.equal(fetches, 0);
});

test('provider rejection reason is surfaced without persistence', async () => {
  const { service, calls } = harness();
  global.fetch = async () => response({ message: 'Template is not approved for this WhatsApp account' }, 400);

  await assert.rejects(
    () => service.startConversation('user-a', 'workspace-a', {
      kind: 'template',
      sessionId: 'meta-1',
      to: '1234567890',
      templateName: 'not_approved',
      languageCode: 'en_US',
      bodyParams: [],
    }),
    (error) => error?.getStatus?.() === 400 && error.message.includes('Template is not approved'),
  );
  assert.equal(calls.messages.length, 0);
  assert.equal(calls.audit.length, 0);
  assert.equal(calls.events.length, 0);
});
