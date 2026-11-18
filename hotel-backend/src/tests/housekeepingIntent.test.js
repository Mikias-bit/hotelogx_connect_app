import { test } from 'node:test';
import assert from 'node:assert/strict';
import { housekeepingDelivery, housekeepingRoomQuestion, resumeHousekeepingRoom, resolveHousekeepingFollowUp, roomReply } from '../modules/conversations/housekeepingIntent.js';
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

const now = Date.parse('2026-11-18T12:00:00Z');
const row = (author, body, age = 1000) => ({ author, body, createdAt: new Date(now - age).toISOString(), deliveryStatus: 'sent' });
const question = () => row('ai', 'Certainly. Which room should we arrange this for?');

test('a short room answer resumes the towel request, quantity and timing', async () => {
  for (const answer of ['307', 'Room 307', 'my room is 307', "it's 307", '307, thanks']) {
    const resumed = resumeHousekeepingRoom(answer, [row('guest', answer, 0), question(), row('guest', 'Please bring 2 towels after 6pm', 2000)], now);
    assert.equal(resumed, 'Room 307. Please bring 2 towels after 6pm');
    assert.ok(housekeepingDelivery(resumed));
    const result = await runPmsAiTools({ messageText: resumed, client: {}, verification: { shouldVerify: () => assert.fail('Do not start PMS verification for towels') } });
    assert.equal(result, null);
  }
});

test('room corrections resume only the same pending request and validate the supplied room', async () => {
  const invalid = await housekeepingRoomQuestion({ room: { findFirst: async () => null } }, 'h', '2008');
  const resumed = resumeHousekeepingRoom('307', [row('ai', invalid), row('guest', '2008', 2000), question(), row('guest', 'Need an extra duvet', 3000)], now);
  assert.equal(resumed, 'Room 307. Need an extra duvet');
  const direct = resumeHousekeepingRoom('307', [row('ai', invalid), row('guest', 'Need towels for room 2008', 2000)], now);
  assert.match(direct, /^Room 307\./); assert.doesNotMatch(direct, /2008/);
});

test('bare numbers do not revive old, completed, failed, interrupted or unrelated requests', () => {
  const original = row('guest', 'Please bring towels', 2000);
  const histories = [
    [row('ai', 'Your housekeeping request has been recorded.'), original],
    [row('staff', 'Which room?'), original],
    [{ ...question(), deliveryStatus: 'failed' }, original],
    [row('ai', question().body, 31 * 60000), original],
    [question(), row('guest', 'Cancel the towels')],
    [row('guest', 'What time is breakfast?'), question(), original],
    [question(), row('guest', 'My reservation number is 123456')],
    [row('system', 'Conversation resolved'), question(), original],
  ];
  for (const history of histories) assert.equal(resumeHousekeepingRoom('307', history, now), null);
  for (const answer of ['123456', '307 and cancel my booking', 'What time is breakfast?', '2']) assert.equal(roomReply(answer), null);
});

test('follow-up retrieval is restricted to the authenticated hotel, conversation and channel', async () => {
  const db = { message: { findMany: async ({ where }) => {
    assert.deepEqual(where, { conversationId: 'c', channel: 'whatsapp', conversation: { guest: { hotelId: 'h' } } });
    const createdAt = new Date().toISOString();
    return [{ ...question(), createdAt }, { ...row('guest', 'Extra towels please'), createdAt }];
  } } };
  assert.equal(await resolveHousekeepingFollowUp(db, { hotelId: 'h', conversationId: 'c', channel: 'whatsapp', messageText: '307' }), 'Room 307. Extra towels please');
  assert.equal(await resolveHousekeepingFollowUp({}, { messageText: 'Hello' }), 'Hello');
});
