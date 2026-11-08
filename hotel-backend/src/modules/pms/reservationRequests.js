import { lookupBookingOrigin, sourceReply } from './bookingOrigin.js';
import { ensureGuestHandoff } from '../operations/guestHandoffs.js';
import { randomUUID } from 'node:crypto';
import { syncOperations, failOperation } from '../reports/reportOperations.js';
import { hash } from '../reports/reportService.js';
import { hotelTime, planData, invalidateTaskRoomApprovals } from '../reports/housekeepingPlan.js';

export function reservationRequestKinds(text = '') {
  text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const kinds = [];
  if (/\b(cancel|cancelling|canceling|annuleren|annuler)\b.{0,70}\b(reservation|booking|stay|reservering|boeking|reservation)\b/i.test(text)
    || /\b(reservation|booking|reservering)\b.{0,40}\b(cancelled|canceled|cancellation|annuleren)\b/i.test(text)) kinds.push('cancellation');
  if (/\b(change|amend|modify|move|extend|shorten|wijzigen|verlengen|modifier)\b.{0,70}\b(reservation|booking|stay|dates?|arrival|departure|check[ -]?(?:in|out)|guests?|reservering|boeking|verblijf)\b/i.test(text)
    || /\b(add|remove)\b.{0,30}\b(guests?|adults?|children|person)\b/i.test(text)) kinds.push('amendment');
  if (/\b(extra|additional|rollaway|fold[ -]?out|sofa|spare)\s*[ -]?beds?\b|\b(extra bed|slaapbank|lit supplementaire)\b/i.test(text)) kinds.push('extra_bed');
  return kinds;
}
export const bedTaskTypes = ['extra_bed_requested', 'make_sofa_bed'];
const transaction = (db, fn) => db.$transaction ? db.$transaction(fn, { timeout: 30000 }) : fn(db);
const lock = (tx, hotelId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${hotelId}`}, 0))`;

const openStatuses = ['pending', 'awaiting_origin'];
function validatedSource(source, binding) {
  return source && source.type !== 'unknown' && binding && (!binding.expiresAt || binding.expiresAt > new Date())
    && source.reservationId === binding.reservationId && source.customerId === binding.customerId
    ? source : { type: 'unknown', reason: source?.reason || 'Reservation verification required' };
}
async function applySource(tx, request, source) {
  const status = source.type === 'direct' ? 'pending' : source.type === 'external' ? 'referred' : 'awaiting_origin';
  return tx.reservationServiceRequest.update({ where: { id: request.id }, data: { status, bookingSource: source, reservationId: source.reservationId || null } });
}
async function updateRoutingConversation(tx, hotelId, conversationId, source) {
  const conversation = await tx.conversation.findFirst({ where: { id: conversationId, guest: { hotelId } } });
  if (!conversation) failOperation('Conversation not found', 404);
  const pending = await tx.reservationServiceRequest.findMany({ where: { hotelId, conversationId, status: 'pending' } });
  const needsStaff = pending.some(r => r.kind === 'extra_bed' || r.bookingSource?.type === 'direct');
  let previous; try { previous = JSON.parse(conversation.escalation || 'null'); } catch {}
  const ownEscalation = previous?.kind === 'reservation_request';
  const escalation = needsStaff ? { kind: 'reservation_request', department: 'Front Office', audiences: ['Front Office', 'Management'], urgency: 'Normal', raisedAt: new Date().toISOString(),
    reason: 'Direct-booking change or extra-bed approval requires staff review',
    suggested: 'Resolve direct-booking requests in the PMS. Review extra-bed suitability and guest agreement before approving preparation.' } : undefined;
  const replyText = [source ? sourceReply(source) : '', pending.some(r => r.kind === 'extra_bed') ? 'Your extra-bed request has been passed to Front Office for a suitability and availability check.' : ''].filter(Boolean).join(' ');
  const aiStatus = needsStaff ? 'escalated' : previous && !ownEscalation ? conversation.aiStatus : 'human-takeover';
  await tx.conversation.update({ where: { id: conversationId }, data: { aiStatus, suggestedReply: replyText, ...(escalation ? { escalation: JSON.stringify(escalation) } : ownEscalation ? { escalation: null } : {}) } });
  return { handled: true, requiresApproval: true, type: 'reservation_request', aiStatus, ...(escalation ? { escalation } : {}), replyText, suggestedReply: replyText };
}

// Only verified PMS source information can authorize direct-booking resolution.
export async function captureReservationRequests(db, { hotelId, conversationId, messageText, messageId }, { originLookup = lookupBookingOrigin } = {}) {
  const kinds = reservationRequestKinds(messageText);
  if (!kinds.length) return null;
  const checked = kinds.some(k => k !== 'extra_bed') ? await originLookup(db, { hotelId, conversationId }) : null;
  return transaction(db, async tx => {
    await lock(tx, hotelId);
    const conversation = await tx.conversation.findFirst({ where: { id: conversationId, guest: { hotelId } } });
    if (!conversation) failOperation('Conversation not found', 404);
    const message = await tx.message.findFirst({ where: { conversationId, author: 'guest', ...(messageId ? { id: messageId } : { body: messageText }) }, orderBy: { createdAt: 'desc' } });
    if (!message) failOperation('Guest message not found', 404);
    const binding = checked ? await tx.pmsConversationBinding.findFirst({ where: { hotelId, conversationId } }) : null;
    const source = checked ? validatedSource(checked, binding) : null;
    for (const kind of kinds) {
      let previous = await tx.reservationServiceRequest.findFirst({ where: { hotelId, conversationId, kind, OR: [{ status: { in: openStatuses } }, { sourceMessageId: message.id }] } });
      if (!previous) previous = await tx.reservationServiceRequest.create({ data: { hotelId, conversationId, kind, requestText: messageText.slice(0, 12000), sourceMessageId: message.id } });
      if (kind !== 'extra_bed' && openStatuses.includes(previous.status)) await applySource(tx, previous, source);
    }
    return updateRoutingConversation(tx, hotelId, conversationId, source);
  });
}

export async function refreshRequestOrigin(db, user, id, options = {}) {
  if (!['manager', 'front-office'].includes(user.role)) failOperation('Front Office or manager access required', 403);
  const request = await db.reservationServiceRequest.findFirst({ where: { id, hotelId: user.hotelId } });
  if (!request) failOperation('Request not found', 404);
  if (request.kind === 'extra_bed' || ![...openStatuses, 'referred'].includes(request.status)) return request;
  const source = await (options.originLookup || lookupBookingOrigin)(db, { hotelId: user.hotelId, conversationId: request.conversationId }, { client: options.client, actor: user });
  return transaction(db, async tx => {
    await lock(tx, user.hotelId);
    const fresh = await tx.reservationServiceRequest.findFirst({ where: { id, hotelId: user.hotelId } });
    if (![...openStatuses, 'referred'].includes(fresh.status)) return fresh;
    const binding = await tx.pmsConversationBinding.findFirst({ where: { hotelId: user.hotelId, conversationId: request.conversationId } });
    const verified = validatedSource(source, binding);
    const saved = await applySource(tx, fresh, verified);
    await updateRoutingConversation(tx, user.hotelId, request.conversationId, verified);
    return saved;
  });
}

export async function reviewReservationRequest(db, user, id, input, liveReservation) {
  if (!['manager', 'front-office'].includes(user.role)) failOperation('Front Office or manager access required', 403);
  if (!['approve', 'reject', 'resolve'].includes(input.action) || typeof input.note !== 'string' || input.note.trim().length < 5 || input.note.length > 2000) failOperation('Choose an action and record the staff decision');
  const snapshot = input.action === 'approve' ? await syncOperations(db, user) : null;
  return transaction(db, async tx => {
    await lock(tx, user.hotelId);
    const request = await tx.reservationServiceRequest.findFirst({ where: { id, hotelId: user.hotelId } });
    if (!request) failOperation('Request not found', 404);
    if (request.kind !== 'extra_bed' && (request.status === 'awaiting_origin' || request.status === 'referred' || request.bookingSource?.type !== 'direct')) failOperation('Only verified direct bookings can be resolved here. Check the source and refer agency bookings to their provider.', 409);
    if (request.status !== 'pending') return request; // Concurrent/repeated review cannot create another task.
    if (input.action === 'approve' && request.kind !== 'extra_bed') failOperation('Reservation changes must be handled by staff in the PMS; then record the outcome');
    if (input.action === 'resolve' && request.kind === 'extra_bed') failOperation('Approve or reject an extra-bed request');
    if (request.kind !== 'extra_bed') {
      const binding = await tx.pmsConversationBinding.findFirst({ where: { hotelId: user.hotelId, conversationId: request.conversationId } });
      if (validatedSource(request.bookingSource, binding).type !== 'direct' || !request.bookingSource.checkedAt || Date.now() - Date.parse(request.bookingSource.checkedAt) > 120000) failOperation('Refresh the verified booking source before recording an outcome', 409);
    }
    let taskId = null, reservationId = request.reservationId;
    if (input.action === 'approve') {
      if (input.suitabilityConfirmed !== true || input.guestAgreementConfirmed !== true) failOperation('Confirm hotel policy, room capacity, bed availability and guest agreement to any charges');
      const binding = await tx.pmsConversationBinding.findFirst({ where: { hotelId: user.hotelId, conversationId: request.conversationId } });
      if (!binding || (binding.expiresAt && binding.expiresAt <= new Date()) || liveReservation?.Id !== binding.reservationId || liveReservation?.AccountId !== binding.customerId || liveReservation?.AccountType !== 'Customer' || !['Confirmed', 'Started'].includes(liveReservation.State)) failOperation('Verify an active reservation for this guest before approval', 409);
      reservationId = binding.reservationId;
      const resourceId = liveReservation.AssignedResourceId || liveReservation.SpaceId || liveReservation.ResourceId;
      const room = resourceId ? await tx.room.findFirst({ where: { hotelId: user.hotelId, mewsId: resourceId } }) : null;
      if (!room) failOperation('Assign and sync the reservation room before approving preparation', 409);
      const hotel = await tx.hotel.findUnique({ where: { id: user.hotelId }, select: { timezone: true } });
      const timezone = hotel?.timezone || 'Europe/Amsterdam';
      const dateOf = value => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
      const arrival = dateOf(liveReservation.ScheduledStartUtc || liveReservation.StartUtc), departure = dateOf(liveReservation.ScheduledEndUtc || liveReservation.EndUtc);
      const date = input.workDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date < snapshot.today || date < arrival || date >= departure) failOperation('Choose a preparation date within the reservation stay, today or later');
      if (!bedTaskTypes.includes(input.bedType) || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 5) failOperation('Choose the bed arrangement and a quantity from 1 to 5');
      const existing = await tx.reportTask.findMany({ where: { hotelId: user.hotelId, kind: 'housekeeping', active: true, reportDate: date, status: { not: 'Cancelled' } } });
      const candidates = existing.filter(t => planData(t).room === room.number && bedTaskTypes.includes(planData(t).task));
      if (input.existingTaskId) {
        const selected = candidates.find(t => t.id === input.existingTaskId);
        if (!selected || selected.sourceReviewRequired || input.existingTaskCoversRequest !== true) failOperation('Review the current report task and confirm it covers the full requested arrangement', 409);
        taskId = selected.id;
      } else {
        if (candidates.length) failOperation('Bed preparation already exists for this room and date. Review and link the existing task to avoid duplicate setup.', 409);
        taskId = `rt-${randomUUID()}`;
        const data = { room: room.number, task: input.bedType, quantity: input.quantity, comment: `${input.quantity} bed(s). ${input.note.trim()}`, reservationId, serviceRequestId: request.id };
        await tx.reportTask.create({ data: { id: taskId, hotelId: user.hotelId, kind: 'housekeeping', reportDate: date, itemKey: taskId, origin: 'staff', carryForward: true, carryReviewedDate: date, data, contentHash: hash(data), sourceGeneratedAt: new Date(), notBefore: hotelTime(date, '00:00', timezone) } });
        await invalidateTaskRoomApprovals(tx, user.hotelId, [{ data }]);
      }
      const work = await tx.reportTask.findFirst({ where: { id: taskId, hotelId: user.hotelId } });
      await ensureGuestHandoff(tx, 'report', work, user.id, { force: true, conversationId: request.conversationId });
      await tx.reportTaskEvent.create({ data: { hotelId: user.hotelId, taskId, actor: user.id, text: `Front Office approval recorded by ${user.role} ${user.id}; linked guest request ${request.id}. ${input.note.trim()}` } });
    }
    return tx.reservationServiceRequest.update({ where: { id }, data: { status: input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'resolved', note: input.note.trim(), reviewedBy: user.id, reviewedAt: new Date(), taskId, reservationId } });
  });
}

export async function assertReservationRequestsReviewed(db, hotelId, conversationId) {
  if (await db.reservationServiceRequest.findFirst({ where: { hotelId, conversationId, status: { in: openStatuses } } })) failOperation('Review pending reservation and extra-bed requests before closing or returning this conversation to AI', 409);
}
