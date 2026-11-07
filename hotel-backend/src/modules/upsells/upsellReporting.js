const iso = value => value ? new Date(value).toISOString() : null;
const delivered = status => ['sent', 'delivered', 'read', 'recorded'].includes(status);
const deliveryStatus = value => delivered(value) ? 'Sent' : value === 'failed' ? 'Failed' : ['uncertain', 'sending'].includes(value) ? 'Uncertain' : 'Pending';

export async function upsellPipeline(db, hotelId, now = new Date()) {
  const [offers, outreach] = await Promise.all([
    db.pmsUpsellOffer.findMany({ where: { hotelId }, orderBy: { createdAt: 'desc' } }),
    db.upsellOutreach.findMany({ where: { hotelId }, orderBy: { createdAt: 'desc' } }),
  ]);
  const conversationIds = [...new Set([...offers, ...outreach].map(o => o.conversationId))];
  const conversations = await db.conversation.findMany({ where: { id: { in: conversationIds }, guest: { hotelId } }, include: { guest: true } });
  const messages = await db.message.findMany({ where: { conversationId: { in: conversations.map(c => c.id) }, author: { in: ['ai', 'staff', 'guest'] } } });
  const detail = o => {
    const c = conversations.find(c => c.id === o.conversationId);
    return { guest: c?.guest.name || 'Guest', room: c?.guest.room, channel: c?.primaryChannel || 'email', currency: o.currency, date: iso(o.createdAt), source: o.source || 'conversation', paymentStatus: 'Not tracked' };
  };
  const invitationSent = o => {
    const message = messages.find(m => m.id === o.messageId);
    return delivered(message?.deliveryStatus || o.status);
  };
  const rows = offers.map(o => {
    // An incoming ACCEPT message is not an outgoing quote.
    const message = messages.find(m => m.conversationId === o.conversationId && ['ai', 'staff'].includes(m.author)
      && (m.id === o.deliveryMessageId || (m.body.includes(`ACCEPT ${o.id.toUpperCase()}`) && new Date(m.createdAt) >= new Date(o.createdAt))));
    const invitation = outreach.find(p => p.reservationId === o.reservationId && p.productId === o.productId && invitationSent(p));
    const acceptedMessage = messages.find(m => m.id === o.acceptedMessageId && m.author === 'guest' && m.conversationId === o.conversationId);
    const guestAccepted = Boolean(o.acceptedAt || o.acceptedMessageId);
    // A server-validated acceptance proves delivery even if an older receipt was removed.
    // Expiry/rejection alone does not prove delivery.
    const wasSent = delivered(message?.deliveryStatus) || Boolean(invitation) || guestAccepted;
    const status = o.status === 'posted' ? 'Posted' : o.status === 'rejected' ? 'Rejected'
      : ['uncertain', 'posting'].includes(o.status) ? 'Uncertain'
      : guestAccepted ? 'Accepted' : o.expiresAt <= now ? 'Expired' : deliveryStatus(message?.deliveryStatus);
    return { ...detail(o), id: o.id, offer: o.name, value: Number(o.totalAmount), status,
      channel: message?.channel || detail(o).channel, wasSent, guestAccepted,
      acceptedAt: iso(o.acceptedAt || acceptedMessage?.createdAt), postedAt: iso(o.postedAt),
      postingStatus: o.status, deliveryStatus: message?.deliveryStatus || (invitation ? 'sent' : 'unknown') };
  });
  for (const o of outreach) {
    if (offers.some(p => p.reservationId === o.reservationId && p.productId === o.productId)) continue;
    const message = messages.find(m => m.id === o.messageId);
    rows.push({ ...detail(o), id: o.id, offer: o.name, value: Number(o.unitAmount || 0),
      status: deliveryStatus(message?.deliveryStatus || o.status), channel: message?.channel || detail(o).channel,
      wasSent: invitationSent(o), guestAccepted: false, acceptedAt: null, postedAt: null, postingStatus: 'not_posted', deliveryStatus: message?.deliveryStatus || o.status });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export function hotelDate(value, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
const addDays = (day, offset) => new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
export function postedTotals(rows) {
  const cents = {};
  for (const row of rows.filter(r => r.postingStatus === 'posted')) {
    const currency = row.currency || 'Unknown currency';
    cents[currency] = (cents[currency] || 0) + Math.round(row.value * 100);
  }
  return Object.fromEntries(Object.entries(cents).map(([currency, total]) => [currency, total / 100]));
}
export function upsellSummary(rows, timezone = 'UTC', now = new Date()) {
  const today = hotelDate(now, timezone);
  const dayOfWeek = new Date(`${today}T12:00:00Z`).getUTCDay();
  const start = addDays(today, -((dayOfWeek + 6) % 7));
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const posted = rows.filter(r => r.postingStatus === 'posted');
  const thisWeek = posted.filter(r => r.postedAt && new Date(r.postedAt) <= now && dates.includes(hotelDate(r.postedAt, timezone)));
  const sent = rows.filter(r => r.wasSent).length;
  const accepted = rows.filter(r => r.wasSent && r.guestAccepted).length;
  return { timezone, sent, accepted, conversion: sent ? Math.round(accepted / sent * 100) : 0,
    postedCount: posted.length, postedTotals: postedTotals(posted), undatedPostingCount: posted.filter(r => !r.postedAt).length,
    week: { start, end: dates[6], postedCount: thisWeek.length, totals: postedTotals(thisWeek),
      days: dates.map(date => ({ date, label: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)),
        totals: postedTotals(thisWeek.filter(r => hotelDate(r.postedAt, timezone) === date)) })) } };
}
