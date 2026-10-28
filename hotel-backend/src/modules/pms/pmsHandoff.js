import { saveVerificationHandoff } from './verificationHandoff.js';

// A PMS request needing staff belongs to the ordinary conversation queue.
// Persist it here so provider processors can still send the guest acknowledgment.
export async function savePmsHandoff(database, context, result) {
  if (result.staffReview) return saveVerificationHandoff(database, context);
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
