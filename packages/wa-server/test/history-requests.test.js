// Unit tests for HistoryRequests (on-demand group history). Pure logic, no socket.
const { test } = require('node:test');
const assert = require('node:assert');
const { proto, getContentType } = require('@whiskeysockets/baileys');
const {
  HistoryRequests,
  HistoryBusyError,
  HistoryTimeoutError,
  toHistoryMessages,
} = require('../dist/whatsapp/history-requests');

const ON_DEMAND = proto.HistorySync.HistorySyncType.ON_DEMAND;
const G = '120363000000000000@g.us';
const msg = (id, jid, ts, text) => ({ key: { id, remoteJid: jid, fromMe: false, participant: 'x@lid' }, messageTimestamp: ts, message: { conversation: text } });

test('settle resolves with only the messages for the waiting chat', async () => {
  const r = new HistoryRequests();
  const w = r.open('s1', G, 1000);
  const other = msg('b', 'other@g.us', 2, 'no');
  assert.equal(r.settle('s1', { syncType: ON_DEMAND, messages: [msg('a', G, 1, 'yes'), other] }), true);
  const got = await w.done;
  assert.deepEqual(got.map((m) => m.key.id), ['a']);
});

test('settle matches on request id even with no messages', async () => {
  const r = new HistoryRequests();
  const w = r.open('s1', G, 1000);
  w.setRequestId('req-1');
  assert.equal(r.settle('s1', { syncType: ON_DEMAND, peerDataRequestSessionId: 'req-1', messages: [] }), true);
  assert.deepEqual(await w.done, []);
});

test('settle ignores other sync types and other sessions', async () => {
  const r = new HistoryRequests();
  const w = r.open('s1', G, 1000);
  assert.equal(r.settle('s1', { syncType: proto.HistorySync.HistorySyncType.RECENT, messages: [msg('a', G, 1, 'x')] }), false);
  assert.equal(r.settle('s2', { syncType: ON_DEMAND, messages: [msg('a', G, 1, 'x')] }), false);
  w.cancel(new Error('done'));
  await assert.rejects(w.done, /done/);
});

test('second request for the same chat is busy; times out and frees the slot', async () => {
  const r = new HistoryRequests();
  const w = r.open('s1', G, 20);
  assert.throws(() => r.open('s1', G, 20), HistoryBusyError);
  await assert.rejects(w.done, HistoryTimeoutError);
  const again = r.open('s1', G, 1000);
  again.cancel(new Error('x'));
  await assert.rejects(again.done);
});

test('a rejection before anyone awaits does not raise unhandledRejection', async () => {
  let unhandled = null;
  const onUnhandled = (e) => { unhandled = e; };
  process.on('unhandledRejection', onUnhandled);
  try {
    const r = new HistoryRequests();
    const t = r.open('s1', G, 5);
    const d = r.open('s2', G, 1000);
    r.dropSession('s2', new Error('closed'));
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(unhandled, null);
    await assert.rejects(t.done, HistoryTimeoutError);
    await assert.rejects(d.done, /closed/);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('dropSession rejects waits of that session only', async () => {
  const r = new HistoryRequests();
  const a = r.open('s1', G, 1000);
  const b = r.open('s2', G, 1000);
  r.dropSession('s1', new Error('closed'));
  await assert.rejects(a.done, /closed/);
  r.settle('s2', { syncType: ON_DEMAND, messages: [msg('z', G, 1, 'ok')] });
  assert.equal((await b.done).length, 1);
});

test('toHistoryMessages: text only, skips protocol, oldest first, Long timestamps', () => {
  const long = { toNumber: () => 5 };
  const out = toHistoryMessages(
    [
      msg('late', G, 9, 'second'),
      { key: { id: 'p', remoteJid: G }, messageTimestamp: 1, message: { protocolMessage: {} } },
      { key: { id: 'img', remoteJid: G, participant: 'y@lid', participantAlt: '65@s.whatsapp.net' }, messageTimestamp: long, pushName: 'Y', message: { imageMessage: { caption: 'pic' } } },
      { key: { id: 'empty', remoteJid: G }, messageTimestamp: 2 },
    ],
    getContentType,
  );
  assert.deepEqual(out.map((m) => m.messageId), ['img', 'late']);
  assert.equal(out[0].text, 'pic');
  assert.equal(out[0].timestamp, 5);
  assert.equal(out[0].senderPn, '65@s.whatsapp.net');
  assert.equal(out[0].sender, 'y@lid');
});
