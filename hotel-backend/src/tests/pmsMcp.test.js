import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createPmsMcpClient } from '../modules/pms/pmsMcpClient.js';

test('MCP client binds hotel identity to the authenticated actor and uses separate Google IAM auth', async () => {
  const key = 'test-key'.repeat(8), calls = [];
  const client = createPmsMcpClient({ env: { PMS_MCP_URL: 'https://example-ab-ez.a.run.app', PMS_MCP_CONTEXT_KEY: key }, identityToken: async audience => { assert.equal(audience, 'https://example-ab-ez.a.run.app'); return 'google-id'; }, request: async (url, options) => {
    assert.equal(url, 'https://example-ab-ez.a.run.app/mcp');
    assert.equal(options.headers['X-Serverless-Authorization'], 'Bearer google-id');
    const claims = jwt.verify(options.headers.Authorization.slice(7), key, { audience: 'hotelogx-pms-mcp', issuer: 'hotelogx-connect-backend' });
    assert.equal(claims.hotel_id, 'hotel-a'); assert.equal(claims.sub, 'staff-a');
    assert.equal(claims.exp - claims.iat, 120);
    const body = JSON.parse(options.body); calls.push(body.method);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result: body.method === 'initialize' ? { protocolVersion: '2025-03-26' } : { content: [] } }) };
  } });
  await client.callTool({ id: 'staff-a', hotelId: 'hotel-a', role: 'manager' }, 'check_connection');
  assert.deepEqual(calls, ['initialize', 'notifications/initialized', 'tools/call']);
  assert.throws(() => client.callTool({ role: 'housekeeping' }, 'get_payments'), /denied/);
  assert.throws(() => client.callTool({}, 'charge_card'), /Unsupported/);
  await assert.rejects(client.listTools({ role: 'guest', hotelId: 'hotel-a', id: 'guest' }), /staff/);
});

test('conversation tokens bind the subject and restrict discovery calls to approved tools', async () => {
  const key = 'test-key'.repeat(8);
  const client = createPmsMcpClient({ env: { PMS_MCP_URL: 'https://example-ab-ez.a.run.app', PMS_MCP_CONTEXT_KEY: key }, identityToken: async () => 'google-id', request: async (_, options) => {
    const claims = jwt.verify(options.headers.Authorization.slice(7), key);
    assert.equal(claims.role, 'conversation'); assert.equal(claims.sub, 'conversation-a');
    assert.equal(claims.conversation_id, 'conversation-a'); assert.equal(claims.hotel_id, 'hotel-a');
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: body.id, result: body.method === 'initialize' ? { protocolVersion: '2025-03-26' } : { tools: [] } }) };
  } });
  const context = { hotelId: 'hotel-a', conversationId: 'conversation-a' };
  await client.listConversationTools(context);
  assert.throws(() => client.callConversationTool(context, 'get_guest_details', {}), /not allowed/);
  assert.throws(() => client.callConversationTool(context, 'get_payments', {}), /not allowed/);
});
