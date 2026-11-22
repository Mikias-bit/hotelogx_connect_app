import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createGuestWelcomeRouter } from '../modules/pms/guestWelcomeRoutes.js';

test('welcome settings and contact verification require staff authority, explicit confirmation and live PMS ownership', async () => {
  let role = 'front-office', state = 'Started';
  const seen = [], writes = [], external = [];
  const db = {
    $executeRaw: async () => {}, $transaction: async fn => fn(db),
    guestMessagingConfig: { findUnique: async ({ where }) => { seen.push(where); return { hotelId: 'hotel-a', welcomeEnabled: false }; },
      update: async args => { writes.push(args); return args.data; } },
    guestWelcome: { findMany: async ({ where }) => { seen.push(where); return [{ id: 'w', replyTokenHash: 'secret' }]; } },
    guestContactVerification: { findMany: async ({ where }) => { seen.push(where); return []; },
      findFirst: async ({ where }) => { seen.push(where); return null; },
      upsert: async ({ create }) => { writes.push(create); return create; } },
  };
  const app = express(); app.use(express.json()); app.use(createGuestWelcomeRouter({ db,
    authenticateStaff: (req, res, next) => { req.user = { id: 'staff', role, hotelId: 'hotel-a' }; next(); },
    readerFor: async config => { assert.equal(config.hotelId, 'hotel-a'); return {
      reservation: async id => id === 'stay' ? { Id: id, AccountId: 'customer', AccountType: 'Customer', State: state, ScheduledEndUtc: '2099-01-01T12:00:00Z' } : null,
      customer: async () => ({ Phone: '+31612345678', Email: 'guest@example.com' }),
    }; },
    welcomeFor: () => ({ recordExternal: async (actor, input) => { external.push({ actor, input }); return input; } }),
  }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://localhost:${server.address().port}`;
  const send = (path, body, method = 'POST') => fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const body = await (await fetch(url + '/?hotelId=other')).json(); assert.equal(body.data.welcomes[0].replyTokenHash, undefined);
    role = 'housekeeping'; assert.equal((await fetch(url)).status, 403);
    role = 'front-office'; assert.equal((await send('/config', {}, 'PUT')).status, 409);
    const contact = { reservationId: 'stay', channel: 'whatsapp', contact: '+31612345678', hotelId: 'other' };
    assert.equal((await send('/verify-contact', contact)).status, 409);
    assert.equal((await send('/verify-contact', { ...contact, identityAndContactConfirmed: true, contact: '+31699999999' })).status, 409);
    state = 'Confirmed'; assert.equal((await send('/verify-contact', { ...contact, identityAndContactConfirmed: true })).status, 409);
    state = 'Started'; assert.equal((await send('/verify-contact', { ...contact, identityAndContactConfirmed: true })).status, 200);
    assert.equal(writes[0].hotelId, 'hotel-a'); assert.equal(writes[0].customerId, 'customer');
    assert.equal((await send('/contacts/other-hotel-proof/revoke', {})).status, 409);
    assert.equal((await send('/record-external', { reservationId: 'stay', stage: 'confirmation' })).status, 409);
    assert.equal((await send('/record-external', { reservationId: 'stay', stage: 'confirmation', sentConfirmed: true, hotelId: 'other' })).status, 200);
    assert.equal(external[0].actor.hotelId, 'hotel-a');
    role = 'manager';
    const config = { enabled: true, welcomeUpsells: true, confirmationSender: 'hotelogx', checkinSender: 'hotelogx', arrivalInstructions: '', onlineCheckinUrl: '', catalogueUrl: '', bookingWelcomeTemplate: '', checkinWelcomeTemplate: '' };
    assert.equal((await send('/config', config, 'PUT')).status, 409);
    assert.equal((await send('/config', { ...config, senderResponsibilityConfirmed: true, onlineCheckinUrl: 'http://unsafe.example' }, 'PUT')).status, 409);
    assert.equal((await send('/config', { ...config, senderResponsibilityConfirmed: true }, 'PUT')).status, 200);
    assert(writes.at(-1).data.welcomeSince); assert.equal(writes.at(-1).where.hotelId, 'hotel-a');
    assert(seen.every(where => where.hotelId === 'hotel-a'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
