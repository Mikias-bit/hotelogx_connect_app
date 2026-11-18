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

export function roomReply(text = '') {
  return /^(?:(?:my\s+)?room(?:\s+number)?\s*(?:is\s*)?#?\s*|(?:it'?s|it is)\s+)?(\d{2,4})(?:\s*,?\s*(?:please|thanks|thank you))?[.!]?$/i.exec(text.trim())?.[1] || null;
}

const isRoomQuestion = text => text === 'Certainly. Which room should we arrange this for?'
  || /^Could you please confirm your room number\? I could not match room \d{2,4} to this hotel, and I want to pass your housekeeping request to the correct room\.$/.test(text);

// Follow only an uninterrupted, recent request/question/answer chain. A number
// on its own is never evidence of a reservation binding or guest identity.
export function resumeHousekeepingRoom(messageText, history, now = Date.now()) {
  const room = roomReply(messageText);
  if (!room) return null;
  const rows = [...history]; // newest first; the incoming message may already be saved
  if (rows[0]?.author === 'guest' && rows[0].body.trim() === messageText.trim()) rows.shift();
  for (let step = 0; step < 6; step++) {
    const question = rows.shift(), request = rows.shift();
    const recent = row => row?.createdAt && Number.isFinite(+new Date(row.createdAt))
      && now - +new Date(row.createdAt) >= 0 && now - +new Date(row.createdAt) <= 30 * 60000;
    if (!question || question.author !== 'ai' || !isRoomQuestion(question.body)
      || ['failed', 'uncertain'].includes(question.deliveryStatus) || !recent(question)
      || request?.author !== 'guest' || !recent(request)) return null;
    if (housekeepingDelivery(request.body)) {
      const original = request.body.replace(/\broom(?:\s+number)?\s*(?:is\s*)?#?\s*\d{2,4}\b/gi, '').trim();
      return `Room ${room}. ${original}`;
    }
    if (!roomReply(request.body)) return null;
  }
  return null;
}

export async function resolveHousekeepingFollowUp(db, { hotelId, conversationId, channel, messageText }) {
  if (!roomReply(messageText)) return messageText;
  const history = await db.message.findMany({
    where: { conversationId, channel, conversation: { guest: { hotelId } } },
    orderBy: { createdAt: 'desc' }, take: 13,
  });
  return resumeHousekeepingRoom(messageText, history) || messageText;
}
