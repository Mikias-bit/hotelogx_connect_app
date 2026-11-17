// Recognize ordinary delivery requests before generic "extra" upsell matching.
// Normalize known item typos only; never guess a different room number.
export function housekeepingDelivery(text = '') {
  const normalized = text.toLowerCase().replace(/\b(duve|duvett|duvetts|duvets)\b/g, 'duvet')
    .replace(/\b(pillo|pilow|pilows)\b/g, 'pillow').replace(/\b(towl|towls|towles)\b/g, 'towel');
  if (/\b(price|cost|charge|buy|purchase|refund|cancel|don't|do not|no longer|not need)\b/i.test(normalized)) return null;
  const match = /\b(duvet|blankets?|pillows?|towels?|bed ?sheets?)\b/i.exec(normalized);
  if (!match || !/\b(want|need|bring|send|deliver|please|extra|another|more|could|can)\b/.test(normalized)) return null;
  return { normalized, item: match[1] };
}

export function escalationAcknowledgment(text) {
  return housekeepingDelivery(text)
    ? 'Thank you, we have received your housekeeping request. Front Office still needs to review the open follow-up and your new message before we can confirm arrangements.'
    : 'Thank you, we have received your message. This conversation is awaiting Front Office review, and your new message is visible to the team. We cannot confirm any new arrangements yet.';
}

export async function housekeepingRoomQuestion(db, hotelId, room) {
  if (!room || room === 'not provided') return 'Certainly. Which room should we arrange this for?';
  const known = await db.room.findFirst({ where: { hotelId, number: room }, select: { number: true } });
  return known ? null : `Could you please confirm your room number? I could not match room ${room} to this hotel, and I want to pass your housekeeping request to the correct room.`;
}
