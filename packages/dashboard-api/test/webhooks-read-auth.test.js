const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const { Module } = require('@nestjs/common');
const { NestFactory, Reflector } = require('@nestjs/core');
const passport = require('passport');
const { WebhooksController, WebhooksReadController } = require('../dist/webhooks/webhooks.controller');
const { WebhooksService } = require('../dist/webhooks/webhooks.service');
const { ApiKeysService } = require('../dist/api-keys/api-keys.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { CombinedAuthGuard } = require('../dist/auth/combined-auth.guard');
const { ApiKeyPermissionGuard } = require('../dist/auth/api-key-permission.guard');
const { CapabilityGuard } = require('../dist/auth/capability.guard');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');

const workspaceId = 'workspace-a';
const keys = {
  wsk_read: { userId: 'owner', apiKeyId: 'k1', workspaceId, permissions: ['webhooks:read'] },
  wsk_all: { userId: 'owner', apiKeyId: 'k2', workspaceId, permissions: ['*'] },
  wsk_contacts: { userId: 'owner', apiKeyId: 'k3', workspaceId, permissions: ['contacts:read'] },
  wsk_other: { userId: 'other', apiKeyId: 'k4', workspaceId: 'workspace-b', permissions: ['webhooks:read'] },
};
const calls = [];
const service = {
  list: async (userId, ws) => { calls.push(['list', userId, ws]); return [{ id: 'w1' }]; },
  create: async () => { calls.push(['create']); return {}; },
  update: async () => { calls.push(['update']); return {}; },
  remove: async () => { calls.push(['remove']); return {}; },
  testFire: async () => { calls.push(['testFire']); return {}; },
};

let app;
let base;

before(async () => {
  // Stands in for the real JWT strategy: only this one token is a dashboard login.
  passport.use('jwt', {
    name: 'jwt',
    authenticate(req) {
      if (req.headers.authorization === 'Bearer dashboard-login') {
        this.success({ userId: 'member', email: 'member@example.invalid' });
      } else {
        this.fail(401);
      }
    },
  });

  class TestModule {}
  Module({
    controllers: [WebhooksReadController, WebhooksController],
    providers: [
      Reflector,
      CombinedAuthGuard,
      ApiKeyPermissionGuard,
      CapabilityGuard,
      JwtAuthGuard,
      { provide: WebhooksService, useValue: service },
      { provide: ApiKeysService, useValue: { validateApiKey: async (token) => keys[token] ?? null } },
      {
        provide: PrismaService,
        useValue: {
          workspaceMember: {
            findUnique: async () => ({ role: 'OWNER', customRole: null }),
          },
        },
      },
    ],
  })(TestModule);

  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/workspaces/${workspaceId}/webhooks`;
});

after(async () => {
  await app.close();
});

function call(token, method = 'GET', path = '') {
  return fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }),
  });
}

test('an API key with webhooks:read or * lists webhooks as the workspace owner', async () => {
  for (const token of ['wsk_read', 'wsk_all']) {
    calls.length = 0;
    const res = await call(token);
    assert.equal(res.status, 200, token);
    assert.deepEqual(await res.json(), [{ id: 'w1' }]);
    assert.deepEqual(calls, [['list', 'owner', workspaceId]]);
  }
});

test('a dashboard login still lists webhooks', async () => {
  calls.length = 0;
  assert.equal((await call('dashboard-login')).status, 200);
  assert.deepEqual(calls, [['list', 'member', workspaceId]]);
});

test('listing refuses a key without the scope, a key for another workspace and an unknown key', async () => {
  calls.length = 0;
  assert.equal((await call('wsk_contacts')).status, 403);
  assert.equal((await call('wsk_other')).status, 403);
  assert.equal((await call('wsk_unknown')).status, 401);
  assert.deepEqual(calls, []);
});

test('no API key reaches a webhook write route, even with the * scope', async () => {
  calls.length = 0;
  const routes = [['POST', ''], ['PATCH', '/w1'], ['POST', '/w1/test'], ['DELETE', '/w1']];
  for (const token of ['wsk_read', 'wsk_all']) {
    for (const [method, path] of routes) {
      assert.equal((await call(token, method, path)).status, 401, `${token} ${method} ${path}`);
    }
  }
  assert.deepEqual(calls, []);
});

test('a dashboard login still reaches the write routes', async () => {
  assert.equal((await call('dashboard-login', 'POST', '')).status, 201);
  assert.equal((await call('dashboard-login', 'DELETE', '/w1')).status, 200);
});
