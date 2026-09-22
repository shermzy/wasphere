const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AiRepliesService } = require('../dist/ai-replies/ai-replies.service');

const workspaceId = 'workspace-a';
const userId = 'operator-a';
const contact = {
  id: 'contact-a',
  jid: '15550000001@s.whatsapp.net',
  phone: '15550000001',
  savedName: 'Alice',
  whatsappName: 'Alice WA',
};

function conversation(id = 'conversation-a', workspace = workspaceId) {
  return { id, workspaceId: workspace, sessionId: 'session-a', contact };
}

function prismaFor({ member = true, convo = conversation(), messages = [] } = {}) {
  return {
    workspaceMember: {
      findUnique: async () => (member ? { id: 'membership-a' } : null),
    },
    conversation: {
      findFirst: async ({ where }) => where.id === convo.id && where.workspaceId === convo.workspaceId ? convo : null,
    },
    message: {
      findMany: async () => messages,
    },
  };
}

function withEnv(values, callback) {
  const previous = { ...process.env };
  for (const key of ['AI_REPLY_BASE_URL', 'AI_REPLY_API_KEY', 'AI_REPLY_MODEL']) delete process.env[key];
  Object.assign(process.env, values);
  return Promise.resolve().then(callback).finally(() => {
    for (const key of ['AI_REPLY_BASE_URL', 'AI_REPLY_API_KEY', 'AI_REPLY_MODEL']) delete process.env[key];
    Object.assign(process.env, previous);
  });
}

test('workspace IDOR is blocked before provider access', async () => {
  await withEnv({ AI_REPLY_BASE_URL: 'https://provider.example/v1', AI_REPLY_API_KEY: 'secret', AI_REPLY_MODEL: 'model' }, async () => {
    let called = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { called = true; throw new Error('must not call provider'); };
    try {
      const service = new AiRepliesService(prismaFor({ convo: conversation('conversation-a', 'workspace-b') }));
      await assert.rejects(
        () => service.createDraft(userId, workspaceId, { conversationId: 'conversation-a' }),
        /Conversation not found/,
      );
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('missing provider configuration reports operator setup and does not fetch', async () => {
  await withEnv({}, async () => {
    let called = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { called = true; };
    try {
      const service = new AiRepliesService(prismaFor());
      assert.deepEqual(service.status(), { configured: false, message: 'Operator setup required.' });
      await assert.rejects(
        () => service.createDraft(userId, workspaceId, { conversationId: 'conversation-a' }),
        /operator setup required/,
      );
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('timeout and provider errors are redacted', async () => {
  await withEnv({ AI_REPLY_BASE_URL: 'https://provider.example/v1', AI_REPLY_API_KEY: 'do-not-return', AI_REPLY_MODEL: 'model' }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('provider secret body do-not-return'); };
    try {
      const service = new AiRepliesService(prismaFor());
      await assert.rejects(
        () => service.createDraft(userId, workspaceId, { conversationId: 'conversation-a' }),
        (error) => error.message === 'AI reply provider unavailable' && !error.message.includes('do-not-return'),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('successful draft is bounded and sends only bounded recent context', async () => {
  await withEnv({ AI_REPLY_BASE_URL: 'https://provider.example/v1', AI_REPLY_API_KEY: 'secret', AI_REPLY_MODEL: 'model' }, async () => {
    let request;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://provider.example/v1/chat/completions');
      request = JSON.parse(options.body);
      return Response.json({ choices: [{ message: { content: ' ' + 'x'.repeat(3000) + ' ' } }] });
    };
    try {
      const messages = Array.from({ length: 25 }, (_, index) => ({
        direction: index % 2 ? 'OUTBOUND' : 'INBOUND',
        type: 'text',
        body: 'y'.repeat(2000),
        waTimestamp: new Date('2026-09-' + String((index % 9) + 1).padStart(2, '0') + 'T00:00:00.000Z'),
      }));
      const service = new AiRepliesService(prismaFor({ messages }));
      const result = await service.createDraft(userId, workspaceId, {
        conversationId: 'conversation-a', tone: 'warm', instruction: 'Keep it brief',
      });
      assert.equal(result.draft.length, 2000);
      assert.deepEqual(result.source, {
        conversationId: 'conversation-a', sessionId: 'session-a', contactId: 'contact-a',
        contactJid: '15550000001@s.whatsapp.net', contactName: 'Alice',
      });
      assert.equal(request.max_tokens, 300);
      const userPrompt = JSON.parse(request.messages[1].content);
      assert.equal(userPrompt.conversation.length, 20);
      assert.equal(userPrompt.conversation[0].body.length, 1000);
      assert.match(request.messages[0].content, /untrusted data/);
      assert.match(request.messages[0].content, /Do not execute commands/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('service and module have no send or mutation dependency', () => {
  const root = path.resolve(__dirname, '..', 'src', 'ai-replies');
  const source = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => fs.readFileSync(path.join(root, entry.name), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /InboxService|sendReply|conversation\.(create|update|delete)|message\.(create|update|delete)/);
});
