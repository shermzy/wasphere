const { test } = require('node:test');
const assert = require('node:assert/strict');

const { proxyCapabilityRequirement } = require('../dist/lib/proxy-capabilities');
const { WorkspacesService } = require('../dist/workspaces/workspaces.service');

test('session creation accepts the narrow create capability', () => {
  assert.deepEqual(proxyCapabilityRequirement('POST', 'api/sessions'), ['sessions_create', 'sessions']);
  assert.deepEqual(
    proxyCapabilityRequirement('POST', 'api/sessions/meta/test-connection'),
    ['sessions_create', 'sessions'],
  );
});

test('session deletion, logout, and configuration require full session administration', () => {
  assert.deepEqual(proxyCapabilityRequirement('DELETE', 'api/sessions/main'), ['sessions']);
  assert.deepEqual(proxyCapabilityRequirement('POST', 'api/sessions/main/logout'), ['sessions']);
  assert.deepEqual(proxyCapabilityRequirement('PATCH', 'api/sessions/main/config'), ['sessions']);
});

test('a create-only agent passes creation but not administration checks', async () => {
  const prisma = {
    workspaceMember: {
      findUnique: async () => ({ role: 'MEMBER', customRole: { capabilities: ['sessions_create'] } }),
    },
  };
  const service = new WorkspacesService(prisma, {});

  await service.assertAnyCapability('agent', 'workspace', ['sessions_create', 'sessions']);
  await assert.rejects(
    service.assertAnyCapability('agent', 'workspace', ['sessions']),
    (error) => error?.getStatus?.() === 403,
  );
});
