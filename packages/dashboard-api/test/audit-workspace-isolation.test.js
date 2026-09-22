const test = require('node:test');
const assert = require('node:assert/strict');

const { WorkspacesService } = require('../dist/workspaces/workspaces.service');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@nestjs/schedule') return { Cron: () => () => {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { InternalService } = require('../dist/internal/internal.service');
Module._load = originalLoad;

test('workspace audit reads scope every query to the requested workspace', async () => {
  const auditQueries = [];
  const rows = [
    { id: 'a', workspaceId: 'workspace-a' },
    { id: 'b', workspaceId: 'workspace-b' },
    { id: 'legacy', workspaceId: null },
  ];
  const prisma = {
    workspaceMember: { findUnique: async () => ({ id: 'member' }) },
    auditLog: {
      findMany: async ({ where }) => {
        auditQueries.push(where);
        return where.endpoint ? [] : rows.filter((row) => row.workspaceId === where.workspaceId);
      },
      count: async ({ where }) => {
        auditQueries.push(where);
        return rows.filter((row) => row.workspaceId === where.workspaceId).length;
      },
    },
  };
  const service = new WorkspacesService(prisma, {});

  const logs = await service.getAuditLogs('workspace-a', 'user-a', { page: 1, pageSize: 20 });
  await service.getStats('workspace-a', 'user-a');

  assert.deepEqual(logs.items.map((row) => row.id), ['a']);
  assert.equal(logs.total, 1);
  assert.equal(auditQueries.length, 7);
  assert.ok(auditQueries.every((where) => where.workspaceId === 'workspace-a'));
});

test('internal audit requires an exact owned provider session before writing', async () => {
  const created = [];
  const sessions = new Map([
    ['owned-session', { workspaceId: 'workspace-a' }],
    ['foreign-session', { workspaceId: 'workspace-b' }],
  ]);
  const prisma = {
    workspaceSession: {
      findUnique: async ({ where }) => sessions.get(where.providerSessionId) ?? null,
    },
    auditLog: {
      create: async ({ data }) => created.push(data),
    },
  };
  const service = new InternalService(prisma, {});
  const event = { method: 'POST', endpoint: '/sessions/owned-session/messages/text' };

  await assert.rejects(() => service.ingestAudit({ ...event }), /session/i);
  await assert.rejects(() => service.ingestAudit({ ...event, sessionId: 'unknown-session' }), /session/i);
  await service.ingestAudit({ ...event, sessionId: 'foreign-session', workspaceId: 'workspace-a' });
  await service.ingestAudit({ ...event, sessionId: 'owned-session' });

  assert.equal(created.length, 2);
  assert.equal(created[0].workspaceId, 'workspace-b');
  assert.equal(created[0].sessionId, 'foreign-session');
  assert.equal(created[1].workspaceId, 'workspace-a');
  assert.equal(created[1].sessionId, 'owned-session');
  assert.equal(created[0].endpoint, event.endpoint);
});
