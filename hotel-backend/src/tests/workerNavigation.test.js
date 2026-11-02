import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerOperationsHandler, workerNavigationIds } from '../modules/whatsapp/workerNavigation.js';
import { WhatsAppMessagingService } from '../modules/whatsapp/WhatsAppMessagingService.js';
import { createMaintenanceOperations } from '../modules/maintenance/maintenanceOperations.js';
import { createHousekeepingOperations } from '../modules/reports/housekeepingOperations.js';
import { encryptToken } from '../utils/tokenCrypto.js';

const integration = { id: 'i', hotelId: 'hotel-a', targetType: 'internal', status: 'connected', verifiedAt: new Date(), phoneNumberId: '123', wabaId: '456', accessToken: encryptToken('test-token') };
const template = { name: 'staff_assignment', language: { code: 'en_US' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Maria' }, { type: 'text', text: '5' }] }] };
const incoming = { id: 'in-1', from: '31612345678', timestamp: String(Math.floor(Date.now() / 1000)), type: 'button', button: { text: 'View Tasks', payload: 'View Tasks' } };
function fixture() {
  const calls = [];
  const services = Object.fromEntries(['housekeeping', 'maintenance'].map(department => [department, { handle: async (i, message) => { calls.push({ department, i, message }); return true; } }]));
  const db = { housekeepingAssignment: { findFirst: async () => null }, maintenanceAssignment: { findFirst: async () => null } };
  return { calls, services, db, handle: createWorkerOperationsHandler({ db, ...services }) };
}

for (const department of Object.keys(workerNavigationIds)) test(`template button opens only ${department}; never becomes an acceptance action`, async () => {
  const f = fixture();
  await f.handle(integration, { ...incoming, button: { text: 'View Tasks', payload: workerNavigationIds[department] } });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].department, department);
  assert.equal(f.calls[0].message.text.body, department.toUpperCase());
  assert.equal(f.calls[0].message.id, incoming.id);
  assert.equal(f.calls[0].message.from, incoming.from);
  assert.equal(f.calls[0].message.button, undefined);
});

test('legacy template button uses hotel-scoped notification context', async () => {
  const f = fixture();
  f.db.housekeepingAssignment.findFirst = async ({ where }) => {
    assert.deepEqual(where, { hotelId: 'hotel-a', messageId: 'out-1' }); return { id: 'assignment' };
  };
  await f.handle(integration, { ...incoming, context: { id: 'out-1' } });
  assert.equal(f.calls[0].department, 'housekeeping');
  assert.equal(f.calls[0].message.text.body, 'HOUSEKEEPING');
});

test('ambiguous legacy button opens department selection; signed actions are not rewritten', async () => {
  const f = fixture();
  await f.handle(integration, incoming);
  assert.equal(f.calls[0].message.text.body, 'TASKS');
  assert.equal(f.calls[0].message.workerNavigation, true);
  const signed = { ...incoming, button: { text: 'View Tasks', payload: 'hk.invalid.signature' } };
  await f.handle(integration, signed);
  assert.equal(f.calls[1].message, signed);
  const selection = { ...incoming, type: 'interactive', button: undefined, interactive: { button_reply: { id: workerNavigationIds.housekeeping, title: 'Housekeeping' } } };
  await f.handle(integration, selection);
  assert.equal(f.calls[2].department, 'housekeeping');
  assert.equal(await f.handle({ ...integration, targetType: 'guest' }, incoming), false);
});

test('real services reject unregistered senders even with valid navigation payloads', async () => {
  const db = Object.fromEntries(['housekeepingWorker', 'maintenanceWorker'].map(name => [name, { findFirst: async ({ where }) => {
    assert.deepEqual(where, { hotelId: 'hotel-a', phone: '+31612345678', active: true, whatsappEnabled: true }); return null;
  } }]));
  const options = { db, send: () => assert.fail('Must not send to unregistered workers') };
  const handle = createWorkerOperationsHandler({ db, housekeeping: createHousekeepingOperations(options), maintenance: createMaintenanceOperations(options) });
  for (const payload of Object.values(workerNavigationIds)) assert.equal(await handle(integration, { ...incoming, button: { payload } }), false);
});

test('shared workers with pending problems receive department buttons without changing work', async () => {
  let sent;
  const worker = { id: 'worker', hotelId: integration.hotelId, phone: '+31612345678', pendingProblemRef: 'batch|issue:1' };
  const db = {
    maintenanceWorker: { findFirst: async () => worker, updateMany: async ({ data }) => {
      assert.equal(Object.hasOwn(data, 'pendingProblemRef'), false, 'Viewing must preserve the pending problem');
      return { count: 1 };
    } },
    housekeepingWorker: { findFirst: async () => ({ pendingProblemTaskId: 'task' }) },
    whatsAppReceipt: { create: async () => ({}), update: async () => ({}) },
    operationalBlocker: { findMany: async () => [] },
    issue: { findMany: async () => [] },
    task: { findMany: async () => [] },
  };
  const maintenance = createMaintenanceOperations({ db, send: async message => { sent = message; return { success: true }; } });
  const handle = createWorkerOperationsHandler({ db, maintenance, housekeeping: { handle: () => assert.fail('Must show department selection') } });
  assert.equal(await handle(integration, incoming), true);
  assert.deepEqual(sent.buttons.map(b => b.id), Object.values(workerNavigationIds));
  assert.equal(await handle(integration, { ...incoming, id: 'in-2', button: { payload: workerNavigationIds.maintenance } }), true);
  assert.match(sent.text, /No maintenance tasks/);
});

for (const department of Object.keys(workerNavigationIds)) test(`outbound shared template carries ${department} routing payload`, async () => {
  let outbound;
  const db = { whatsAppIntegration: { findFirst: async () => integration, update: async () => ({}) } };
  const request = async (path, token, options) => {
    if (path === '456/message_templates') {
      assert.equal(options.query.name, template.name);
      return { data: [{ name: template.name, language: 'en_US', status: 'APPROVED', components: [{ type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'View Tasks' }] }] }] };
    }
    assert.equal(path, '123/messages'); outbound = options.body; return { messages: [{ id: 'sent' }] };
  };
  const messaging = new WhatsAppMessagingService({ db, request });
  assert.equal((await messaging.send({ hotelId: integration.hotelId, targetType: 'internal', to: incoming.from, template, assignmentDepartment: department })).success, true);
  assert.deepEqual(outbound.template.components[1], { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: workerNavigationIds[department] }] });
  assert.deepEqual(outbound.template.components[0], template.components[0]);
  assert.equal(template.components.length, 1);
});

test('text-only templates remain supported; unapproved or URL-button templates never send', async () => {
  const db = { whatsAppIntegration: { findFirst: async () => integration, update: async () => ({}) } };
  for (const variant of ['plain', 'pending', 'url', 'lookup-failure']) {
    let sends = 0;
    const messaging = new WhatsAppMessagingService({ db, request: async path => {
      if (path.endsWith('/message_templates')) {
        if (variant === 'lookup-failure') throw new Error('Lookup failed');
        return { data: [{ name: template.name, language: 'en_US', status: variant === 'pending' ? 'PENDING' : 'APPROVED', components: variant === 'url' ? [{ type: 'BUTTONS', buttons: [{ type: 'URL', text: 'View Tasks' }] }] : [] }] };
      }
      sends++; return { messages: [{ id: 'sent' }] };
    } });
    const result = await messaging.send({ hotelId: integration.hotelId, targetType: 'internal', to: incoming.from, template, assignmentDepartment: 'housekeeping' });
    assert.equal(sends, variant === 'plain' ? 1 : 0);
    assert.equal(result.success, variant === 'plain');
    if (variant !== 'plain') assert.equal(result.uncertain, false);
  }
});
