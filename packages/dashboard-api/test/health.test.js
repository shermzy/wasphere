const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ServiceUnavailableException } = require('@nestjs/common');
const { HealthController } = require('../dist/health/health.controller');

test('liveness stays cheap and does not query the database', () => {
  let probes = 0;
  const controller = new HealthController({
    $queryRaw: async () => {
      probes += 1;
    },
  });

  assert.deepEqual(controller.live(), { status: 'ok' });
  assert.equal(probes, 0);
});

test('readiness succeeds when the database probe succeeds', async () => {
  const controller = new HealthController({
    $queryRaw: async () => [],
  });

  assert.deepEqual(await controller.ready(), { status: 'ok' });
});

test('readiness returns 503 when the database probe fails', async () => {
  const controller = new HealthController({
    $queryRaw: async () => {
      throw new Error('database unavailable');
    },
  });

  await assert.rejects(
    () => controller.ready(),
    (error) => error instanceof ServiceUnavailableException && error.getStatus() === 503,
  );
});
