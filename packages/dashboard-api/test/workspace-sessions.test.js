const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkspacesService } = require('../dist/workspaces/workspaces.service');

test('provider session ownership is exact and workspace-scoped', async () => {
  const created = [];
  const rows = new Map([['other-session', { workspaceId: 'workspace-b' }]]);
  const prisma = {
    workspaceMember: { findUnique: async () => ({ id: 'member' }) },
    workspaceSession: {
      findMany: async () => [{ providerSessionId: 'owned-session' }],
      findUnique: async ({ where }) => rows.get(where.providerSessionId) ?? null,
      create: async ({ data }) => { created.push(data); rows.set(data.providerSessionId, data); },
    },
  };
  const service = new WorkspacesService(prisma, {});

  assert.deepEqual([...await service.listProviderSessionIds('user-a', 'workspace-a')], ['owned-session']);
  assert.equal(await service.reserveProviderSession('user-a', 'workspace-a', 'new-session'), true);
  assert.deepEqual(created, [{ workspaceId: 'workspace-a', providerSessionId: 'new-session' }]);
  await assert.rejects(
    () => service.assertProviderSession('user-a', 'workspace-a', 'other-session'),
    /not found in this workspace/i,
  );
});
