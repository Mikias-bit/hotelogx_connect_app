import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPmsAiTools } from '../modules/pms/pmsAiTools.js';

const context = { hotelId: 'hotel-a', conversationId: 'conversation-a', messageText: 'Please add two breakfasts tomorrow at 8am', env: { OPENAI_API_KEY: 'test' } };
function setup(answers) {
  const calls = [];
  const client = {
    listConversationTools: async () => ({ tools: ['search_upsell_products', 'quote_upsell', 'charge_card'].map(name => ({ name, inputSchema: { type: 'object' } })) }),
    callConversationTool: async (ctx, name, args) => {
      assert.deepEqual(ctx, { hotelId: 'hotel-a', conversationId: 'conversation-a' }); calls.push({ name, args });
      return { structuredContent: name === 'search_upsell_products' ? { products: [{ product_id: 'p-a', unit_amount: '20.00', currency: 'EUR' }] } : { status: 'offered', reply_text: 'Exact quote 40.00 EUR. ACCEPT ABCDEF123456' } };
    },
  };
  const request = async (_, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.parallel_tool_calls, false);
    assert(!body.tools.some(t => t.function.name === 'charge_card'));
    return { ok: true, json: async () => ({ choices: [{ message: answers.shift() }] }) };
  };
  return { client, request, calls };
}
const call = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'call-a', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
test('OpenAI searches approved MCP tools then returns the exact authoritative quote', async () => {
  const fixture = setup([call('search_upsell_products', { query: 'breakfast' }), call('quote_upsell', { product_id: 'p-a', quantity: 2, consumption_utc: '2026-10-27T08:00:00Z' })]);
  const result = await runPmsAiTools({ ...context, ...fixture });
  assert.equal(result.replyText, 'Exact quote 40.00 EUR. ACCEPT ABCDEF123456');
  assert.deepEqual(fixture.calls.map(c => c.name), ['search_upsell_products', 'quote_upsell']);
});
test('model cannot supply hotel/reservation/price overrides or call the write tool directly', async () => {
  for (const answer of [call('quote_upsell', { product_id: 'p-a', quantity: 2, consumption_utc: 'x', price: 1, hotelId: 'other' }), call('post_accepted_upsell', { offer_id: 'abcdef123456' }), call('charge_card', {})]) {
    const fixture = setup([answer]);
    assert.equal((await runPmsAiTools({ ...context, ...fixture })).status, 'staff_check');
    assert.equal(fixture.calls.length, 0);
  }
});
test('exact guest acceptance invokes the guarded write once without letting OpenAI invent success', async () => {
  let count = 0;
  const result = await runPmsAiTools({ ...context, messageText: 'ACCEPT ABCDEF123456', client: {
    callConversationTool: async (ctx, name, args) => { count++; assert.equal(name, 'post_accepted_upsell'); assert.equal(args.offer_id, 'abcdef123456'); throw new Error('timeout after write'); },
  }, request: () => { throw new Error('OpenAI must not run for exact acceptance'); } });
  assert.equal(count, 1); assert.equal(result.status, 'staff_check');
});
