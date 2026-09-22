const test = require('node:test');
const assert = require('node:assert/strict');
const { CampaignsService } = require('../dist/campaigns/campaigns.service');
const { CampaignsRunner } = require('../dist/campaigns/campaigns.runner');

const principal = { userId: 'user-a' };

function fakePrisma(seed = {}) {
  const state = {
    campaigns: seed.campaigns ?? [],
    recipients: seed.recipients ?? [],
    contacts: seed.contacts ?? [],
    audits: [],
    campaignWhere: [],
  };

  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((condition) => matches(row, condition));
    if (key === 'status' && value && value.in) return value.in.includes(row.status);
    if (key === 'scheduledAt' && value?.lte) return row.scheduledAt <= value.lte;
    if (key === 'id' && value?.in) return value.in.includes(row.id);
    if (value && typeof value === 'object' && 'contains' in value) return row[key].toLowerCase().includes(value.contains.toLowerCase());
    return row[key] === value;
  });
  const campaignView = (row, include) => include?.recipients
    ? { ...row, recipients: state.recipients.filter((r) => r.campaignId === row.id && r.workspaceId === row.workspaceId) }
    : { ...row };

  const prisma = {
    state,
    workspaceMember: { findUnique: async () => seed.membership ?? ({ role: 'ADMIN', customRole: null }) },
    workspaceSession: { findUnique: async ({ where }) => where.providerSessionId === 'session-a' ? { workspaceId: 'ws-a' } : null },
    contact: { findMany: async ({ where }) => state.contacts.filter((c) => c.workspaceId === where.workspaceId && where.id.in.includes(c.id)) },
    auditLog: { create: async ({ data }) => state.audits.push(data) },
    campaign: {
      findMany: async ({ where, include }) => {
        state.campaignWhere.push(where);
        return state.campaigns.filter((c) => matches(c, where)).map((c) => campaignView(c, include));
      },
      findFirst: async ({ where, include }) => state.campaigns.find((c) => matches(c, where) && (!where.providerSessionId || c.providerSessionId === where.providerSessionId)) &&
        campaignView(state.campaigns.find((c) => matches(c, where)), include),
      create: async ({ data }) => {
        const row = { id: `campaign-${state.campaigns.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        state.campaigns.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const row = state.campaigns.find((c) => matches(c, where));
        if (!row) return { count: 0 };
        Object.assign(row, data, { updatedAt: new Date() });
        return { count: 1 };
      },
      update: async ({ where, data }) => {
        const row = state.campaigns.find((c) => c.id === where.id);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    campaignRecipient: {
      createMany: async ({ data }) => {
        state.recipients.push(...data.map((row, i) => ({ id: `recipient-${state.recipients.length + i + 1}`, ...row })));
        return { count: data.length };
      },
      deleteMany: async ({ where }) => {
        const before = state.recipients.length;
        state.recipients = state.recipients.filter((r) => !(r.campaignId === where.campaignId && r.workspaceId === where.workspaceId));
        return { count: before - state.recipients.length };
      },
      findMany: async ({ where }) => state.recipients.filter((r) => r.campaignId === where.campaignId && r.workspaceId === where.workspaceId),
      updateMany: async ({ where, data }) => {
        const row = state.recipients.find((r) => r.id === where.id && r.campaignId === where.campaignId && r.workspaceId === where.workspaceId && (!where.status || r.status === where.status));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    $transaction: async (work) => work(prisma),
  };
  return prisma;
}

const workspaces = { assertProviderSession: async () => undefined };

test('campaign reads keep the requested workspace in every campaign query', async () => {
  const prisma = fakePrisma({ campaigns: [{ id: 'other', workspaceId: 'ws-b', status: 'DRAFT' }] });
  const service = new CampaignsService(prisma, workspaces, {});

  await service.list(principal, 'ws-a', {});

  assert.equal(prisma.state.campaignWhere[0].workspaceId, 'ws-a');
});

test('campaign service rejects a creator whose messages capability was revoked', async () => {
  const prisma = fakePrisma({
    membership: { role: 'MEMBER', customRole: { capabilities: ['inbox'] } },
  });
  const service = new CampaignsService(prisma, workspaces, {});

  await assert.rejects(() => service.list(principal, 'ws-a', {}), /messages permission/i);
});

test('campaign names are trimmed, exposed, and searchable with message text', async () => {
  const prisma = fakePrisma({
    contacts: [{ id: 'contact-1', workspaceId: 'ws-a', phone: '123456789', jid: '123456789@s.whatsapp.net', savedName: 'Alice', whatsappName: null }],
  });
  const service = new CampaignsService(prisma, workspaces, {});

  const created = await service.create(principal, 'ws-a', {
    name: '  Spring Sale  ',
    providerSessionId: 'session-a',
    message: 'Use code HELLO',
    contactIds: ['contact-1'],
  });
  assert.equal(created.name, 'Spring Sale');

  const updated = await service.update(principal, 'ws-a', created.id, { name: '  Summer Sale  ' });
  assert.equal(updated.name, 'Summer Sale');
  assert.equal((await service.list(principal, 'ws-a', { search: 'summer' }))[0].id, created.id);
  assert.equal((await service.list(principal, 'ws-a', { search: 'hello' }))[0].id, created.id);
});

test('schedule then cancel is a durable state transition', async () => {
  const prisma = fakePrisma({ campaigns: [{ id: 'c1', workspaceId: 'ws-a', providerSessionId: 'session-a', status: 'DRAFT', message: 'hello', createdBy: 'user-a' }] });
  const service = new CampaignsService(prisma, workspaces, {});

  await service.schedule(principal, 'ws-a', 'c1', { scheduledAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(prisma.state.campaigns[0].status, 'SCHEDULED');
  await service.cancel(principal, 'ws-a', 'c1');
  assert.equal(prisma.state.campaigns[0].status, 'CANCELLED');
  assert.ok(prisma.state.audits.some((row) => row.method === 'CAMPAIGN_SCHEDULE'));
  assert.ok(prisma.state.audits.some((row) => row.method === 'CAMPAIGN_CANCEL'));
});

test('a second launch cannot claim or resend a campaign', async () => {
  const prisma = fakePrisma({
    campaigns: [{ id: 'c1', workspaceId: 'ws-a', providerSessionId: 'session-a', status: 'DRAFT', message: 'hello', createdBy: 'user-a' }],
    recipients: [{ id: 'r1', campaignId: 'c1', workspaceId: 'ws-a', phone: '123456789', jid: '123456789@s.whatsapp.net', status: 'PENDING' }],
  });
  let sends = 0;
  const service = new CampaignsService(prisma, workspaces, {
    startConversation: async () => { sends += 1; return { conversationId: 'conversation-1' }; },
  });

  await assert.rejects(() => service.launch(principal, 'ws-a', 'c1', false), /confirmation/i);
  await service.launch(principal, 'ws-a', 'c1', true);
  await assert.rejects(() => service.launch(principal, 'ws-a', 'c1', true), /already claimed|cannot be launched/i);

  assert.equal(sends, 1);
  assert.equal(prisma.state.recipients[0].status, 'SENT');
  assert.equal(prisma.state.campaigns[0].status, 'COMPLETED');
});

test('scheduler queries due campaigns directly with a bounded deterministic order', async () => {
  let query;
  const launches = [];
  const runner = new CampaignsRunner({
    campaign: {
      findMany: async (args) => {
        query = args;
        return [{ id: 'c1', workspaceId: 'ws-a', createdBy: 'user-a' }];
      },
    },
  }, {
    launch: async (...args) => launches.push(args),
  });

  await runner.runScheduled();

  assert.equal(query.where.status, 'SCHEDULED');
  assert.ok(query.where.scheduledAt.lte instanceof Date);
  assert.deepEqual(query.orderBy, [{ scheduledAt: 'asc' }, { id: 'asc' }]);
  assert.equal(query.take, 20);
  assert.deepEqual(launches, [[{ userId: 'user-a' }, 'ws-a', 'c1', true]]);
});
