import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../config/database.js';
import { MewsClient } from '../modules/pms/mewsClient.js';
import { pmsService } from '../modules/pms/pmsService.js';
import { decryptToken } from '../utils/tokenCrypto.js';

test('PMS onboarding persists the validated client token/environment for the exact hotel', async () => {
  const originals = [], replace = (obj, key, fn) => { originals.push(() => { obj[key] = fn; }); obj[key] = fn; };
  let saved;
  try {
    replace(MewsClient.prototype, 'validateEnterpriseAccess', async () => ({ propertyId: 'enterprise-a', accessTokenUsed: 'access-test', clientTokenUsed: 'client-test', verifiedBaseUrl: 'https://api.mews-demo.com' }));
    replace(prisma.hotel, 'findUnique', async ({ where }) => ({ id: where.id, onboardingSteps: '[]' }));
    replace(prisma.hotel, 'findFirst', async () => { throw new Error('Cross-hotel fallback must not be used'); });
    replace(prisma.hotel, 'update', async () => ({}));
    replace(prisma.onboardingState, 'upsert', async () => ({}));
    replace(prisma.pmsIntegration, 'upsert', async args => { saved = args; return { lastSyncAt: new Date() }; });
    const result = await pmsService.connectPms('hotel-a', { propertyId: 'access-test', clientToken: 'client-test' });
    assert.equal(saved.where.hotelId, 'hotel-a');
    for (const entry of [saved.create, saved.update]) {
      assert.notEqual(entry.clientTokenEncrypted, 'client-test');
      assert.equal(decryptToken(entry.clientTokenEncrypted), 'client-test');
      assert.equal(entry.baseUrl, 'https://api.mews-demo.com');
    }
    assert.equal(JSON.stringify(result).includes('client-test'), false);
    replace(prisma.hotel, 'findUnique', async () => null);
    await assert.rejects(pmsService.connectPms('missing', { propertyId: 'access-test' }), /Hotel not found/);
  } finally { originals.reverse().forEach(restore => restore()); }
});
