const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { CombinedAuthGuard } = require('../dist/auth/combined-auth.guard.js');
const { McpController } = require('../dist/mcp/mcp.controller.js');
const { McpService } = require('../dist/mcp/mcp.service.js');

async function connectMcp(inbox, permissions = ['messages:read', 'messages:send']) {
  const service = new McpService(inbox);
  const server = service.createServer({
    userId: 'user-id',
    workspaceId: 'workspace-id',
    apiKeyId: 'api-key-id',
    permissions,
    sessionScope: null,
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
  assert.equal(calls[1][0], 'send');
  assert.equal(calls[1][2], 'workspace-id');
  assert.equal(calls[1][3], 'fairbreeze');
  assert.deepEqual(calls[1][4], { kind: 'text', text: 'Status update' });
  assert.equal(calls[1][5], null);

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

test('does not send when the API key lacks messages:send', async () => {
  let sendCalls = 0;
  const inbox = {
    listRouteMatches: async () => [{ id: 'conversation-id', sessionId: 'main', contact: { name: 'Fairbreeze', jid: '123@g.us' } }],
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
