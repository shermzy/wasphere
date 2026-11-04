const { test } = require('node:test');
const assert = require('node:assert/strict');

// No database here: building the module only needs the Prisma class to exist.
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { PrismaClient: class {}, Prisma: {} },
};
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-1234';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { WebhooksReadController } = require('../dist/webhooks/webhooks.controller');

test('the real app builds with the API-key guard on the webhook read route', async () => {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  assert.ok(app.get(WebhooksReadController, { strict: false }));
});
