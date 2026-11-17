import { test } from 'node:test';
import assert from 'node:assert/strict';
import { housekeepingDelivery, housekeepingRoomQuestion } from '../modules/conversations/housekeepingIntent.js';
import { runPmsAiTools } from '../modules/pms/pmsAiTools.js';

test('ordinary bedding requests tolerate word order and common typos without rewriting room numbers', () => {
  for (const text of ['I want duvet extra for room 2008', 'Room 2008 extra duve please', 'I need pilow room 2008', 'Extra towls room 2008']) {
    const result = housekeepingDelivery(text);
    assert.ok(result); assert.match(result.normalized, /2008/);
  }
  for (const text of ['I want an extra bed', 'What is the price of a pillow?', 'I do not need a duvet', 'Buy a duvet', 'Extra wine please']) assert.equal(housekeepingDelivery(text), null);
});

test('bedding requests bypass PMS even after earlier booking or upsell questions', async () => {
  const forbidden = () => { throw new Error('Routine housekeeping must not enter PMS'); };
  for (const messageText of ['I want duvet extra for room 2008', 'Room 208 extra duve please', 'Need extra pilow']) {
    assert.equal(await runPmsAiTools({ hotelId: 'h', conversationId: 'c', messageText,
      history: [{ author: 'ai', body: 'Which product, quantity and consumption date would you like? New booking quote.' }],
      client: { callConversationTool: forbidden, listConversationTools: forbidden }, request: forbidden,
      verification: { shouldVerify: forbidden }, env: {} }), null);
  }
});


test('room clarification checks the exact room in this hotel without correcting 2008 to 208', async () => {
  const db = { room: { findFirst: async ({ where }) => { assert.equal(where.hotelId, 'h'); return where.number === '208' ? { number: '208' } : null; } } };
  assert.match(await housekeepingRoomQuestion(db, 'h', '2008'), /confirm your room number/);
  assert.equal(await housekeepingRoomQuestion(db, 'h', '208'), null);
  assert.match(await housekeepingRoomQuestion(db, 'h', 'not provided'), /Which room/);
});
