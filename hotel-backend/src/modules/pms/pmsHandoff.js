import { saveVerificationHandoff } from './verificationHandoff.js';

// A PMS request needing staff belongs to the ordinary conversation queue.
// Persist it here so provider processors can still send the guest acknowledgment.
export async function savePmsHandoff(database, context, result) {
  if (result.staffReview) return saveVerificationHandoff(database, context);
  if (['booking_pending_approval', 'booking_uncertain', 'booking_staff_check', 'booking_booked'].includes(result.status)) {
    const booked = result.status === 'booking_booked', approval = result.status === 'booking_pending_approval';
    const escalation = { kind: 'pms_booking', department: 'Front Office', urgency: result.status === 'booking_uncertain' ? 'High' : 'Normal', raisedAt: context.raisedAt,
      reason: booked ? 'Reservation created — staff payment follow-up required' : approval ? 'Accepted booking requires approval' : 'Booking requires a PMS check',
      suggested: booked ? 'Arrange payment using the hotel procedure and contact the guest. No payment has been collected by Hotelogx.' : 'Review the booking request in this conversation. Check Mews before another attempt if the result is uncertain.' };
    const updated = await database.conversation.updateMany({ where: { id: context.conversationId, guest: { hotelId: context.hotelId } }, data: { aiStatus: 'escalated', escalation: JSON.stringify(escalation) } });
    if (updated.count !== 1) throw new Error('Conversation hotel mismatch');
    return escalation;
  }
  const approval = result.status === 'pending_approval';
  if (!approval && !['staff_check', 'uncertain', 'posting'].includes(result.status)) return null;
  const escalation = {
    kind: approval ? 'pms_approval' : 'pms_review', department: 'Front Office',
    urgency: approval ? 'Normal' : 'High', raisedAt: context.raisedAt,
    reason: approval ? 'Reservation extra needs staff approval' : 'Reservation or folio needs a staff check',
    suggested: approval
      ? 'Review the accepted offer and availability in this conversation before approving or rejecting it.'
      : 'Verify the reservation and check the PMS folio before taking action. Do not retry an uncertain posting or create a replacement charge.',
  };
  const updated = await database.conversation.updateMany({
    where: { id: context.conversationId, guest: { hotelId: context.hotelId } },
    data: { aiStatus: 'escalated', escalation: JSON.stringify(escalation) },
  });
  if (updated.count !== 1) throw new Error('Conversation hotel mismatch');
  return escalation;
}
