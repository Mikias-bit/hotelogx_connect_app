import { assertUnblocked, draftBlocker, addBlockerNote, workBlockers, hotelDay } from '../operations/blockers.js';
import { repairStatusChanged } from '../reports/housekeepingRepairs.js';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
const kinds = ['issue', 'task'];
const ref = row => `${row.kind}:${row.id}`;
const rank = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
const openStatus = status => ['New', 'Reported'].includes(status) ? 'Open' : status === 'Waiting' ? 'Waiting Parts' : status;
const storedStatus = (kind, status) => kind === 'task' && status === 'Open' ? 'New' : kind === 'task' && status === 'Waiting Parts' ? 'Waiting' : status;
const scope = (hotelId, kind, extra = {}) => ({ hotelId, ...(kind === 'task' ? { department: 'Maintenance' } : {}), ...extra });
const include = kind => kind === 'issue' ? { updates: { orderBy: { id: 'asc' } } } : { trail: { orderBy: { id: 'asc' } } };
const requireManager = user => { if (!user?.hotelId || !['manager', 'maintenance'].includes(user.role)) fail('Maintenance manager access required', 403); };

export function createMaintenanceOperations({ db, send, broadcast = () => {}, env = process.env, now = () => new Date() }) {
  const publish = hotelId => { for (const event of ['maintenance:updated', 'reports:updated', 'readiness:updated', 'blockers:updated']) broadcast(hotelId, event, { refresh: true }); };
  const lock = async (tx, hotelId) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${hotelId}`}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`maintenance:${hotelId}`}, 0))`;
  };
  async function work(database, hotelId) {
    const [issues, tasks] = await Promise.all(kinds.map(kind => database[kind].findMany({ where: scope(hotelId, kind), include: include(kind) })));
    return [...issues.filter(i => i.status !== 'Duplicate').map(row => ({ ...row, kind: 'issue', status: openStatus(row.status) })), ...tasks.map(row => ({ ...row, kind: 'task', status: openStatus(row.status) }))]
      .sort((a, b) => (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) || a.id.localeCompare(b.id));
  }
  async function read(user) {
    requireManager(user);
    const [rows, workers, assignments, config] = await Promise.all([
      work(db, user.hotelId), db.maintenanceWorker.findMany({ where: { hotelId: user.hotelId }, orderBy: { name: 'asc' } }),
      db.maintenanceAssignment.findMany({ where: { hotelId: user.hotelId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      db.maintenanceConfig.findUnique({ where: { hotelId: user.hotelId } }),
    ]);
    const blockers = [...await workBlockers(db, user.hotelId, 'issue', rows.filter(r => r.kind === 'issue').map(r => r.id)), ...await workBlockers(db, user.hotelId, 'task', rows.filter(r => r.kind === 'task').map(r => r.id))];
    const links = await db.housekeepingMaintenanceLink.findMany({ where: { hotelId: user.hotelId, active: true } });
    const { timezone } = await hotelDay(db, user.hotelId);
    return { timezone, work: rows.map(row => ({ ...row, blockers: blockers.filter(b => b.workKind === row.kind && b.workId === row.id), linkedHousekeepingTaskIds: links.filter(l => l.issueId === row.id).map(l => l.reportTaskId), assignee: workers.find(w => w.id === row.assignedWorkerId)?.name || row.assignee })),
      workers: workers.map(({ lastInboundAt, pendingProblemRef, ...worker }) => worker), assignments,
      config: config || { templateName: '', templateLanguage: 'en_US' } };
  }
  async function saveWorker(user, id, input) {
    requireManager(user);
    const { name, phone, active = true, whatsappEnabled = false, language = 'en' } = input || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || !/^\+[1-9]\d{7,14}$/.test(phone || '') || typeof active !== 'boolean' || typeof whatsappEnabled !== 'boolean' || !/^[a-z]{2}(?:[_-][A-Z]{2})?$/.test(language)) fail('Enter a name, international phone number and valid worker settings');
    const saved = await db.$transaction(async tx => {
      await lock(tx, user.hotelId);
      const old = id ? await tx.maintenanceWorker.findFirst({ where: { id, hotelId: user.hotelId } }) : null;
      if (id && !old) fail('Technician not found', 404);
      const values = { name: name.trim(), phone, active, whatsappEnabled, language };
      return old ? tx.maintenanceWorker.update({ where: { id: old.id }, data: { ...values,
        ...(phone !== old.phone || !active || !whatsappEnabled ? { lastInboundAt: null, pendingProblemRef: null } : {}) } })
        : tx.maintenanceWorker.create({ data: { ...values, hotelId: user.hotelId } });
    });
    publish(user.hotelId); return saved;
  }
  async function saveConfig(user, { templateName = '', templateLanguage = 'en_US' } = {}) {
    requireManager(user);
    if (typeof templateName !== 'string' || !/^[a-z0-9_]{0,512}$/.test(templateName) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(templateLanguage)) fail('Enter a valid template name and language');
    const data = { templateName: templateName || null, templateLanguage };
    return db.maintenanceConfig.upsert({ where: { hotelId: user.hotelId }, create: { hotelId: user.hotelId, ...data }, update: data });
  }
  function signature(worker, value) {
    if (!env.PMS_MCP_CONTEXT_KEY || env.PMS_MCP_CONTEXT_KEY.length < 32) fail('Operational action signing is not configured', 503);
    return createHmac('sha256', env.PMS_MCP_CONTEXT_KEY).update(`${worker.hotelId}:${worker.id}:${worker.phone}:${value}`).digest('base64url').slice(0, 22);
  }
  function button(worker, assignmentId, workRef, action, title) {
    const value = `mt.${assignmentId}.${Buffer.from(workRef).toString('base64url')}.${action}.${Math.floor(+now() / 1000) + 86400}`;
    return { id: `${value}.${signature(worker, value)}`, title };
  }
  function parse(worker, value) {
    const parts = String(value || '').split('.');
    if (parts.length !== 6 || parts[0] !== 'mt' || !['accept', 'start', 'done', 'problem', 'parts', 'help', 'more', 'contractor', 'failed', 'access', 'inside', 'dnd'].includes(parts[3]) || !/^[A-Za-z0-9_-]{22}$/.test(parts[5])) return null;
    const expiry = Number(parts[4]);
    if (!Number.isFinite(expiry) || expiry < +now() / 1000 || expiry > +now() / 1000 + 86410) return null;
    if (!timingSafeEqual(Buffer.from(parts[5]), Buffer.from(signature(worker, parts.slice(0, 5).join('.'))))) return null;
    return { assignmentId: parts[1], workRef: Buffer.from(parts[2], 'base64url').toString(), action: parts[3] };
  }
  async function packet(worker) {
    const allBlockers = await db.operationalBlocker.findMany({ where: { hotelId: worker.hotelId, resolvedAt: null, workKind: { in: ['issue', 'task'] } } });
    const assigned = (await work(db, worker.hotelId)).filter(row => row.assignedWorkerId === worker.id);
    const held = allBlockers.filter(b => assigned.some(r => r.kind === b.workKind && r.id === b.workId));
    const rows = assigned.filter(row => !held.some(b => b.workKind === row.kind && b.workId === row.id)).filter(row => row.assignedWorkerId === worker.id && row.assignmentId && ['Assigned', 'Accepted', 'In Progress', 'Waiting Parts'].includes(row.status));
    const pending = rows.find(row => row.status === 'Assigned');
    if (pending) {
      const batch = rows.filter(row => row.assignmentId === pending.assignmentId && row.status === 'Assigned');
      return { text: `Maintenance\nHi ${worker.name}, ${batch.length} task(s) await acceptance.\n${batch.slice(0, 8).map(row => `${row.room ? `Room / location ${row.room}` : 'General task'}: ${row.title}`).join('\n')}${batch.length > 8 ? '\nMore tasks follow after acceptance.' : ''}`.slice(0, 1000),
        buttons: [button(worker, pending.assignmentId, 'all', 'accept', 'Accept')] };
    }
    const row = rows.find(row => row.status === 'In Progress') || rows.find(row => row.status === 'Accepted') || rows[0];
    if (!row) return { text: held.length ? `Work is deferred: ${held.map(b => `${b.type.replaceAll('_', ' ')} ? ${b.followUpLocal ? `${b.followUpLocal.replace('T', ' ')} (${b.timezone}), owner ${b.ownerName}` : 'coordinator must schedule follow-up'}`).join('; ')}. Reply MAINTENANCE to refresh.` : 'No maintenance tasks are waiting. Reply MAINTENANCE to refresh your assignments.', buttons: [] };
    return { text: `${row.room ? `Room / location ${row.room}` : 'General task'} — ${row.title}\n${row.detail || ''}\nStatus: ${row.status}${row.problemNote ? `\nNote: ${row.problemNote}` : ''}`.slice(0, 1000),
      buttons: [button(worker, row.assignmentId, ref(row), row.status === 'In Progress' ? 'done' : 'start', row.status === 'In Progress' ? 'Completed' : 'Start'), button(worker, row.assignmentId, ref(row), 'problem', 'Problem')] };
  }
  async function audit(tx, row, actor, text, via) {
    const at = now().toISOString();
    const model = row.kind === 'issue' ? 'issueUpdate' : 'taskTrail';
    await tx[model].create({ data: { [row.kind === 'issue' ? 'issueId' : 'taskId']: row.id, at, text: `${text} (${actor})`, via } });
  }
  async function notify(assignment, worker) {
    const openWindow = worker.lastInboundAt && +worker.lastInboundAt > +now() - 23.5 * 3600000;
    const config = await db.maintenanceConfig.findUnique({ where: { hotelId: worker.hotelId } });
    if (!openWindow && !config?.templateName) {
      await db.maintenanceAssignment.updateMany({ where: { id: assignment.id, hotelId: worker.hotelId, deliveryStatus: 'pending' }, data: { deliveryStatus: 'waiting_window', lastError: 'Technician must message MAINTENANCE, or configure an approved assignment template.' } });
      return db.maintenanceAssignment.findUnique({ where: { id: assignment.id } });
    }
    const claimed = await db.maintenanceAssignment.updateMany({ where: { id: assignment.id, hotelId: worker.hotelId, deliveryStatus: 'pending' }, data: { deliveryStatus: 'sending' } });
    if (!claimed.count) return db.maintenanceAssignment.findUnique({ where: { id: assignment.id } });
    try {
      const payload = openWindow ? await packet(worker) : { template: { name: config.templateName, language: { code: config.templateLanguage }, components: [{ type: 'body', parameters: [{ type: 'text', text: worker.name }, { type: 'text', text: String(assignment.work.length) }] }] } };
      const response = await send({ hotelId: worker.hotelId, targetType: 'internal', to: worker.phone, ...payload });
      await db.maintenanceAssignment.updateMany({ where: { id: assignment.id, hotelId: worker.hotelId, deliveryStatus: 'sending' }, data: { deliveryStatus: response.success ? (openWindow ? 'submitted' : 'template_submitted') : response.uncertain ? 'uncertain' : 'failed', messageId: response.messageId || null, lastError: response.success ? null : 'Delivery not confirmed. Check WhatsApp before retrying.' } });
    } catch {
      await db.maintenanceAssignment.updateMany({ where: { id: assignment.id, hotelId: worker.hotelId, deliveryStatus: 'sending' }, data: { deliveryStatus: 'uncertain', lastError: 'Delivery outcome unknown. No automatic resend.' } });
    }
    return db.maintenanceAssignment.findUnique({ where: { id: assignment.id } });
  }
  async function assign(user, input = {}) {
    requireManager(user);
    const { workerId, work: selected, requestKey } = input;
    if (typeof workerId !== 'string' || !workerId || !Array.isArray(selected) || !selected.length || selected.length > 100 || selected.some(row => !kinds.includes(row?.kind) || typeof row.id !== 'string' || !row.id || !Number.isInteger(row.version) || row.version < 0) || new Set(selected.map(ref)).size !== selected.length || typeof requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(requestKey)) fail('Choose a technician, select 1–100 distinct tasks and supply a request ID');
    const { assignment, worker, replay } = await db.$transaction(async tx => {
      await lock(tx, user.hotelId);
      const previous = await tx.maintenanceAssignment.findUnique({ where: { hotelId_requestKey: { hotelId: user.hotelId, requestKey } } });
      if (previous) {
        if (previous.workerId !== workerId || JSON.stringify(previous.work.map(ref).sort()) !== JSON.stringify(selected.map(ref).sort())) fail('Request ID was reused for a different assignment', 409);
        return { assignment: previous, replay: true };
      }
      const worker = await tx.maintenanceWorker.findFirst({ where: { id: workerId, hotelId: user.hotelId, active: true, whatsappEnabled: true } });
      if (!worker) fail('Select an active WhatsApp-enabled technician from this hotel');
      if (!await tx.whatsAppIntegration.findFirst({ where: { hotelId: user.hotelId, status: 'connected', targetType: { in: ['internal', 'both'] } } })) fail('Connect the hotel internal WhatsApp number first', 409);
      signature(worker, 'configuration-check');
      const rows = [];
      for (const selection of selected) {
        const row = await tx[selection.kind].findFirst({ where: scope(user.hotelId, selection.kind, { id: selection.id }) });
        if (!row || row.version !== selection.version || ['Completed', 'In Progress', 'Duplicate'].includes(row.status)) fail('Tasks changed or are started/completed. Refresh before assigning.', 409);
        await assertUnblocked(tx, user.hotelId, selection.kind, [row.id]);
        rows.push({ ...row, kind: selection.kind });
      }
      const assignment = await tx.maintenanceAssignment.create({ data: { hotelId: user.hotelId, workerId, work: selected, requestKey, createdBy: user.id } });
      for (const row of rows) {
        await tx[row.kind].updateMany({ where: scope(user.hotelId, row.kind, { id: row.id, version: row.version }), data: {
          assignee: worker.name, assignedWorkerId: worker.id, assignmentId: assignment.id, status: 'Assigned', assignedAt: now(), acceptedAt: null, startedAt: null, completedAt: null, problemNote: null, version: { increment: 1 },
        } });
        await audit(tx, row, user.id, `Assigned to ${worker.name}; awaiting acceptance`, 'dashboard');
      }
      return { assignment, worker };
    });
    const result = replay ? assignment : await notify(assignment, worker);
    publish(user.hotelId); return result;
  }
  async function updateStatus(user, kind, id, { status, note = '', version } = {}) {
    requireManager(user);
    status = openStatus(status);
    if (!kinds.includes(kind) || !['Open', 'In Progress', 'Completed', 'Waiting Parts', 'Escalated'].includes(status) || typeof note !== 'string' || note.length > 2000) fail('Choose a valid maintenance status and note. Acceptance is recorded from the technician.');
    const result = await db.$transaction(async tx => {
      await lock(tx, user.hotelId);
      const row = await tx[kind].findFirst({ where: scope(user.hotelId, kind, { id }) });
      if (!row) fail('Maintenance task not found', 404);
      if (version !== undefined && version !== row.version) fail('Task changed. Refresh before updating.', 409);
      await assertUnblocked(tx, user.hotelId, kind, [id]);
      const data = { ...(kind === 'issue' && row.status === 'Completed' && status !== 'Completed' ? { repairCycle: { increment: 1 }, followUpTaskId: null } : {}), status: storedStatus(kind, status), completedAt: status === 'Completed' ? now() : null, version: { increment: 1 },
        ...(status === 'In Progress' && !row.startedAt ? { startedAt: now() } : {}),
        ...(note ? { problemNote: note.trim() } : {}),
        ...(status === 'Open' ? { assignee: null, assignedWorkerId: null, assignmentId: null, assignedAt: null, acceptedAt: null, startedAt: null, problemNote: null } : {}) };
      await tx[kind].updateMany({ where: scope(user.hotelId, kind, { id, version: row.version }), data });
      if (status === 'Waiting Parts') await draftBlocker(tx, { hotelId: user.hotelId, kind, work: row, type: 'parts', actor: user.id, requestKey: `parts-${randomUUID()}`, description: note.trim() });
      if (kind === 'issue') await repairStatusChanged(tx, row, status, user.id);
      await audit(tx, { ...row, kind }, user.id, `Staff marked ${status}${note ? ': ' + note : ''}`, 'dashboard');
      return tx[kind].findFirst({ where: scope(user.hotelId, kind, { id }), include: include(kind) });
    });
    // Completing one repair never completes other tickets or releases a PMS room.
    publish(user.hotelId); return result;
  }
  async function handle(integration, message) {
    if (!['internal', 'both'].includes(integration.targetType)) return false;
    const actionId = message.interactive?.button_reply?.id || message.button?.payload;
    const text = message.text?.body?.trim() || '';
    if (actionId?.startsWith('hk.') || /^housekeeping$/i.test(text)) return false;
    const worker = await db.maintenanceWorker.findFirst({ where: { hotelId: integration.hotelId, phone: `+${message.from}`, active: true, whatsappEnabled: true } });
    if (!worker) return false;
    const hkWorker = await db.housekeepingWorker.findFirst({ where: { hotelId: integration.hotelId, phone: worker.phone, active: true, whatsappEnabled: true } });
    if (hkWorker?.pendingProblemTaskId && !actionId?.startsWith('mt.') && !/^maintenance$/i.test(text)) return false;
    const chooseDepartment = hkWorker && !actionId?.startsWith('mt.') && !/^maintenance$/i.test(text) && !worker.pendingProblemRef;
    const inbound = new Date(Number(message.timestamp) * 1000);
    if (!Number.isFinite(+inbound) || +inbound > +now() + 300000 || +inbound < +now() - 86400000) return true;
    const receiptId = `mt:${integration.phoneNumberId}:${message.id}`;
    try { await db.whatsAppReceipt.create({ data: { id: receiptId, hotelId: worker.hotelId, phoneNumberId: integration.phoneNumberId, sender: message.from, status: 'processing' } }); }
    catch (error) { if (error.code === 'P2002') return true; throw error; }
    let response;
    try {
      await db.maintenanceWorker.updateMany({ where: { id: worker.id, hotelId: worker.hotelId, phone: worker.phone }, data: { lastInboundAt: inbound } });
      const action = parse(worker, actionId);
      if (chooseDepartment) response = { text: 'Reply MAINTENANCE for repair assignments or HOUSEKEEPING for cleaning assignments.' };
      else if (actionId && !action) response = { text: 'This action is invalid or expired. Reply MAINTENANCE for your current assignments.' };
      else if (action) {
        await db.$transaction(async tx => {
          await lock(tx, worker.hotelId);
          if (!await tx.maintenanceWorker.findFirst({ where: { id: worker.id, hotelId: worker.hotelId, phone: worker.phone, active: true, whatsappEnabled: true } })) fail('Worker changed', 409);
          const rows = (await work(tx, worker.hotelId)).filter(row => row.assignedWorkerId === worker.id && row.assignmentId === action.assignmentId && (action.workRef === 'all' || ref(row) === action.workRef));
          if (!rows.length) { response = { text: 'This assignment changed. Reply MAINTENANCE for your current work.' }; return; }
          if (action.action === 'problem') {
            const row = rows[0];
            if (!['Accepted', 'In Progress', 'Waiting Parts'].includes(row.status)) return;
            response = { text: `${row.title}: what is preventing completion?`, buttons: [button(worker, row.assignmentId, ref(row), 'parts', 'Parts required'), button(worker, row.assignmentId, ref(row), 'help', 'Need help'), button(worker, row.assignmentId, ref(row), 'more', 'Other blocker')] }; return;
          }
          if (['more', 'access'].includes(action.action)) {
            const row = rows[0];
            response = { text: 'Choose the blocker.', buttons: action.action === 'more' ? [button(worker, row.assignmentId, ref(row), 'contractor', 'Contractor needed'), button(worker, row.assignmentId, ref(row), 'failed', 'Repair unsuccessful'), button(worker, row.assignmentId, ref(row), 'access', 'Room access')] : [button(worker, row.assignmentId, ref(row), 'dnd', 'Do not disturb'), button(worker, row.assignmentId, ref(row), 'inside', 'Guest inside')] }; return;
          }
          const status = { accept: 'Accepted', start: 'In Progress', done: 'Completed', parts: 'Waiting Parts', help: 'Escalated', contractor: 'Escalated', failed: 'Escalated', dnd: 'Escalated', inside: 'Escalated' }[action.action];
          const from = { accept: ['Assigned'], start: ['Accepted', 'Waiting Parts'], done: ['In Progress'], parts: ['Accepted', 'In Progress', 'Waiting Parts'], help: ['Accepted', 'In Progress', 'Waiting Parts'], contractor: ['Accepted', 'In Progress'], failed: ['Accepted', 'In Progress'], dnd: ['Accepted', 'In Progress'], inside: ['Accepted', 'In Progress'] }[action.action];
          let changed = 0;
          for (const row of rows.filter(row => from?.includes(row.status))) {
            if (['accept', 'start', 'done'].includes(action.action)) await assertUnblocked(tx, worker.hotelId, row.kind, [row.id]);
            const values = { status: storedStatus(row.kind, status), version: { increment: 1 },
              ...(status === 'Accepted' ? { acceptedAt: now() } : status === 'In Progress' ? { startedAt: row.startedAt || now() } : status === 'Completed' ? { completedAt: now() } : {}) };
            const updated = await tx[row.kind].updateMany({ where: scope(worker.hotelId, row.kind, { id: row.id, version: row.version, assignedWorkerId: worker.id, assignmentId: action.assignmentId }), data: values });
            if (!updated.count) continue;
            changed++;
            if (['parts', 'contractor', 'failed', 'dnd', 'inside'].includes(action.action)) await draftBlocker(tx, { hotelId: worker.hotelId, kind: row.kind, work: row, type: action.action === 'failed' ? 'repair_failed' : action.action === 'inside' ? 'guest_inside' : action.action, actor: worker.id, requestKey: `wa-${receiptId}` });
            if (row.kind === 'issue') await repairStatusChanged(tx, row, status, worker.id);
            await audit(tx, row, worker.id, `WhatsApp: ${status} by ${worker.name}`, 'whatsapp');
            if (['parts', 'help', 'contractor', 'failed', 'dnd', 'inside'].includes(action.action)) await tx.maintenanceWorker.update({ where: { id: worker.id }, data: { pendingProblemRef: `${row.assignmentId}|${ref(row)}` } });
          }
          if (changed && action.action === 'accept') await tx.maintenanceAssignment.updateMany({ where: { id: action.assignmentId, hotelId: worker.hotelId, workerId: worker.id }, data: { deliveryStatus: 'accepted', lastError: null } });
          if (changed && ['parts', 'help', 'contractor', 'failed', 'dnd', 'inside'].includes(action.action)) response = { text: 'Blocker recorded. Reply with the part, contractor, remaining fault or access instructions. The coordinator will schedule the owner and next action. Reply MAINTENANCE for other work.' };
        });
      } else if (worker.pendingProblemRef && text && !/^(tasks|maintenance)$/i.test(text)) {
        await db.$transaction(async tx => {
          await lock(tx, worker.hotelId);
          if (!await tx.maintenanceWorker.findFirst({ where: { id: worker.id, hotelId: worker.hotelId, phone: worker.phone, active: true, whatsappEnabled: true } })) fail('Worker changed', 409);
          const [assignmentId, workRef] = worker.pendingProblemRef.split('|');
          const row = (await work(tx, worker.hotelId)).find(row => ref(row) === workRef && row.assignmentId === assignmentId && row.assignedWorkerId === worker.id && ['Waiting Parts', 'Escalated'].includes(row.status));
          if (row) {
            await addBlockerNote(tx, worker.hotelId, row.kind, row.id, worker.id, text);
            await tx[row.kind].updateMany({ where: scope(worker.hotelId, row.kind, { id: row.id, assignmentId, assignedWorkerId: worker.id, version: row.version }), data: { problemNote: text.slice(0, 2000), version: { increment: 1 } } });
            await audit(tx, row, worker.id, `WhatsApp note: ${text.slice(0, 2000)}`, 'whatsapp');
          }
          await tx.maintenanceWorker.updateMany({ where: { id: worker.id, hotelId: worker.hotelId, phone: worker.phone }, data: { pendingProblemRef: null } });
        });
      } else if (/^(tasks|maintenance)$/i.test(text)) {
        await db.maintenanceWorker.updateMany({ where: { id: worker.id, hotelId: worker.hotelId }, data: { pendingProblemRef: null } });
      }
      response ||= await packet(worker);
      await db.whatsAppReceipt.update({ where: { id: receiptId }, data: { status: 'sending', replyText: JSON.stringify(response) } });
      const sent = await send({ hotelId: worker.hotelId, targetType: 'internal', to: worker.phone, ...response });
      await db.whatsAppReceipt.update({ where: { id: receiptId }, data: { status: sent.success ? 'done' : 'uncertain', providerMessageId: sent.messageId || null, lastError: sent.success ? null : 'Reply not confirmed; send MAINTENANCE again.' } });
    } catch (error) {
      if (error.status) { try { await send({ hotelId: worker.hotelId, targetType: 'internal', to: worker.phone, text: error.message }); } catch {} }
      await db.whatsAppReceipt.update({ where: { id: receiptId }, data: { status: 'uncertain', lastError: 'Operation interrupted. Review task state; no automatic replay.' } });
    }
    publish(worker.hotelId); return true;
  }
  return { read, saveWorker, saveConfig, assign, updateStatus, handle, packet, button, parse };
}
