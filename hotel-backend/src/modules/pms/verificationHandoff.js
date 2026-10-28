// Ordinary conversation escalation; no operational task or dashboard error panel.
export async function saveVerificationHandoff(database, { hotelId, conversationId, raisedAt }) {
  const escalation = { kind: 'reservation_verification', department: 'Front Office',
    reason: 'Reservation verification needs Front Office review', urgency: 'Normal', raisedAt,
    suggested: 'Verify the guest through the booking contact or the hotel identity-check procedure before sharing reservation information or linking a reservation. A confirmation number alone is not proof of ownership.' };
  const updated = await database.conversation.updateMany({ where: { id: conversationId, guest: { hotelId } },
    data: { aiStatus: 'escalated', escalation: JSON.stringify(escalation) } });
  if (updated.count !== 1) throw new Error('Conversation hotel mismatch');
  return escalation;
}
