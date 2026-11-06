export async function upsellPipeline(db, hotelId) {
  const [offers, outreach] = await Promise.all([
    db.pmsUpsellOffer.findMany({ where: { hotelId }, orderBy: { createdAt: 'desc' } }),
    db.upsellOutreach.findMany({ where: { hotelId }, orderBy: { createdAt: 'desc' } }),
  ]);
  const conversationIds = [...new Set([...offers, ...outreach].map(o => o.conversationId))];
  const conversations = await db.conversation.findMany({ where: { id: { in: conversationIds }, guest: { hotelId } }, include: { guest: true } });
  const messages = await db.message.findMany({ where: { conversationId: { in: conversations.map(c => c.id) }, author: { in: ['ai', 'staff'] } } });
  const detail = o => {
    const c = conversations.find(c => c.id === o.conversationId);
    return { guest: c?.guest.name || 'Guest', room: c?.guest.room, channel: c?.primaryChannel || 'email', currency: o.currency, date: o.createdAt.toISOString(), source: o.source || 'conversation' };
  };
  const deliveryStatus = value => ['sent', 'delivered', 'read', 'recorded'].includes(value) ? 'Sent' : value === 'failed' ? 'Failed' : ['uncertain', 'sending'].includes(value) ? 'Uncertain' : 'Pending';
  const rows = offers.map(o => {
    const message = messages.find(m => m.id === o.deliveryMessageId || m.body.includes(o.id.toUpperCase()));
    const status = o.status === 'posted' ? 'Accepted' : o.status === 'rejected' ? 'Declined' : ['uncertain', 'posting'].includes(o.status) ? 'Uncertain' : o.expiresAt <= new Date() ? 'Expired' : deliveryStatus(message?.deliveryStatus);
    return { ...detail(o), id: o.id, offer: o.name, value: Number(o.totalAmount), status, channel: message?.channel || detail(o).channel };
  });
  for (const o of outreach) {
    if (offers.some(p => p.reservationId === o.reservationId && p.productId === o.productId)) continue;
    const message = messages.find(m => m.id === o.messageId);
    rows.push({ ...detail(o), id: o.id, offer: o.name, value: Number(o.unitAmount || 0), status: deliveryStatus(message?.deliveryStatus || o.status), channel: message?.channel || detail(o).channel });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}
