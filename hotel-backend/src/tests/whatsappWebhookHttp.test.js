import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import app from '../app.js';

test('large Coexistence batches retain signature checks on canonical and legacy webhook routes', async () => {
  const previous = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = 'http-test-secret';
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [], padding: 'x'.repeat(150000) });
    const signature = 'sha256=' + createHmac('sha256', process.env.META_APP_SECRET).update(body).digest('hex');
    for (const path of ['/api/whatsapp/webhook', '/api/webhooks/whatsapp/1']) {
      const url = `http://127.0.0.1:${server.address().port}${path}`;
      const unsigned = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      assert.equal(unsigned.status, 401);
      const signed = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body });
      assert.equal(signed.status, 200);
    }
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.META_APP_SECRET; else process.env.META_APP_SECRET = previous;
  }
});
