const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
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
  assert.equal(calls[0][3], 'fairbreeze');

  const sent = await client.callTool({
    name: 'send_project_update',
    arguments: { routeKey: '#FairBreeze', text: 'Status update' },
  });
  assert.equal(sent.isError, undefined);
  assert.match(sent.content[0].text, /message-id/);
  assert.equal(calls[1][0], 'send');
  assert.equal(calls[1][3], 'fairbreeze');
  assert.deepEqual(calls[1][4], { kind: 'text', text: 'Status update' });

  await client.close();
  await server.close();
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
