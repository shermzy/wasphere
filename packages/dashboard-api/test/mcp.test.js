const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { CombinedAuthGuard } = require('../dist/auth/combined-auth.guard.js');
const { McpController } = require('../dist/mcp/mcp.controller.js');
const { McpService } = require('../dist/mcp/mcp.service.js');

async function connectMcp(
  inbox,
  permissions = ['messages:read', 'messages:send'],
  { userId = 'user-id', workspaceId = 'workspace-id', apiKeyId = 'api-key-id', sessionScope = null } = {},
) {
  const service = new McpService(inbox);
  const server = service.createServer({
    userId,
    workspaceId,
    apiKeyId,
    permissions,
    sessionScope,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test('MCP HTTP initialization responds with an SSE content type', async () => {
  const controller = new McpController(new McpService({}));
  const httpServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    req.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    req.user = {
      userId: 'user-id',
      workspaceId: 'workspace-id',
      apiKeyId: 'api-key-id',
      permissions: ['messages:read'],
      sessionScope: null,
    };
    await controller.handle(req, res);
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');

  try {
    const address = httpServer.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'sse-test-client', version: '1.0.0' },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    const contentType = response.headers.get('content-type') ?? '';
    await response.body?.cancel();
    assert.match(contentType, /^text\/event-stream\b/);
  } finally {
    httpServer.closeAllConnections();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('exposes route resolution and project update tools through MCP', async () => {
  const calls = [];
  const inbox = {
    listRouteMatches: async (...args) => {
      calls.push(['resolve', ...args]);
      return [{
        id: 'conversation-id',
        sessionId: 'main',
        status: 'open',
        sessionDeletedAt: null,
        contact: { name: 'Fairbreeze', jid: '123@g.us' },
      }];
    },
    sendToRoute: async (...args) => {
      calls.push(['send', ...args]);
      return { id: 'message-id' };
    },
  };
  const { client, server } = await connectMcp(inbox);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ['resolve_project_route', 'send_project_update'],
  );

  const resolved = await client.callTool({
    name: 'resolve_project_route',
    arguments: { routeKey: '#FairBreeze' },
  });
  assert.equal(resolved.isError, undefined);
  assert.match(resolved.content[0].text, /Fairbreeze/);
  assert.equal(calls[0][1], 'user-id');
  assert.equal(calls[0][2], 'workspace-id');
  assert.equal(calls[0][3], 'fairbreeze');
  assert.equal(calls[0][4], null);

  const sent = await client.callTool({
    name: 'send_project_update',
    arguments: { routeKey: '#FairBreeze', text: 'Status update' },
  });
  assert.equal(sent.isError, undefined);
  assert.match(sent.content[0].text, /message-id/);
  const sendCall = calls.find(([kind]) => kind === 'send');
  assert.equal(sendCall[2], 'workspace-id');
  assert.equal(sendCall[3], 'fairbreeze');
  assert.deepEqual(sendCall[4], { kind: 'text', text: 'Status update' });
  assert.equal(sendCall[5], null);

  await client.close();
  await server.close();
});

test('API-key authentication rejects a different workspace before controller execution', async () => {
  const guard = new CombinedAuthGuard({
    validateApiKey: async () => ({
      userId: 'owner-id',
      workspaceId: 'workspace-a',
      apiKeyId: 'key-id',
      permissions: ['messages:read'],
      sessionScope: null,
    }),
  });
  const request = {
    headers: { authorization: 'Bearer wsk_cross_workspace_test' },
    params: { workspaceId: 'workspace-b' },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  };

  await assert.rejects(
    () => guard.canActivate(context),
    /API key is not authorized for this workspace/,
  );
});

test('invalid API-key authentication advertises the Bearer challenge', async () => {
  const guard = new CombinedAuthGuard({
    validateApiKey: async () => null,
  });
  const request = {
    headers: { authorization: 'Bearer wsk_invalid_test' },
    params: {},
  };
  const responseHeaders = {};
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({
        setHeader: (name, value) => { responseHeaders[name] = value; },
      }),
    }),
  };

  await assert.rejects(
    () => guard.canActivate(context),
    /Invalid or expired API key/,
  );
  assert.equal(responseHeaders['WWW-Authenticate'], 'Bearer realm="wasphere"');
});

test('does not send when the API key lacks messages:send', async () => {
  let sendCalls = 0;
  const inbox = {
    listRouteMatches: async () => [{ id: 'conversation-id', sessionId: 'main', sessionDeletedAt: null, contact: { name: 'Fairbreeze', jid: '123@g.us' } }],
    sendToRoute: async () => {
      sendCalls += 1;
      return { id: 'should-not-send' };
    },
  };
  const { client, server } = await connectMcp(inbox, ['messages:read']);

  const result = await client.callTool({
    name: 'send_project_update',
    arguments: { routeKey: '#fairbreeze', text: 'Blocked update' },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /messages:send/);
  assert.equal(sendCalls, 0);

  await client.close();
  await server.close();
});

test('strictly rejects unknown tools and caller-supplied workspace arguments', async () => {
  let calls = 0;
  const inbox = {
    listRouteMatches: async () => {
      calls += 1;
      return [];
    },
    sendToRoute: async () => ({ id: 'unexpected' }),
  };
  const { client, server } = await connectMcp(inbox, ['messages:read']);

  const unknown = await client.callTool({ name: 'unknown_tool', arguments: {} });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /not found/i);
  const injected = await client.callTool({
    name: 'resolve_project_route',
    arguments: { routeKey: '#a', workspaceId: 'workspace-b' },
  });
  assert.equal(injected.isError, true);
  assert.match(injected.content[0].text, /Invalid arguments/i);
  assert.equal(calls, 0);

  await client.close();
  await server.close();
});

test('isolates two workspaces for route reads and sends', async () => {
  const sends = [];
  const routes = [
    { workspaceId: 'workspace-id', routeKey: 'shared', id: 'conversation-a', sessionId: 'session-a' },
    { workspaceId: 'workspace-b', routeKey: 'shared', id: 'conversation-b', sessionId: 'session-b' },
    { workspaceId: 'workspace-b', routeKey: 'only-b', id: 'conversation-b-only', sessionId: 'session-b' },
  ];
  const inbox = {
    listRouteMatches: async (userId, workspaceId, routeKey, sessionScope) => {
      const route = routes.find((candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.routeKey === routeKey &&
        (sessionScope === null || candidate.sessionId === sessionScope));
      if (!route) return [];
      return [{
        id: route.id,
        sessionId: route.sessionId,
        sessionDeletedAt: null,
        contact: { name: route.id, jid: `${route.id}@g.us` },
      }];
    },
    sendToRoute: async (...args) => {
      sends.push(args);
      return { id: 'message-in-workspace' };
    },
  };
  const a = await connectMcp(inbox);
  const b = await connectMcp(inbox, ['messages:read', 'messages:send'], { workspaceId: 'workspace-b' });

  const readA = await a.client.callTool({ name: 'resolve_project_route', arguments: { routeKey: '#shared' } });
  assert.match(readA.content[0].text, /conversation-a/);
  const readBOnlyFromA = await a.client.callTool({ name: 'resolve_project_route', arguments: { routeKey: '#only-b' } });
  assert.equal(readBOnlyFromA.isError, true);
  const sentBOnlyFromA = await a.client.callTool({ name: 'send_project_update', arguments: { routeKey: '#only-b', text: 'must not send' } });
  assert.equal(sentBOnlyFromA.isError, true);
  assert.equal(sends.length, 0);
  const sentA = await a.client.callTool({ name: 'send_project_update', arguments: { routeKey: '#shared', text: 'A only' } });
  assert.equal(sentA.isError, undefined);
  assert.equal(sends.length, 1);
  assert.equal(sends[0][1], 'workspace-id');
  assert.equal(sends[0][2], 'shared');

  const readB = await b.client.callTool({ name: 'resolve_project_route', arguments: { routeKey: '#shared' } });
  assert.match(readB.content[0].text, /conversation-b/);

  await a.client.close();
  await a.server.close();
  await b.client.close();
  await b.server.close();
});

test('session-scoped keys cannot read or send through another session', async () => {
  let sendCalls = 0;
  const inbox = {
    listRouteMatches: async (_userId, workspaceId, routeKey, sessionScope) => {
      if (workspaceId !== 'workspace-id') return [];
      const route = routeKey === 'scoped' && sessionScope === 'session-a'
        ? { id: 'conversation-a', sessionId: 'session-a' }
        : null;
      return route ? [{ ...route, sessionDeletedAt: null, contact: { name: 'A', jid: 'a@g.us' } }] : [];
    },
    sendToRoute: async () => {
      sendCalls += 1;
      return { id: 'sent' };
    },
  };
  const service = new McpService(inbox);
  const scopedServer = service.createServer({
    userId: 'user-id',
    workspaceId: 'workspace-id',
    apiKeyId: 'scoped-key',
    permissions: ['messages:read', 'messages:send'],
    sessionScope: 'session-a',
  });
  const [scopedClientTransport, scopedServerTransport] = InMemoryTransport.createLinkedPair();
  const scopedClient = new Client({ name: 'scoped-client', version: '1.0.0' });
  await scopedServer.connect(scopedServerTransport);
  await scopedClient.connect(scopedClientTransport);

  const blockedRead = await scopedClient.callTool({ name: 'resolve_project_route', arguments: { routeKey: '#other-session' } });
  assert.equal(blockedRead.isError, true);
  const blockedSend = await scopedClient.callTool({ name: 'send_project_update', arguments: { routeKey: '#other-session', text: 'must not send' } });
  assert.equal(blockedSend.isError, true);
  const valid = await scopedClient.callTool({ name: 'send_project_update', arguments: { routeKey: '#scoped', text: 'allowed' } });
  assert.equal(valid.isError, undefined);
  assert.equal(sendCalls, 1);

  await scopedClient.close();
  await scopedServer.close();
});

test('fails closed when a route changes between authorization reads', async () => {
  let reads = 0;
  let sendCalls = 0;
  const inbox = {
    listRouteMatches: async () => {
      reads += 1;
      const id = reads === 1 ? 'conversation-before' : 'conversation-after';
      return [{ id, sessionId: 'main', sessionDeletedAt: null, contact: { name: 'Route', jid: `${id}@g.us` } }];
    },
    sendToRoute: async () => {
      sendCalls += 1;
      return { id: 'unexpected' };
    },
  };
  const { client, server } = await connectMcp(inbox);
  const result = await client.callTool({ name: 'send_project_update', arguments: { routeKey: '#route', text: 'must not send' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /changed/);
  assert.equal(sendCalls, 0);
  await client.close();
  await server.close();
});
