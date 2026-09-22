const { test } = require('node:test');
const assert = require('node:assert/strict');

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@whiskeysockets/baileys') {
    return {
      makeWASocket: () => undefined,
      DisconnectReason: { loggedOut: 4010 },
      useMultiFileAuthState: async () => undefined,
      fetchLatestBaileysVersion: async () => ({ version: [2, 0, 0] }),
      makeCacheableSignalKeyStore: () => undefined,
      getContentType: () => undefined,
      decryptPollVote: async () => undefined,
      getAggregateVotesInPollMessage: () => undefined,
      getKeyAuthor: () => undefined,
      jidNormalizedUser: (value) => value,
      downloadMediaMessage: async () => undefined,
    };
  }
  if (request === 'qrcode') return { toDataURL: async () => 'data:' };
  return originalLoad.apply(this, arguments);
};
const { BaileysAdapter } = require('../dist/whatsapp/baileys.adapter');
Module._load = originalLoad;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function makeAdapter() {
  return new BaileysAdapter({ fire: async () => undefined });
}

function disconnectedUpdate() {
  return {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 408 } } },
  };
}

test('concurrent creates for one opaque session initialise one provider state', async () => {
  const previousMax = process.env.MAX_SESSIONS;
  process.env.MAX_SESSIONS = '10';
  const adapter = makeAdapter();
  const firstPreflightStarted = deferred();
  const releaseFirstPreflight = deferred();
  let preflightCalls = 0;
  let initCalls = 0;

  adapter.preflightProxy = async () => {
    preflightCalls += 1;
    if (preflightCalls === 1) {
      firstPreflightStarted.resolve();
      await releaseFirstPreflight.promise;
    }
  };
  adapter.initSocket = async () => {
    initCalls += 1;
  };

  try {
    const first = adapter.createSession('opaque-session', 'http://proxy.invalid');
    await firstPreflightStarted.promise;
    const second = adapter.createSession('opaque-session', 'http://proxy.invalid');
    releaseFirstPreflight.resolve();

    const results = await Promise.all([first, second]);
    assert.equal(results[0].id, 'opaque-session');
    assert.equal(results[1].id, 'opaque-session');
    assert.equal(initCalls, 1);
  } finally {
    if (previousMax === undefined) delete process.env.MAX_SESSIONS;
    else process.env.MAX_SESSIONS = previousMax;
  }
});

test('concurrent creates do not exceed the configured session capacity', async () => {
  const previousMax = process.env.MAX_SESSIONS;
  process.env.MAX_SESSIONS = '1';
  const adapter = makeAdapter();
  const firstPreflightStarted = deferred();
  const releaseFirstPreflight = deferred();
  let preflightCalls = 0;
  let initCalls = 0;

  adapter.preflightProxy = async () => {
    preflightCalls += 1;
    if (preflightCalls === 1) {
      firstPreflightStarted.resolve();
      await releaseFirstPreflight.promise;
    }
  };
  adapter.initSocket = async () => {
    initCalls += 1;
  };

  try {
    const first = adapter.createSession('first-session', 'http://proxy.invalid');
    await firstPreflightStarted.promise;
    const second = adapter.createSession('second-session', 'http://proxy.invalid');
    releaseFirstPreflight.resolve();

    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(initCalls, 1);
    assert.equal(adapter.getAllSessions().length, 1);
  } finally {
    if (previousMax === undefined) delete process.env.MAX_SESSIONS;
    else process.env.MAX_SESSIONS = previousMax;
  }
});

test('delete during reconnect prevents in-flight reconnect from resurrecting the session', async () => {
  const adapter = makeAdapter();
  adapter.RETRY_DELAY_MS = 10;
  const reconnectStarted = deferred();
  const releaseReconnect = deferred();
  let initCalls = 0;

  adapter.initSocket = async (sessionId) => {
    initCalls += 1;
    if (initCalls === 2) {
      reconnectStarted.resolve();
      await releaseReconnect.promise;
      adapter.sessions.set(sessionId, { end: () => undefined });
    }
  };

  await adapter.createSession('session-to-delete');
  await adapter.handleConnectionUpdate('session-to-delete', disconnectedUpdate());
  await reconnectStarted.promise;

  const deletion = adapter.deleteSession('session-to-delete');
  releaseReconnect.resolve();
  await deletion;
  await wait(25);

  assert.equal(initCalls, 2);
  assert.equal(adapter.sessionInfo.has('session-to-delete'), false);
  assert.equal(adapter.sessions.has('session-to-delete'), false);
});

test('logout cancels a pending reconnect', async () => {
  const adapter = makeAdapter();
  adapter.RETRY_DELAY_MS = 10;
  let initCalls = 0;
  adapter.initSocket = async () => {
    initCalls += 1;
  };

  await adapter.createSession('session-to-logout');
  await adapter.handleConnectionUpdate('session-to-logout', disconnectedUpdate());
  await adapter.logoutSession('session-to-logout');
  await wait(25);

  assert.equal(initCalls, 1);
});

test('failed restart preserves the session record for a later retry', async () => {
  const adapter = makeAdapter();
  let initCalls = 0;
  adapter.initSocket = async () => {
    initCalls += 1;
    if (initCalls === 2) throw new Error('restart failed');
  };

  await adapter.createSession('recoverable-session', undefined, { receive_enabled: true });
  await assert.rejects(() => adapter.restartSession('recoverable-session'), /restart failed/);

  const failed = adapter.getSessionInfo('recoverable-session');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.config.receive_enabled, true);
  assert.equal(adapter.sessions.has('recoverable-session'), false);

  const retried = await adapter.restartSession('recoverable-session');
  assert.equal(retried.id, 'recoverable-session');
  assert.equal(retried.status, 'connecting');
});
