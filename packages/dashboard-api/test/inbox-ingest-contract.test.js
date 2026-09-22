const { test } = require('node:test');
const assert = require('node:assert/strict');
const { InboxIngestService } = require('../dist/inbox/inbox-ingest.service');

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test('public Inbox ingestion waits for durable persistence and automation evaluation', async () => {
  const evaluation = deferred();
  const steps = [];
  const jid = '923000000001@s.whatsapp.net';
  const prisma = {
    message: { findUnique: async () => null },
    $transaction: async (work) => {
      const result = await work({
        contact: { upsert: async () => ({ id: 'contact-1' }) },
        conversation: {
          upsert: async () => ({ id: 'conversation-1', lastMessageAt: new Date(0), sessionDeletedAt: null }),
          update: async () => undefined,
        },
        message: { create: async () => undefined },
      });
      steps.push('durable');
      return result;
    },
  };
  const service = new InboxIngestService(
    prisma,
    { emit: () => undefined },
    { evaluateInbound: async () => { steps.push('automation-start'); await evaluation.promise; steps.push('automation-end'); } },
  );

  let settled = false;
  const result = service.ingestAndWait('workspace-1', {
    event: 'message.received',
    sessionId: 'session-1',
    timestamp: '2026-09-22T00:00:00.000Z',
    data: {
      type: 'conversation',
      timestamp: 1700000000,
      from: jid,
      messageId: 'message-1',
      content: { text: 'hello' },
      message: { key: { remoteJid: jid, id: 'message-1' }, pushName: 'Tester' },
    },
  }).then(() => { settled = true; });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(steps, ['durable', 'automation-start']);
  assert.equal(settled, false);

  evaluation.resolve();
  await result;
  assert.deepEqual(steps, ['durable', 'automation-start', 'automation-end']);
  assert.equal(settled, true);
});
