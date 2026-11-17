import test from 'node:test';
import assert from 'node:assert/strict';
import { createHotelInformationAnswerer, isHotelInformationQuestion } from '../modules/conversations/hotelInformation.js';

test('breakfast hours and price are information, mixed arrangements are not', () => {
  assert.equal(isHotelInformationQuestion('What time does breakfast end? How much per person'), true);
  for (const text of ['What time is breakfast? Add it for two people', 'Please confirm breakfast', 'I want duvet extra for room 2008']) {
    assert.equal(isHotelInformationQuestion(text), false);
  }
});

test('reservation questions use only the verified PMS reader and missing facts escalate', async () => {
  let stay = { ScheduledEndUtc: '2026-11-20T10:00:00Z' }, escalations = 0, reads = 0, complete = true;
  const answer = createHotelInformationAnswerer({
    policy: async () => ({ requiresApproval: false }),
    retrieve: async () => ({ contextText: 'Hotel check-out is at 11.' }),
    reservation: async context => { assert.equal(context.hotelId, 'hotel-a'); assert.equal(context.conversationId, 'conversation-a'); reads++; return stay; },
    onMissing: async () => { escalations++; },
    generate: async ({ prompt }) => {
      assert.deepEqual(JSON.parse(prompt).verifiedReservation, stay);
      return JSON.stringify({ informationOnly: true, complete, answer: 'Your departure date is 20 November.' });
    },
  });
  const args = { hotelId: 'hotel-a', conversationId: 'conversation-a', messageText: 'What is my reservation departure date?' };
  assert.equal(await answer(args), 'Your departure date is 20 November.');
  assert.equal(escalations, 0); assert.equal(reads, 1);
  complete = false; assert.match(await answer(args), /20 November.*Front Office/); assert.equal(escalations, 1);
  stay = null; assert.match(await answer(args), /Front Office/); assert.equal(escalations, 2);
});

test('public information does not access reservations and unavailable knowledge escalates', async () => {
  let escalations = 0;
  const answer = createHotelInformationAnswerer({
    policy: async () => ({ requiresApproval: false }), retrieve: async () => null,
    reservation: async () => { assert.fail('Public question must not access PMS guest data'); },
    generate: async () => { assert.fail('No facts to generate from'); },
    onMissing: async () => { escalations++; },
  });
  assert.match(await answer({ hotelId: 'hotel-a', messageText: 'What time does breakfast end?' }), /Front Office/);
  assert.equal(escalations, 1);
});

test('failed policy checks never authorize a reply or an information handoff', async () => {
  const answer = createHotelInformationAnswerer({
    policy: async () => { throw new Error('Unavailable'); },
    onMissing: async () => { assert.fail('Policy check did not authorize processing'); },
  });
  assert.equal(await answer({ hotelId: 'hotel-a', messageText: 'What time is breakfast?' }), null);
});

test('information answer uses tenant knowledge and respects policy and generation failures', async () => {
  let blocked = false, raw = '{"informationOnly":true,"complete":true,"answer":"Breakfast ends at 10. The price is not listed."}', calls = 0;
  const answer = createHotelInformationAnswerer({
    policy: async () => ({ requiresApproval: blocked }),
    retrieve: async hotelId => { assert.equal(hotelId, 'hotel-a'); calls++; return { contextText: 'Breakfast ends at 10.' }; },
    generate: async ({ prompt }) => { assert.equal(JSON.parse(prompt).hotelFacts, 'Breakfast ends at 10.'); return raw; },
  });
  const args = { hotelId: 'hotel-a', messageText: 'What time does breakfast end?' };
  assert.match(await answer(args), /price is not listed/);
  blocked = true; assert.equal(await answer(args), null); assert.equal(calls, 1);
  blocked = false; raw = '{"informationOnly":false}'; assert.equal(await answer(args), null);
  raw = 'invalid'; assert.equal(await answer(args), null);
  assert.equal(await answer({ ...args, messageText: 'Book breakfast please' }), null);
});
