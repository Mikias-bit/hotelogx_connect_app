import jwt from 'jsonwebtoken';

const conversationTools = new Set(['search_upsell_products', 'get_my_reservation', 'quote_upsell', 'post_accepted_upsell']);
const tools = new Set(['check_connection', 'get_reservations', 'get_guest_details', 'get_arrivals', 'get_departures', 'get_rooms', 'get_bills', 'get_payments', 'get_availability', 'get_products', ...conversationTools]);
const protocol = '2025-03-26';

export function createPmsMcpClient({ env = process.env, request = fetch, identityToken } = {}) {
  const base = (env.PMS_MCP_URL || '').replace(/\/$/, '');
  const key = env.PMS_MCP_CONTEXT_KEY;
  async function call(user, method, params, conversationId = null, automated = false) {
    if (!user?.id || !user?.hotelId || !(automated ? user.role === 'conversation' && user.id === conversationId : ['manager', 'front-office', 'housekeeping'].includes(user.role))) throw new Error('Authenticated hotel staff context is required');
    if (!/^https:\/\/[a-z0-9-]+\.a\.run\.app$/.test(base) || !key || key.length < 32) throw new Error('PMS MCP service is not configured');
    const contextToken = jwt.sign({ hotel_id: user.hotelId, role: user.role, ...(conversationId ? { conversation_id: conversationId } : {}) }, key, { algorithm: 'HS256', subject: user.id, issuer: 'hotelogx-connect-backend', audience: 'hotelogx-pms-mcp', expiresIn: 120 });
    let googleToken;
    if (identityToken) googleToken = await identityToken(base);
    else {
      const metadata = await request(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(base)}&format=full`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!metadata.ok) throw new Error('Cloud Run caller identity is unavailable');
      googleToken = await metadata.text();
    }
    const headers = { Authorization: `Bearer ${contextToken}`, 'X-Serverless-Authorization': `Bearer ${googleToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': protocol };
    async function rpc(id, operation, args) {
      const response = await request(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method: operation, params: args }), redirect: 'error', signal: AbortSignal.timeout(90000) });
      if (!response.ok) throw new Error(`PMS MCP request failed (HTTP ${response.status})`);
      if (id === undefined) return;
      const body = await response.json();
      if (body.error || body.id !== id || !body.result) throw new Error('PMS MCP protocol request failed');
      return body.result;
    }
    const initialized = await rpc(1, 'initialize', { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'hotelogx-connect-backend', version: '1.0.0' } });
    if (initialized.protocolVersion !== protocol) throw new Error('Unsupported PMS MCP protocol version');
    await rpc(undefined, 'notifications/initialized', {});
    return rpc(2, method, params);
  }
  return {
    matchGuestForVerification: ({ hotelId, conversationId }, args) => call(
      { id: conversationId, hotelId, role: 'conversation' }, 'tools/call',
      { name: 'match_guest_for_verification', arguments: args }, conversationId, true),
    callConversationTool: ({ hotelId, conversationId }, name, args = {}) => {
      if (!conversationTools.has(name)) throw new Error('Tool is not allowed in guest conversations');
      return call({ id: conversationId, hotelId, role: 'conversation' }, 'tools/call', { name, arguments: args }, conversationId, true);
    },
    listConversationTools: ({ hotelId, conversationId }) => call({ id: conversationId, hotelId, role: 'conversation' }, 'tools/list', {}, conversationId, true),
    callStaffConversationTool: (user, conversationId, name, args = {}) => {
      if (!['manager', 'front-office'].includes(user?.role) || !conversationTools.has(name)) throw new Error('Staff tool access denied');
      return call(user, 'tools/call', { name, arguments: args }, conversationId);
    },
    listTools: user => call(user, 'tools/list', {}),
    callTool: (user, name, args = {}) => {
      if (!tools.has(name)) throw new Error('Unsupported PMS tool');
      if (user?.role === 'housekeeping' && !['get_rooms', 'check_connection'].includes(name)) throw new Error('PMS tool access denied');
      // The user must be obtained from backend authentication, never request body/tool input.
      return call(user, 'tools/call', { name, arguments: args });
    },
  };
}
