const test = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { AutomationService } = require('../dist/automations/automations.service');

function fakePrisma({ rules = [], member = { role: 'OWNER', customRole: null }, sessionWorkspace = 'ws-a' } = {}) {
  const state = {
    rules: rules.map((rule) => ({ createdAt: new Date(), updatedAt: new Date(), ...rule })),
    runs: [],
    audits: [],
    ruleQueries: [],
  };
  const prisma = {
    state,
    automationRule: {
      findMany: async ({ where }) => {
        state.ruleQueries.push(where);
        return state.rules.filter((rule) => Object.entries(where).every(([key, value]) => rule[key] === value));
      },
      findFirst: async ({ where }) => state.rules.find((rule) => Object.entries(where).every(([key, value]) => rule[key] === value)) ?? null,
      create: async ({ data }) => {
        const rule = { id: `rule-${state.rules.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        state.rules.push(rule);
        return rule;
      },
      update: async ({ where, data }) => {
        const rule = state.rules.find((row) => row.id === where.id);
        Object.assign(rule, data);
        return rule;
      },
    },
    automationRun: {
      create: async ({ data }) => {
        if (state.runs.some((run) => run.workspaceId === data.workspaceId && run.automationRuleId === data.automationRuleId && run.providerMessageId === data.providerMessageId)) {
          throw new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: Prisma.prismaVersion.client,
          });
        }
        const run = { id: `run-${state.runs.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        state.runs.push(run);
        return run;
      },
      findUnique: async ({ where }) => state.runs.find((run) => run.id === where.id) ?? null,
      update: async ({ where, data }) => {
        const run = state.runs.find((row) => row.id === where.id);
        Object.assign(run, data, { updatedAt: new Date() });
        return run;
      },
      findFirst: async ({ where }) => state.runs.find((run) => run.workspaceId === where.workspaceId && run.automationRuleId === where.automationRuleId) ?? null,
      findMany: async ({ where }) => state.runs.filter((run) => run.workspaceId === where.workspaceId && run.automationRuleId === where.automationRuleId),
    },
    workspaceMember: {
      findUnique: async ({ where }) =>
        where.workspaceId_userId?.workspaceId === 'ws-a' && where.workspaceId_userId?.userId === 'user-a'
          ? { id: 'member-a', ...member }
          : null,
    },
    workspaceSession: { findUnique: async () => sessionWorkspace ? { workspaceId: sessionWorkspace } : null },
    conversation: { findFirst: async ({ where }) => where.workspaceId === 'ws-a' && where.sessionId === 'session-a' ? { id: where.id } : null },
    auditLog: { create: async ({ data }) => { state.audits.push(data); } },
  };
  return prisma;
}

const workspaces = { assertProviderSession: async () => undefined };

function inbound(overrides = {}) {
  return {
    workspaceId: 'ws-a',
    providerSessionId: 'session-a',
    providerMessageId: 'message-a',
    conversationId: 'conversation-a',
    type: 'text',
    body: 'Hello from the inbox',
    fromMe: false,
    isGroup: false,
    ...overrides,
  };
}

test('automation evaluation is workspace-scoped', async () => {
  const prisma = fakePrisma({ rules: [{ id: 'rule-b', workspaceId: 'ws-b', providerSessionId: 'session-a', keyword: 'hello', enabled: true, createdBy: 'user-a', responseText: 'reply' }] });
  let sends = 0;
  const service = new AutomationService(prisma, workspaces, { sendReply: async () => { sends += 1; } });

  await service.evaluateInbound(inbound());

  assert.equal(prisma.state.ruleQueries[0].workspaceId, 'ws-a');
  assert.equal(sends, 0);
});

test('disabled rules never claim or send', async () => {
  const prisma = fakePrisma({ rules: [{ id: 'rule-a', workspaceId: 'ws-a', providerSessionId: 'session-a', keyword: 'hello', enabled: false, createdBy: 'user-a', responseText: 'reply' }] });
  let sends = 0;
  const service = new AutomationService(prisma, workspaces, { sendReply: async () => { sends += 1; } });

  await service.evaluateInbound(inbound());

  assert.equal(prisma.state.runs.length, 0);
  assert.equal(sends, 0);
});

test('session mismatch is fail-closed after the run claim', async () => {
  const prisma = fakePrisma({ sessionWorkspace: 'ws-b', rules: [{ id: 'rule-a', workspaceId: 'ws-a', providerSessionId: 'session-a', keyword: 'hello', enabled: true, createdBy: 'user-a', responseText: 'reply' }] });
  let sends = 0;
  const service = new AutomationService(prisma, workspaces, { sendReply: async () => { sends += 1; } });

  await service.evaluateInbound(inbound());

  assert.equal(sends, 0);
  assert.equal(prisma.state.runs[0].status, 'SKIPPED');
  assert.match(prisma.state.runs[0].errorMessage, /not assigned/i);
});

test('matching inbound text sends one mocked reply and records the outcome', async () => {
  const prisma = fakePrisma({ rules: [{ id: 'rule-a', workspaceId: 'ws-a', providerSessionId: 'session-a', keyword: 'hello', enabled: true, createdBy: 'user-a', responseText: 'Thanks!' }] });
  const replies = [];
  const service = new AutomationService(prisma, workspaces, { sendReply: async (...args) => { replies.push(args); } });

  await service.evaluateInbound(inbound());

  assert.equal(replies.length, 1);
  assert.equal(replies[0][0], 'user-a');
  assert.equal(replies[0][2], 'conversation-a');
  assert.equal(replies[0][3].text, 'Thanks!');
  assert.equal(prisma.state.runs[0].status, 'SENT');
  assert.ok(prisma.state.audits.some((row) => row.method === 'AUTOMATION_RUN' && row.workspaceId === 'ws-a'));
});

test('provider error bodies never enter automation run history or logs', async () => {
  const prisma = fakePrisma({ rules: [
    { id: 'rule-a', workspaceId: 'ws-a', providerSessionId: 'session-a', keyword: 'hello', enabled: true, createdBy: 'user-a', responseText: 'Thanks!' },
    { id: 'rule-b', workspaceId: 'ws-a', providerSessionId: 'session-a', keyword: 'inbox', enabled: true, createdBy: 'user-a', responseText: 'Thanks again!' },
  ] });
  let attempt = 0;
  const logs = [];
  const service = new AutomationService(prisma, workspaces, {
    sendReply: async () => {
      attempt += 1;
      const error = new Error(attempt === 1
        ? 'provider body contains message=Hello from the inbox token=secret-token'
        : 'gateway body contains message=Hello from the inbox secret=secret-value');
      error.getStatus = () => attempt === 1 ? 400 : 503;
      error.code = attempt === 1 ? 'PROVIDER_REJECTED' : 'ETIMEDOUT';
      throw error;
    },
  });
  service.logger.warn = (message) => logs.push(message);

  await service.evaluateInbound(inbound());

  assert.deepEqual(prisma.state.runs.map((run) => run.status), ['FAILED', 'INDETERMINATE']);
  assert.deepEqual(prisma.state.runs.map((run) => run.errorMessage), [
    'Provider rejected delivery',
    'Delivery outcome unknown',
  ]);
  assert.equal(prisma.state.runs[0].history[1].error, 'Provider rejected delivery');
  assert.equal(prisma.state.runs[1].history[1].error, 'Delivery outcome unknown');
  assert.match(logs[0], /status=400 code=PROVIDER_REJECTED/);
  assert.match(logs[1], /status=503 code=ETIMEDOUT/);
  for (const value of [...logs, ...prisma.state.runs.map((run) => run.errorMessage), ...prisma.state.runs.flatMap((run) => run.history.map((entry) => entry.error || ''))]) {
    assert.doesNotMatch(value, /provider body|gateway body|secret-token|secret-value|Hello from the inbox/i);
  }
});

test('duplicate inbound event cannot claim or resend the same rule run', async () => {
  const prisma = fakePrisma({ rules: [{ id: 'rule-a', workspaceId: 'ws-a', providerSessionId: 'session-a', keyword: 'hello', enabled: true, createdBy: 'user-a', responseText: 'Thanks!' }] });
  let sends = 0;
  const service = new AutomationService(prisma, workspaces, { sendReply: async () => { sends += 1; } });

  await service.evaluateInbound(inbound());
  await service.evaluateInbound(inbound());

  assert.equal(sends, 1);
  assert.equal(prisma.state.runs.length, 1);
});
