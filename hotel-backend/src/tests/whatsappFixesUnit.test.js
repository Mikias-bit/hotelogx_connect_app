import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../app.js';
import { prisma } from '../config/database.js';
import {
  generateOAuthState,
  verifyOAuthState,
  generateWhatsAppOnboardingToken,
  setTokenStorageDriver,
  clearTokenMemory,
  isTokenConsumedPersistent,
  consumeTokenPersistent,
} from '../utils/tokenCrypto.js';
import { sendMetaWhatsAppMessage, sendWhatsAppTemplate, sanitizePhoneNumber } from '../modules/whatsapp/whatsappController.js';
import { exchangeMetaCodeForToken } from '../modules/whatsapp/whatsappOAuth.js';
import { signToken } from '../utils/jwt.js';

process.env.NODE_ENV = 'test';

describe('WhatsApp Fixes Specific Regression Test Suite', () => {
  let server;
  let baseUrl;
  const hotelIdA = 'hotel-wa-unit-a';
  const hotelIdB = 'hotel-wa-unit-b';
  let tokenA;

  const mockDurableStore = {
    records: new Map(),
    async hasToken(tokenHash) {
      const rec = this.records.get(tokenHash);
      if (!rec) return false;
      if (Date.now() > rec.expiresAt.getTime()) {
        this.records.delete(tokenHash);
        return false;
      }
      return true;
    },
    async insertToken(record) {
      if (this.records.has(record.tokenHash)) {
        const err = new Error(`Duplicate entry '${record.tokenHash}' for key 'ConsumedOAuthToken.tokenHash'`);
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      this.records.set(record.tokenHash, record);
    },
  };

  before(async () => {
    setTokenStorageDriver(mockDurableStore);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api`;

    // Seed test hotels
    await prisma.hotel.upsert({
      where: { id: hotelIdA },
      update: {},
      create: {
        id: hotelIdA,
        name: 'Unit Alpha Hotel',
        legalName: 'Unit Alpha BV',
        address: 'Alpha Str 1',
        postcode: '1000',
        city: 'Brussels',
        country: 'Belgium',
        phone: '+32 2 111 0000',
        email: 'info@unit-alpha.com',
        website: 'unit-alpha.com',
        bookingEngine: 'unit-alpha.com/book',
        whatsappNumber: '+32 2 111 0000',
        vatNumber: 'BE0123456789',
        description: 'Unit test hotel A',
      },
    });

    await prisma.user.upsert({
      where: { id: 'u-wa-unit-a' },
      update: {},
      create: {
        id: 'u-wa-unit-a',
        email: 'mgr-wa-unit@alphahotel.be',
        name: 'Unit Manager',
        role: 'manager',
        hotelId: hotelIdA,
      },
    });

    await prisma.hotel.upsert({
      where: { id: hotelIdB },
      update: {},
      create: {
        id: hotelIdB,
        name: 'Unit Beta Hotel',
        legalName: 'Unit Beta BV',
        address: 'Beta Str 2',
        postcode: '1000',
        city: 'Brussels',
        country: 'Belgium',
        phone: '+32 2 222 0000',
        email: 'info@unit-beta.com',
        website: 'unit-beta.com',
        bookingEngine: 'unit-beta.com/book',
        whatsappNumber: '+32 2 222 0000',
        vatNumber: 'BE0987654321',
        description: 'Unit test hotel B',
      },
    });

    tokenA = signToken({ id: 'u-wa-unit-a', role: 'manager', email: 'mgr-wa-unit@alphahotel.be', hotelId: hotelIdA });
  });

  after(async () => {
    setTokenStorageDriver(null);
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  /* ------------------- 1. DASHBOARD STAFF REPLIES & DUPLICATE PREVENTION ------------------- */
  test('1. Dashboard staff reply resolves guest phone and sets deliveryStatus, preventing duplicates', async () => {
    const guestId = `g-wa-${hotelIdA}-32499112233`;
    const convId = `c-wa-unit-${Date.now()}`;

    await prisma.guest.upsert({
      where: { id: guestId },
      update: {},
      create: {
        id: guestId,
        hotelId: hotelIdA,
        name: 'Test WhatsApp Guest',
        country: 'Belgium',
        language: 'en',
        tags: JSON.stringify(['whatsapp', 'phone:+32499112233']),
      },
    });

    await prisma.conversation.create({
      data: {
        id: convId,
        guestId,
        stage: 'in-house',
        primaryChannel: 'whatsapp',
        aiStatus: 'human-takeover',
        sentiment: 'neutral',
        subject: 'WhatsApp Inquiry',
        summary: 'Guest asked about room service',
        suggestedReply: '',
        lastAt: '12:00',
      },
    });

    const res = await fetch(`${baseUrl}/conversations/${convId}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        body: 'Here is your room service menu confirmation.',
        channel: 'whatsapp',
        staffName: 'Amélie Duprez',
      }),
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.data.channel, 'whatsapp');
    assert.equal(json.data.deliveryStatus, 'simulated');

    // Duplicate submission within 3 seconds returns existing message without creating a new record
    const dupRes = await fetch(`${baseUrl}/conversations/${convId}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        body: 'Here is your room service menu confirmation.',
        channel: 'whatsapp',
        staffName: 'Amélie Duprez',
      }),
    });
    const dupJson = await dupRes.json();
    assert.equal(dupJson.data.id, json.data.id);

    const messageCount = await prisma.message.count({
      where: { conversationId: convId, author: 'staff' },
    });
    assert.equal(messageCount, 1);
  });

  test('1b. Dashboard staff reply with missing/invalid guest phone records failed delivery status', async () => {
    const guestNoPhoneId = `g-no-phone-${hotelIdA}-${Date.now()}`;
    const convNoPhoneId = `c-no-phone-${Date.now()}`;

    await prisma.guest.create({
      data: {
        id: guestNoPhoneId,
        hotelId: hotelIdA,
        name: 'Guest Without Phone',
        country: 'Belgium',
        language: 'en',
        tags: JSON.stringify(['unlabeled_12345', 'room_303']),
      },
    });

    await prisma.conversation.create({
      data: {
        id: convNoPhoneId,
        guestId: guestNoPhoneId,
        stage: 'in-house',
        primaryChannel: 'whatsapp',
        aiStatus: 'human-takeover',
        sentiment: 'neutral',
        subject: 'No phone test',
        summary: '',
        suggestedReply: '',
        lastAt: '12:00',
      },
    });

    const res = await fetch(`${baseUrl}/conversations/${convNoPhoneId}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        body: 'Testing failed delivery status when phone is missing.',
        channel: 'whatsapp',
      }),
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.deliveryStatus, 'failed');
    assert.equal(json.data.dispatch.success, false);
  });

  /* ------------------- 2. OAUTH STATE & TENANT ISOLATION ------------------- */
  test('2. OAuth State Verification rejects tampered, expired, or missing hotelId without demo-tenant fallback', async () => {
    // A. Tampered state
    const validState = generateOAuthState(hotelIdA);
    const tamperedState = validState.slice(0, -5) + 'xxxxx';
    const tamperedRes = verifyOAuthState(tamperedState);
    assert.equal(tamperedRes.valid, false);

    // B. Missing dot / malformed
    const malformedRes = verifyOAuthState('not_a_valid_state_string');
    assert.equal(malformedRes.valid, false);

    // C. Endpoint rejects invalid state with redirect error, never defaults to hotel-mercier
    const cbRes = await fetch(`${baseUrl}/whatsapp/oauth/callback?code=mock_code&state=${tamperedState}`, {
      redirect: 'manual',
    });
    assert.ok([301, 302, 307, 308].includes(cbRes.status));
    const location = cbRes.headers.get('location');
    assert.ok(location.includes('wa_error='));
    assert.ok(!location.includes('wa_connected=true'));
  });

  /* ------------------- 3. TARGET TYPE INTEGRATION SELECTION ------------------- */
  test('3. Integration selection fails safely when only wrong targetType is connected', async () => {
    await prisma.whatsAppIntegration.deleteMany({ where: { hotelId: hotelIdA } });

    // Only 'internal' integration is connected
    await prisma.whatsAppIntegration.create({
      data: {
        hotelId: hotelIdA,
        targetType: 'internal',
        phoneNumber: '32490000001',
        displayPhoneNumber: '+32 490 00 00 01',
        phoneNumberId: 'pn_internal_staff_1',
        status: 'connected',
      },
    });

    // Request guest dispatch -> MUST fail safely because only internal is connected
    const guestDispatch = await sendMetaWhatsAppMessage('32491112233', 'Hello Guest', [], hotelIdA, 'guest');
    assert.equal(guestDispatch.success, false);
    assert.ok(guestDispatch.reason.includes('No connected "guest" WhatsApp integration'));

    // Now connect guest integration -> succeeds
    await prisma.whatsAppIntegration.create({
      data: {
        hotelId: hotelIdA,
        targetType: 'guest',
        phoneNumber: '32490000002',
        displayPhoneNumber: '+32 490 00 00 02',
        phoneNumberId: 'pn_guest_live_2',
        status: 'connected',
      },
    });

    const guestDispatchSuccess = await sendMetaWhatsAppMessage('32491112233', 'Hello Guest', [], hotelIdA, 'guest');
    assert.equal(guestDispatchSuccess.success, true);
    assert.equal(guestDispatchSuccess.simulated, true);
  });

  /* ------------------- 4. DELIVERY / READ STATUS WEBHOOKS & REGRESSION PREVENTION ------------------- */
  test('4. Webhook processes delivered, advances to read, and prevents status regression', async () => {
    const msgId = `m-wa-meta-status-test-${Date.now()}`;
    const convId = `c-wa-status-${Date.now()}`;
    const guestId = `g-wa-${hotelIdA}-status`;

    await prisma.guest.upsert({
      where: { id: guestId },
      update: {},
      create: { id: guestId, hotelId: hotelIdA, name: 'Status Guest', country: 'Belgium', language: 'en' },
    });

    await prisma.conversation.upsert({
      where: { id: convId },
      update: {},
      create: {
        id: convId,
        guestId,
        stage: 'in-house',
        primaryChannel: 'whatsapp',
        aiStatus: 'ai-active',
        sentiment: 'neutral',
        subject: 'Status test',
        summary: '',
        suggestedReply: '',
        lastAt: '12:00',
      },
    });

    await prisma.message.create({
      data: {
        id: msgId,
        conversationId: convId,
        author: 'ai',
        channel: 'whatsapp',
        body: 'Status check message',
        at: '12:00',
        deliveryStatus: 'sent',
      },
    });

    const rawWaId = msgId.replace('m-wa-', '');

    // Step 1: Webhook updates status to 'read'
    const readPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_test',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: 'pn_guest_live_2', display_phone_number: '+32 490 00 00 02' },
                statuses: [
                  {
                    id: rawWaId,
                    status: 'read',
                    timestamp: '1700000002',
                    recipient_id: '32499112233',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res1 = await fetch(`${baseUrl}/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readPayload),
    });
    assert.equal(res1.status, 200);

    const msgAfterRead = await prisma.message.findUnique({ where: { id: msgId } });
    assert.equal(msgAfterRead.deliveryStatus, 'read');

    // Step 2: Late/out-of-order 'delivered' webhook arrives -> MUST NOT regress 'read' to 'delivered'
    const lateDeliveredPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_test',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: 'pn_guest_live_2', display_phone_number: '+32 490 00 00 02' },
                statuses: [
                  {
                    id: rawWaId,
                    status: 'delivered',
                    timestamp: '1700000001',
                    recipient_id: '32499112233',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res2 = await fetch(`${baseUrl}/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lateDeliveredPayload),
    });
    assert.equal(res2.status, 200);

    const msgAfterLateDelivered = await prisma.message.findUnique({ where: { id: msgId } });
    assert.equal(msgAfterLateDelivered.deliveryStatus, 'read'); // Still 'read'

    // Step 3: Unknown message ID webhook is acknowledged without throwing
    const unknownPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_test',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: 'pn_guest_live_2' },
                statuses: [{ id: 'unknown_wa_msg_999999', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    };
    const res3 = await fetch(`${baseUrl}/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(unknownPayload),
    });
    assert.equal(res3.status, 200);
  });

  /* ------------------- 5. TEMPLATE PAYLOAD BUILDER & ERROR HANDLING ------------------- */
  test('5. sendWhatsAppTemplate sanitizes phone and handles simulator/mock environment safely', async () => {
    const res = await sendWhatsAppTemplate('+32 491 11-22-33', 'booking_confirmation', 'en_US', [], hotelIdA);
    assert.equal(res.success, true);
    assert.equal(res.simulated, true);

    // Invalid phone number failure
    const invalidRes = await sendWhatsAppTemplate('', 'booking_confirmation', 'en_US', [], hotelIdA);
    assert.equal(invalidRes.success, false);
    assert.equal(invalidRes.reason, 'Invalid phone number');
  });

  /* ------------------- 6. OUTBOUND FAILURE HANDLING ------------------- */
  test('6. POST /api/whatsapp/send returns 400 if hotel is unconfigured in non-test mode or phone missing', async () => {
    const res = await fetch(`${baseUrl}/whatsapp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        // missing "to" and "message"
      }),
    });

    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.success, false);
  });

  /* ------------------- 7. TOKEN EXCHANGE ERROR HANDLING ------------------- */
  test('7. exchangeMetaCodeForToken throws error when Meta rejects OAuth authorization code', async () => {
    await assert.rejects(
      async () => {
        await exchangeMetaCodeForToken({
          hotelId: hotelIdA,
          targetType: 'guest',
          code: 'invalid_dummy_code_fail_test',
          phoneNumberId: 'phone_test_123',
          wabaId: 'waba_test_123',
        });
      },
      (err) => {
        assert.match(err.message, /Meta OAuth authorization failed/i);
        return true;
      }
    );
  });

  /* ------------------- 8. VALIDATION REQUIREMENTS ------------------- */
  test('8. exchangeMetaCodeForToken throws error when phoneNumberId is missing', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('graph.facebook.com') && String(url).includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'EAAG_test_mock_token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url, opts);
    };

    try {
      await assert.rejects(
        async () => {
          await exchangeMetaCodeForToken({
            hotelId: hotelIdA,
            targetType: 'guest',
            code: 'valid_mock_code_test',
            phoneNumberId: null, // missing!
            wabaId: 'waba_test_123',
          });
        },
        (err) => {
          assert.match(err.message, /Phone Number ID is required/i);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  /* ------------------- 9. PHASE 2: ONBOARDING AUTHENTICATION & MULTI-TENANT ISOLATION ------------------- */
  test('9. POST /api/whatsapp/embedded-signup allows valid authenticated user connecting own tenant', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('graph.facebook.com') && urlStr.includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'EAAG_valid_auth_token_phase2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('graph.facebook.com') && urlStr.includes('/subscribed_apps')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url, opts);
    };

    try {
      const res = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify({
          hotelId: hotelIdA,
          code: 'valid_meta_code_9',
          phoneNumberId: 'pn_unit_a_test_9',
          wabaId: 'waba_unit_a_test_9',
          displayPhoneNumber: '+32 499 11 22 33',
          targetType: 'guest',
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.integration.hotelId, hotelIdA);
      assert.equal(json.data.integration.status, 'connected');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('10. POST /api/whatsapp/embedded-signup rejects cross-tenant attempt (Tenant A -> Tenant B) with HTTP 403', async () => {
    const res = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`, // Token belongs to Hotel A
      },
      body: JSON.stringify({
        hotelId: hotelIdB, // Tampering: attempting to connect Hotel B!
        code: 'any_code',
        phoneNumberId: 'pn_unit_b_test_10',
        wabaId: 'waba_unit_b_test_10',
        displayPhoneNumber: '+32 499 44 55 66',
        targetType: 'guest',
      }),
    });

    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.message, /Cross-tenant access forbidden/i);
  });

  test('11. POST /api/whatsapp/embedded-signup rejects unauthenticated request with raw hotelId with HTTP 401', async () => {
    const res = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hotelId: hotelIdA, // Client supplied raw hotelId with no authorization!
        code: 'some_code',
        phoneNumberId: 'pn_unauth_test',
        displayPhoneNumber: '+32 499 00 00 00',
      }),
    });

    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.message, /Authentication required/i);
  });

  test('12. POST /api/whatsapp/embedded-signup returns HTTP 404 for nonexistent hotel context', async () => {
    const nonexistentHotelId = 'hotel-ghost-nonexistent-999';
    const ghostToken = signToken({ id: 'u-ghost', role: 'manager', email: 'ghost@hotel.com', hotelId: nonexistentHotelId });

    const res = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ghostToken}`,
      },
      body: JSON.stringify({
        code: 'some_code',
        phoneNumberId: 'pn_ghost_test',
        displayPhoneNumber: '+32 499 00 00 00',
      }),
    });

    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.message, /Hotel entity not found/i);
  });

  test('13. POST /api/whatsapp/embedded-signup allows legitimate onboarding with signed onboarding state token', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('graph.facebook.com') && urlStr.includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'EAAG_valid_onboarding_token_13' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('graph.facebook.com') && urlStr.includes('/subscribed_apps')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url, opts);
    };

    try {
      // Legitimate onboarding generates a signed state token with 'whatsapp_embedded_signup' purpose
      const onboardingTokenA = generateWhatsAppOnboardingToken(hotelIdA);

      // Method A: Passed in body as onboardingToken
      const res = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hotelId: hotelIdA,
          onboardingToken: onboardingTokenA,
          code: 'valid_meta_code_13',
          phoneNumberId: 'pn_unit_a_onboard_13',
          wabaId: 'waba_unit_a_onboard_13',
          displayPhoneNumber: '+32 499 77 88 99',
          targetType: 'guest',
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.integration.hotelId, hotelIdA);
      assert.equal(json.data.integration.status, 'connected');

      // Method B: Passed in Authorization header as Bearer token (using fresh token for second session)
      const onboardingTokenB = generateWhatsAppOnboardingToken(hotelIdA);
      const resBearer = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${onboardingTokenB}`,
        },
        body: JSON.stringify({
          code: 'valid_meta_code_13b',
          phoneNumberId: 'pn_unit_a_onboard_13b',
          wabaId: 'waba_unit_a_onboard_13b',
          displayPhoneNumber: '+32 499 77 88 99',
          targetType: 'guest',
        }),
      });

      assert.equal(resBearer.status, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('14. POST /api/whatsapp/embedded-signup rejects tampered or expired onboarding token with HTTP 401', async () => {
    const tamperedToken = 'eyJhbGciOiJIUzI1NiJ9.invalid_signature_xyz';
    const res = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tamperedToken}`,
      },
      body: JSON.stringify({
        code: 'some_code',
        phoneNumberId: 'pn_tamper_test',
        displayPhoneNumber: '+32 499 00 00 00',
      }),
    });

    assert.equal(res.status, 401);
  });

  test('15. POST /api/whatsapp/embedded-signup rejects cross-tenant onboarding mismatch with HTTP 403', async () => {
    const onboardingTokenA = generateWhatsAppOnboardingToken(hotelIdA);
    const res = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hotelId: hotelIdB, // Attempting to use Token A to hijack Hotel B!
        onboardingToken: onboardingTokenA,
        code: 'some_code',
        phoneNumberId: 'pn_hijack_test',
        displayPhoneNumber: '+32 499 00 00 00',
      }),
    });

    assert.equal(res.status, 403);
    const json = await res.json();
    assert.match(json.message, /Cross-tenant access forbidden/i);
  });

  test('16. POST /api/whatsapp/connect-manual enforces cross-tenant 403 and nonexistent hotel 404', async () => {
    // 16a. Cross-tenant attempt
    const resCross = await fetch(`${baseUrl}/whatsapp/connect-manual`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`, // User for Hotel A
      },
      body: JSON.stringify({
        hotelId: hotelIdB, // Attempting to connect Hotel B
        phoneNumberId: 'pn_manual_b',
        accessToken: 'manual_token_secret',
        displayPhoneNumber: '+32 499 88 77 66',
      }),
    });
    assert.equal(resCross.status, 403);

    // 16b. Nonexistent hotel
    const resGhost = await fetch(`${baseUrl}/whatsapp/connect-manual`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hotelId: 'nonexistent-hotel-manual-999',
        phoneNumberId: 'pn_manual_ghost',
        accessToken: 'manual_token_secret',
        displayPhoneNumber: '+32 499 88 77 66',
      }),
    });
    assert.equal(resGhost.status, 404);
  });

  /* ------------------- PHASE 2 SECURITY REFINEMENTS ------------------- */

  test('17. POST /api/whatsapp/embedded-signup rejects token with wrong purpose with HTTP 401', async () => {
    // Generate a valid HMAC token bound to hotelIdA, but with 'gmail_oauth' purpose
    const wrongPurposeToken = generateOAuthState(hotelIdA, null, 'gmail_oauth');

    const res = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${wrongPurposeToken}`,
      },
      body: JSON.stringify({
        code: 'some_code',
        phoneNumberId: 'pn_wrong_purpose',
        displayPhoneNumber: '+32 499 00 00 00',
      }),
    });

    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.message, /purpose mismatch|invalid/i);
  });

  test('18. POST /api/whatsapp/embedded-signup enforces single-use token and rejects replay attempts with HTTP 401', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('graph.facebook.com')) {
        return new Response(JSON.stringify({
          access_token: 'EAAB_test_mock_system_user_token_replay',
          token_type: 'bearer',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url, opts);
    };

    try {
      const replayToken = generateWhatsAppOnboardingToken(hotelIdA);

      // Attempt 1: Valid initial exchange
      const res1 = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelId: hotelIdA,
          onboardingToken: replayToken,
          code: 'valid_code_replay_1',
          phoneNumberId: 'pn_unit_replay_1',
          wabaId: 'waba_unit_replay_1',
          displayPhoneNumber: '+32 499 11 22 33',
        }),
      });
      assert.equal(res1.status, 200);

      // Attempt 2: Replay with the exact same token -> MUST BE REJECTED
      const res2 = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelId: hotelIdA,
          onboardingToken: replayToken,
          code: 'valid_code_replay_2',
          phoneNumberId: 'pn_unit_replay_2',
          wabaId: 'waba_unit_replay_2',
          displayPhoneNumber: '+32 499 11 22 33',
        }),
      });
      assert.equal(res2.status, 401);
      const json2 = await res2.json();
      assert.match(json2.message, /already been consumed|consumed/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('19. POST /api/whatsapp/embedded-signup safely handles concurrent requests with in-flight lock', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('graph.facebook.com')) {
        // Introduce small delay to simulate network latency and ensure lock overlap
        await new Promise((r) => setTimeout(r, 60));
        return new Response(JSON.stringify({
          access_token: 'EAAB_test_mock_system_user_token_concurrent',
          token_type: 'bearer',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url, opts);
    };

    try {
      const concurrentToken = generateWhatsAppOnboardingToken(hotelIdA);

      const requestPayload = {
        hotelId: hotelIdA,
        onboardingToken: concurrentToken,
        code: 'concurrent_code',
        phoneNumberId: 'pn_unit_concurrent',
        wabaId: 'waba_unit_concurrent',
        displayPhoneNumber: '+32 499 44 55 66',
      };

      // Launch both requests simultaneously
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/whatsapp/embedded-signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
        }),
        fetch(`${baseUrl}/whatsapp/embedded-signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one request must succeed (200), and the conflicting request must be safely rejected (409 lock contention or 401 already consumed)
      assert.equal(statuses[0], 200, 'One request must succeed with 200');
      assert.ok([401, 409].includes(statuses[1]), `Concurrent request must be rejected with 401 or 409, got ${statuses[1]}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('20. Failed Meta exchange releases token lock and does not consume token, permitting retry', async () => {
    let shouldFailMeta = true;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('graph.facebook.com')) {
        if (shouldFailMeta) {
          return new Response(JSON.stringify({
            error: {
              message: 'Invalid verification code format from Meta',
              type: 'OAuthException',
              code: 100,
            },
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({
          access_token: 'EAAB_test_mock_system_user_token_retry',
          token_type: 'bearer',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url, opts);
    };

    try {
      const retryToken = generateWhatsAppOnboardingToken(hotelIdA);

      // Attempt 1: Meta fails (e.g. transient 400 error)
      const res1 = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelId: hotelIdA,
          onboardingToken: retryToken,
          code: 'bad_transient_code',
          phoneNumberId: 'pn_unit_retry',
          wabaId: 'waba_unit_retry',
          displayPhoneNumber: '+32 499 22 33 44',
        }),
      });
      // Exchange fails
      assert.ok(res1.status >= 400);

      // Attempt 2: Meta is now healthy, retry with the SAME token
      shouldFailMeta = false;
      const res2 = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelId: hotelIdA,
          onboardingToken: retryToken,
          code: 'good_code_retry',
          phoneNumberId: 'pn_unit_retry',
          wabaId: 'waba_unit_retry',
          displayPhoneNumber: '+32 499 22 33 44',
        }),
      });

      // Must succeed with 200 because lock was released and token was NOT consumed
      assert.equal(res2.status, 200, 'Retry with unconsumed token after failure must succeed');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('21. Disallows req.body.state as authentication credential and rejects with HTTP 401', async () => {
    const validOnboardingToken = generateWhatsAppOnboardingToken(hotelIdA);

    // Send token ONLY inside req.body.state (no header, no req.body.onboardingToken)
    const res = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        state: validOnboardingToken,
        hotelId: hotelIdA,
        code: 'some_code',
        phoneNumberId: 'pn_state_test',
        displayPhoneNumber: '+32 499 00 00 00',
      }),
    });

    // req.body.state is no longer accepted as credential -> must be 401
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.message, /authentication required/i);
  });

  /* ------------------- DURABLE TOKEN STORAGE & FAIL-CLOSED TESTS ------------------- */

  test('22. consumeTokenPersistent enforces atomic duplicate rejection via unique constraint collision', async () => {
    const testHash = `hash-dup-test-${Date.now()}`;
    // First consumption succeeds
    const res1 = await consumeTokenPersistent(testHash, hotelIdA, 'whatsapp_embedded_signup');
    assert.equal(res1.success, true);

    // Second consumption with exact same hash throws unique constraint collision
    await assert.rejects(
      async () => {
        await consumeTokenPersistent(testHash, hotelIdA, 'whatsapp_embedded_signup');
      },
      (err) => {
        assert.match(err.message, /already been consumed/i);
        return true;
      }
    );
  });

  test('23. Atomic concurrent consumption across multiple parallel calls permits only one insert', async () => {
    const concurrentHash = `hash-concurrent-${Date.now()}`;

    // Fire 2 concurrent consumption attempts simultaneously
    const results = await Promise.allSettled([
      consumeTokenPersistent(concurrentHash, hotelIdA, 'whatsapp_embedded_signup'),
      consumeTokenPersistent(concurrentHash, hotelIdA, 'whatsapp_embedded_signup'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'Exactly one concurrent consumption must succeed');
    assert.equal(rejected.length, 1, 'The competing concurrent consumption must be rejected');
    assert.match(rejected[0].reason.message, /already been consumed/i);
  });

  test('24. Persistence survives process restart: clearing in-memory cache still rejects consumed token', async () => {
    const restartHash = `hash-restart-test-${Date.now()}`;
    await consumeTokenPersistent(restartHash, hotelIdA, 'whatsapp_embedded_signup');

    // Simulate process restart by clearing process-local memory Map and Set
    clearTokenMemory();

    // Verification must query durable storage and confirm token is consumed
    const isConsumed = await isTokenConsumedPersistent(restartHash);
    assert.equal(isConsumed, true, 'Token must remain consumed across process restarts via durable storage');
  });

  test('25. Fail-Closed security: database storage errors reject requests without falling back to memory', async () => {
    const failingStore = {
      async hasToken() {
        throw new Error('Database server connection lost (ECONNREFUSED)');
      },
      async insertToken() {
        throw new Error('Database server connection lost (ECONNREFUSED)');
      },
    };

    // Temporarily inject failing database driver
    setTokenStorageDriver(failingStore);

    try {
      // 1. Direct check must throw rather than silently returning false
      await assert.rejects(
        async () => {
          await isTokenConsumedPersistent('any-unconsumed-token');
        },
        (err) => {
          assert.match(err.message, /durable token verification storage unavailable/i);
          return true;
        }
      );

      // 2. Direct consume must throw rather than silently succeeding in memory
      await assert.rejects(
        async () => {
          await consumeTokenPersistent('any-unconsumed-token', hotelIdA, 'whatsapp_embedded_signup');
        },
        (err) => {
          assert.match(err.message, /connection lost/i);
          return true;
        }
      );

      // 3. Endpoint POST /api/whatsapp/embedded-signup must fail closed (HTTP 401 or 503)
      const token = generateWhatsAppOnboardingToken(hotelIdA);
      const res = await fetch(`${baseUrl}/whatsapp/embedded-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelId: hotelIdA,
          onboardingToken: token,
          code: 'valid_code',
          phoneNumberId: 'pn_unit_fail_closed',
          displayPhoneNumber: '+32 499 00 00 00',
        }),
      });

      // Must fail closed (reject authentication rather than allow access)
      assert.ok([401, 500, 503].includes(res.status));
      const json = await res.json();
      assert.match(json.message, /unavailable|failed|error/i);
    } finally {
      // Restore standard mock durable store
      setTokenStorageDriver(mockDurableStore);
    }
  });
});

