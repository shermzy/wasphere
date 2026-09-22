const test = require('node:test');
const assert = require('node:assert/strict');
const { ProjectsService } = require('../dist/projects/projects.service');
const { InboxService } = require('../dist/inbox/inbox.service');

const principal = { userId: 'operator' };
const workspaceId = 'workspace-a';

function member() { return { role: 'ADMIN', customRole: null }; }
function response(body) { return Response.json(body); }

test('project service enforces the projects capability beyond the controller guard', async () => {
  const service = new ProjectsService({
    workspaceMember: {
      findUnique: async () => ({ role: 'MEMBER', customRole: { capabilities: ['inbox'] } }),
    },
  }, {});

  await assert.rejects(() => service.list(principal, workspaceId), /projects permission/i);
});

test('binding requires confirmation and stores the chosen exact group ID with an audit event', async () => {
  const writes = [];
  const prisma = {
    workspaceMember: { findUnique: async () => member() },
    $transaction: async (callback) => callback({
      $queryRaw: async () => [{ workspaceId }],
      workspaceMember: { findUnique: async () => member() },
      contact: { upsert: async (args) => { writes.push(['contact', args]); return { id: 'contact-2' }; } },
      conversation: { upsert: async (args) => { writes.push(['conversation', args]); return { id: 'conversation-2' }; } },
      projectRoute: { create: async (args) => {
        writes.push(['route', args]);
        return {
          id: 'route-2', workspaceId, name: 'Operations', routeKey: 'operations', enabled: true,
          createdBy: principal.userId, createdAt: new Date(), updatedAt: new Date(),
          conversation: {
            id: 'conversation-2', sessionId: 'session-1', sessionDeletedAt: null,
            contact: { jid: 'chat-2@g.us', phone: 'chat-2@g.us', whatsappName: 'Operations', savedName: null },
          },
        };
      } },
      projectRouteAudit: { create: async (args) => { writes.push(['audit', args]); } },
    }),
  };
  const workspaces = {
    assertProviderSession: async () => {},
    getDecryptedToken: async () => ({ waServerUrl: 'https://wa.example', token: 'test-token' }),
  };
  const service = new ProjectsService(prisma, workspaces);
  const dto = { name: 'Operations', routeKey: 'operations', sessionId: 'session-1', targetJid: 'chat-2@g.us' };
  await assert.rejects(() => service.create(principal, workspaceId, { ...dto, confirmed: false }), /Confirm the exact route/);
  assert.equal(writes.length, 0);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/api/sessions/session-1')) return response({ id: 'session-1', status: 'connected' });
    if (url.endsWith('/api/sessions/session-1/groups')) {
      return response([{ id: 'chat-1@g.us', subject: 'Operations' }, { id: 'chat-2@g.us', subject: 'Operations' }]);
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const route = await service.create(principal, workspaceId, { ...dto, confirmed: true });
    assert.equal(route.routeKey, 'operations');
    assert.equal(route.target.jid, 'chat-2@g.us');
    assert.equal(writes.find(([kind]) => kind === 'contact')[1].where.workspaceId_jid.jid, 'chat-2@g.us');
    assert.deepEqual(writes.find(([kind]) => kind === 'audit')[1].data, {
      workspaceId, projectRouteId: 'route-2', actorUserId: 'operator', action: 'route.bound',
      routeKey: 'operations', sessionId: 'session-1', targetJid: 'chat-2@g.us',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('binding rejects a direct chat absent from the selected session', async () => {
  const prisma = {
    workspaceMember: { findUnique: async () => member() },
    contact: { findUnique: async () => ({ phone: '123', savedName: 'Alice', whatsappName: null, conversations: [] }) },
    $transaction: async () => { throw new Error('must not write'); },
  };
  const service = new ProjectsService(prisma, {
    assertProviderSession: async () => {},
    getDecryptedToken: async () => ({ waServerUrl: 'https://wa.example', token: 'test-token' }),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response({ id: 'session-1', status: 'connected' });
  try {
    await assert.rejects(() => service.create(principal, workspaceId, {
      name: 'Alice', routeKey: 'alice', sessionId: 'session-1',
      targetJid: '123@s.whatsapp.net', confirmed: true,
    }), /Direct-chat targets must already be observed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('binding aborts if exact session ownership changes before the transaction write', async () => {
  const service = new ProjectsService({
    workspaceMember: { findUnique: async () => member() },
    $transaction: async (callback) => callback({
      $queryRaw: async () => [{ workspaceId: 'workspace-b' }],
    }),
  }, {
    assertProviderSession: async () => {},
    getDecryptedToken: async () => ({ waServerUrl: 'https://wa.example', token: 'test-token' }),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => url.endsWith('/groups')
    ? response([{ id: 'exact@g.us', subject: 'Exact group' }])
    : response({ status: 'connected' });
  try {
    await assert.rejects(() => service.create(principal, workspaceId, {
      name: 'Exact', routeKey: 'exact', sessionId: 'session-1', targetJid: 'exact@g.us', confirmed: true,
    }), /ownership changed/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sync stores exact WaSphere group metadata inside the active workspace', async () => {
  const writes = [];
  let sessionChecks = 0;
  const prisma = {
    workspaceMember: { findUnique: async () => member() },
    $transaction: async (callback) => callback({
      $queryRaw: async () => [{ workspaceId }],
      workspaceMember: { findUnique: async () => member() },
      contact: { upsert: async (args) => { writes.push(['contact', args]); return { id: 'contact-1' }; } },
      conversation: { upsert: async (args) => { writes.push(['conversation', args]); } },
    }),
  };
  const service = new ProjectsService(prisma, {
    assertProviderSession: async () => {},
    getDecryptedToken: async () => ({ waServerUrl: 'https://wa.example', token: 'test-token' }),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/api/sessions/session-1')) {
      sessionChecks += 1;
      return response({ status: 'connected' });
    }
    return response([{ id: 'exact@g.us', subject: 'Exact group' }, { id: 'not-a-group', subject: 'Ignored' }]);
  };
  try {
    assert.deepEqual(await service.syncTargets(principal, workspaceId, 'session-1'), { synced: 1 });
    assert.equal(sessionChecks, 2);
    assert.deepEqual(writes[0][1].where.workspaceId_jid, { workspaceId, jid: 'exact@g.us' });
    assert.deepEqual(writes[1][1].where.workspaceId_sessionId_contactId, {
      workspaceId, sessionId: 'session-1', contactId: 'contact-1',
    });
    assert.deepEqual(writes[1][1].update, {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sync aborts if the session disconnects while WaSphere metadata is loading', async () => {
  let sessionChecks = 0;
  const service = new ProjectsService({
    workspaceMember: { findUnique: async () => member() },
    $transaction: async () => { throw new Error('must not write'); },
  }, {
    assertProviderSession: async () => {},
    getDecryptedToken: async () => ({ waServerUrl: 'https://wa.example', token: 'test-token' }),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/api/sessions/session-1')) {
      sessionChecks += 1;
      return response({ status: sessionChecks === 1 ? 'connected' : 'disconnected' });
    }
    return response([{ id: 'exact@g.us', subject: 'Exact group' }]);
  };
  try {
    await assert.rejects(() => service.syncTargets(principal, workspaceId, 'session-1'), /must be connected/);
    assert.equal(sessionChecks, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sync aborts if the session changes workspace ownership while metadata is loading', async () => {
  let ownershipChecks = 0;
  const service = new ProjectsService({
    workspaceMember: { findUnique: async () => member() },
    $transaction: async (callback) => callback({}),
  }, {
    assertProviderSession: async () => {
      ownershipChecks += 1;
      if (ownershipChecks === 2) throw new Error('Session not found in this workspace');
    },
    getDecryptedToken: async () => ({ waServerUrl: 'https://wa.example', token: 'test-token' }),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/api/sessions/session-1')) return response({ status: 'connected' });
    return response([{ id: 'exact@g.us', subject: 'Exact group' }]);
  };
  try {
    await assert.rejects(() => service.syncTargets(principal, workspaceId, 'session-1'), /Session not found in this workspace/);
    assert.equal(ownershipChecks, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function existingProject(overrides = {}) {
  return {
    id: 'route-1', workspaceId, conversationId: 'conversation-1', name: 'Old name', routeKey: 'operations',
    enabled: false, createdBy: principal.userId, createdAt: new Date(), updatedAt: new Date('2026-09-21T00:00:00Z'),
    conversation: {
      id: 'conversation-1', sessionId: 'session-1', sessionDeletedAt: null,
      contact: { jid: 'old@g.us', phone: 'old@g.us', whatsappName: 'Old group', savedName: null },
    },
    ...overrides,
  };
}

test('enable rejects a concurrent confirmed retarget instead of restoring the stale chat', async () => {
  const existing = existingProject();
  const service = new ProjectsService({
    workspaceMember: { findUnique: async () => member() },
    projectRoute: { findFirst: async () => existing },
    $transaction: async (callback) => callback({
      $queryRaw: async () => [{ workspaceId }],
      workspaceMember: { findUnique: async () => member() },
      projectRoute: { updateMany: async () => ({ count: 0 }) },
    }),
  }, {
    assertProviderSession: async () => {},
    getDecryptedToken: async () => ({ waServerUrl: 'https://wa.example', token: 'test-token' }),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => url.endsWith('/groups')
    ? response([{ id: 'old@g.us', subject: 'Old group' }])
    : response({ status: 'connected' });
  try {
    await assert.rejects(() => service.update(principal, workspaceId, existing.id, { enabled: true }), /changed while this update/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('combined updates audit every change and return live availability', async () => {
  const existing = existingProject({ enabled: true });
  const updated = existingProject({
    conversationId: 'conversation-2', name: 'New name', enabled: false,
    conversation: {
      id: 'conversation-2', sessionId: 'session-2', sessionDeletedAt: null,
      contact: { jid: 'new@g.us', phone: 'new@g.us', whatsappName: 'New group', savedName: null },
    },
  });
  const actions = [];
  const service = new ProjectsService({
    workspaceMember: { findUnique: async () => member() },
    projectRoute: { findFirst: async () => existing },
    $transaction: async (callback) => callback({
      $queryRaw: async () => [{ workspaceId }],
      workspaceMember: { findUnique: async () => member() },
      contact: { upsert: async () => ({ id: 'contact-2' }) },
      conversation: { upsert: async () => ({ id: 'conversation-2' }) },
      projectRoute: {
        updateMany: async () => ({ count: 1 }),
        findFirst: async () => updated,
      },
      projectRouteAudit: { create: async ({ data }) => { actions.push(data.action); } },
    }),
  }, {
    assertProviderSession: async () => {},
    getDecryptedToken: async () => ({ waServerUrl: 'https://wa.example', token: 'test-token' }),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/groups')) return response([{ id: 'new@g.us', subject: 'New group' }]);
    if (url.endsWith('/api/sessions')) return response([{ id: 'session-2', status: 'connected' }]);
    return response({ status: 'connected' });
  };
  try {
    const result = await service.update(principal, workspaceId, existing.id, {
      name: 'New name', sessionId: 'session-2', targetJid: 'new@g.us', enabled: false, confirmed: true,
    });
    assert.deepEqual(actions, ['route.rebound', 'route.renamed', 'route.disabled']);
    assert.equal(result.availability, 'connected');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a disabled route cannot resolve for agents or outbound sends', async () => {
  let where;
  const prisma = {
    workspaceMember: { findUnique: async () => member() },
    projectRoute: { findFirst: async (args) => { where = args.where; return null; } },
  };
  const service = new InboxService(prisma, {}, {});
  await assert.rejects(() => service.listRouteMatches('operator', workspaceId, '#operations'), /not found/);
  assert.equal(where.workspaceId, workspaceId);
  assert.equal(where.enabled, true);
  assert.equal(where.routeKey, 'operations');
});

test('route lookup requires the related conversation to belong to the authenticated workspace', async () => {
  let where;
  const service = new InboxService({
    workspaceMember: { findUnique: async () => member() },
    projectRoute: { findFirst: async (args) => { where = args.where; return null; } },
  }, {}, {});

  await assert.rejects(() => service.listRouteMatches('operator', workspaceId, '#operations'), /not found/);
  assert.deepEqual(where.conversation, { is: { workspaceId } });
});

test('session-scoped route lookup rechecks provider-session ownership before querying', async () => {
  let queried = false;
  const service = new InboxService({
    workspaceMember: { findUnique: async () => member() },
    projectRoute: { findFirst: async () => { queried = true; return null; } },
  }, {
    assertProviderSession: async () => { throw new Error('Session not found in this workspace'); },
  }, {});

  await assert.rejects(
    () => service.listRouteMatches('operator', workspaceId, '#operations', 'foreign-session'),
    /Session not found in this workspace/,
  );
  assert.equal(queried, false);
});

test('reply rechecks that the conversation session still belongs to the active workspace', async () => {
  let fetched = false;
  const service = new InboxService({
    workspaceMember: { findUnique: async () => member() },
    conversation: {
      findFirst: async () => ({
        id: 'conversation-1', sessionId: 'foreign-session', sessionDeletedAt: null,
        contact: { jid: 'foreign@g.us', phone: 'foreign@g.us' },
      }),
    },
  }, {
    assertProviderSession: async () => { throw new Error('Session not found in this workspace'); },
    getDecryptedToken: async () => ({ waServerUrl: 'https://wa.example', token: 'test-token' }),
  }, {});
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetched = true;
    return response({ messageId: 'unexpected' });
  };
  try {
    await assert.rejects(
      () => service.sendReply(principal.userId, workspaceId, 'conversation-1', { text: 'hello' }),
      /Session not found in this workspace/,
    );
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('classification audit is scoped to the authenticated workspace', async () => {
  let where;
  const prisma = {
    workspaceMember: { findUnique: async () => member() },
    projectRouteAudit: { findMany: async (args) => { where = args.where; return []; } },
  };
  const service = new ProjectsService(prisma, {});
  assert.deepEqual(await service.audit(principal, workspaceId, '50'), { events: [] });
  assert.deepEqual(where, { workspaceId });
  await assert.rejects(() => service.audit(principal, workspaceId, '10000'), /limit must be between/);
});

test('classification targets only load WaSphere chats from sessions owned by the active workspace', async () => {
  const requested = [];
  const service = new ProjectsService({
    workspaceMember: { findUnique: async () => member() },
    projectRoute: { findMany: async () => [] },
    conversation: { findMany: async () => [] },
    contact: { findMany: async () => [] },
  }, {
    getDecryptedToken: async () => ({ waServerUrl: 'https://wa.example', token: 'test-token' }),
    listProviderSessionIds: async () => new Set(['owned-session']),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requested.push(url);
    if (url.endsWith('/api/sessions')) {
      return response([
        { id: 'owned-session', status: 'connected' },
        { id: 'foreign-session', status: 'connected' },
      ]);
    }
    if (url.endsWith('/api/sessions/owned-session/groups')) {
      return response([{ id: 'owned@g.us', subject: 'Owned group' }]);
    }
    if (url.endsWith('/api/sessions/foreign-session/groups')) {
      return response([{ id: 'foreign@g.us', subject: 'Foreign group' }]);
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const targets = await service.targets(principal, workspaceId, {});
    assert.deepEqual(targets.map((target) => target.jid), ['owned@g.us']);
    assert.deepEqual(await service.targets(principal, workspaceId, { sessionId: 'foreign-session' }), []);
    assert.equal(requested.some((url) => url.includes('foreign-session/groups')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('large target discovery dedupes exact IDs, preserves classification, and fetches each owned group collection once', async () => {
  const directCount = 1500;
  const contacts = [];
  const conversations = [];
  for (let index = 0; index < directCount; index += 1) {
    const jid = `direct-${index}@s.whatsapp.net`;
    const contactId = `contact-${index}`;
    contacts.push({ id: contactId, jid, phone: jid, savedName: null, whatsappName: `Direct ${index}` });
    conversations.push({
      id: `conversation-${index}`, sessionId: 'session-a', sessionDeletedAt: null, contactId,
      contact: contacts[index],
    });
  }
  const liveGroup = { id: 'live@g.us', subject: 'Live group' };
  const liveConversation = {
    id: 'conversation-live', sessionId: 'session-a', sessionDeletedAt: null, contactId: 'contact-live',
    contact: { id: 'contact-live', jid: liveGroup.id, phone: liveGroup.id, savedName: null, whatsappName: liveGroup.subject },
  };
  conversations.push(liveConversation);
  conversations.push({
    id: 'conversation-db', sessionId: 'session-a', sessionDeletedAt: null, contactId: 'contact-db',
    contact: { id: 'contact-db', jid: 'db@g.us', phone: 'db@g.us', savedName: null, whatsappName: 'Stored group' },
  });
  contacts.push(liveConversation.contact, conversations.at(-1).contact);

  const groupCalls = new Map();
  const service = new ProjectsService({
    workspaceMember: { findUnique: async () => member() },
    projectRoute: {
      findMany: async () => [
        {
          id: 'project-direct', name: 'Direct project', routeKey: 'direct-project', enabled: true,
          conversationId: 'conversation-0',
        },
        {
          id: 'project-live', name: 'Live project', routeKey: 'live-project', enabled: true,
          conversationId: 'conversation-live',
        },
      ],
    },
    conversation: { findMany: async () => conversations },
    contact: { findMany: async () => contacts },
  }, {
    getDecryptedToken: async () => ({ waServerUrl: 'https://wa.example', token: 'test-token' }),
    listProviderSessionIds: async () => new Set(['session-a', 'session-b']),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/api/sessions')) {
      return response([
        { id: 'session-a', status: 'connected' },
        { id: 'session-b', status: 'connected' },
        { id: 'foreign-session', status: 'connected' },
      ]);
    }
    const match = url.match(/\/api\/sessions\/([^/]+)\/groups$/);
    if (match) {
      const sessionId = decodeURIComponent(match[1]);
      groupCalls.set(sessionId, (groupCalls.get(sessionId) ?? 0) + 1);
      if (sessionId === 'session-a') return response([liveGroup, liveGroup]);
      if (sessionId === 'session-b') return response([liveGroup]);
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const targets = await service.targets(principal, workspaceId, {});
    const liveTargets = targets.filter((target) => target.jid === liveGroup.id);
    const directProject = targets.find((target) => target.jid === 'direct-0@s.whatsapp.net');
    const sessionAProject = liveTargets.find((target) => target.sessionId === 'session-a');
    const sessionBProject = liveTargets.find((target) => target.sessionId === 'session-b');

    assert.equal(targets.length, directCount + 3);
    assert.equal(liveTargets.length, 2);
    assert.equal(directProject.assignedProject.routeKey, 'direct-project');
    assert.equal(sessionAProject.assignedProject.routeKey, 'live-project');
    assert.equal(sessionBProject.assignedProject, null);
    assert.equal(targets.some((target) => target.sessionId === 'foreign-session'), false);
    assert.deepEqual(Object.fromEntries(groupCalls), { 'session-a': 1, 'session-b': 1 });

    const searched = await service.targets(principal, workspaceId, { q: 'session-b' });
    assert.deepEqual(searched.map((target) => target.jid), ['live@g.us']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
