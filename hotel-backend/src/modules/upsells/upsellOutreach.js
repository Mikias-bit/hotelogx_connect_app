import { randomUUID } from 'node:crypto';

export const upsellCategories = ['other', 'breakfast', 'late_checkout', 'early_checkin', 'airport_transfer', 'romance', 'birthday', 'wine', 'parking', 'upgrade'];
const patterns = {
  breakfast: /\b(breakfast|buffet|ontbijt|petit déjeuner)\b/i,
  late_checkout: /\b(late check[ -]?out|leave later|late train|late flight|laat uitchecken)\b/i,
  early_checkin: /\b(early check[ -]?in|early arrival|arriv\w* early|landing early|morning arrival|vroeg inchecken)\b/i,
  airport_transfer: /\b(airport|transfer|taxi|flight|shuttle|luchthaven)\b/i,
  romance: /\b(romantic|romance|love package|anniversary|honeymoon|flowers|huwelijksreis)\b/i,
  birthday: /\b(birthday|verjaardag|anniversaire)\b/i,
  wine: /\b(wine|champagne|prosecco|bubbles|bubles|celebrat\w*|wijn)\b/i,
  parking: /\b(parking|garage|car|parkeren)\b/i,
  upgrade: /\b(upgrade|suite|bigger room|balcony)\b/i,
};
const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function matchesProduct(text, product) {
  const haystack = ` ${normalize(text)} `;
  const terms = [product.label || product.name, ...(product.keywords || '').split(',')].map(normalize).filter(s => s.length >= 3);
  return terms.some(term => haystack.includes(` ${term} `)) || Boolean(patterns[product.category]?.test(text));
}
export function contactDetails(guest) {
  let tags = []; try { tags = JSON.parse(guest?.tags || '[]'); } catch {}
  if (!Array.isArray(tags)) tags = [];
  const email = [guest?.email, ...tags].find(v => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()));
  const phone = guest?.phone || tags.find(v => typeof v === 'string' && /^(phone:|wa:|whatsapp:|\+)/i.test(v)) || (guest?.id?.startsWith('g-wa-') ? guest.id.split('-').at(-1) : '');
  const digits = String(phone).replace(/^(phone:|wa:|whatsapp:)/i, '').replace(/[+\s()-]/g, '');
  return { email: email?.trim().toLowerCase() || null, phone: /^\d{8,15}$/.test(digits) ? digits : null };
}
export const upsellLock = (tx, hotelId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`upsells:${hotelId}`}, 0))`;
export const transaction = (db, fn) => db.$transaction ? db.$transaction(fn, { timeout: 30000 }) : fn(db);

// Contact matching is only for suppression/routing. It NEVER creates a verified PMS binding.
export async function outreachContext(db, hotelId, conversationId, reservationId) {
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, guest: { hotelId } }, include: { guest: true } });
  if (!conversation) throw new Error('Conversation not found in this hotel');
  const contacts = contactDetails(conversation.guest);
  const relatedGuests = await db.guest.findMany({ where: { hotelId, OR: [
    { id: conversation.guestId },
    ...(contacts.email ? [{ email: contacts.email }, { tags: { contains: contacts.email } }] : []),
    ...(contacts.phone ? [{ phone: contacts.phone }, { id: `g-wa-${hotelId}-${contacts.phone}` }, { tags: { contains: contacts.phone } }] : []),
  ] } });
  const guests = relatedGuests.filter(g => g.id === conversation.guestId || (contacts.email && contactDetails(g).email === contacts.email) || (contacts.phone && contactDetails(g).phone === contacts.phone));
  const guestIds = guests.map(g => g.id);
  const binding = await db.pmsConversationBinding.findFirst({ where: { hotelId, conversationId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  let reservation;
  if (reservationId || binding?.reservationId) {
    reservation = await db.reservation.findFirst({ where: { hotelId, mewsId: reservationId || binding.reservationId, ...(reservationId ? { guestId: { in: guestIds } } : {}) } });
  } else {
    const rows = await db.reservation.findMany({ where: { hotelId, guestId: { in: guestIds }, status: { in: ['Confirmed', 'In House'] }, departure: { gte: new Date().toISOString().slice(0, 10) } }, take: 2 });
    if (rows.length === 1) reservation = rows[0];
  }
  if (!reservation?.mewsId) throw new Error('Link one reservation before offering extras; no unique synced reservation was found');
  const reservationGuest = await db.guest.findFirst({ where: { hotelId, id: reservation.guestId } });
  const reservationContacts = contactDetails(reservationGuest);
  const aliases = await db.guest.findMany({ where: { hotelId, OR: [
    { id: reservation.guestId }, { id: { in: guestIds } },
    ...(reservationContacts.email ? [{ email: reservationContacts.email }, { tags: { contains: reservationContacts.email } }] : []),
    ...(reservationContacts.phone ? [{ phone: reservationContacts.phone }, { id: `g-wa-${hotelId}-${reservationContacts.phone}` }, { tags: { contains: reservationContacts.phone } }] : []),
  ] } });
  const aliasIds = aliases.filter(g => guestIds.includes(g.id) || g.id === reservation.guestId || (reservationContacts.email && contactDetails(g).email === reservationContacts.email) || (reservationContacts.phone && contactDetails(g).phone === reservationContacts.phone)).map(g => g.id);
  const bindings = await db.pmsConversationBinding.findMany({ where: { hotelId, reservationId: reservation.mewsId } });
  const conversations = await db.conversation.findMany({ where: { guest: { hotelId }, OR: [{ guestId: { in: aliasIds } }, { id: { in: bindings.map(b => b.conversationId) } }] } });
  return { hotelId, reservation, conversation, conversationIds: conversations.map(c => c.id), conversations };
}

export async function eligibleProducts(db, context, products) {
  const { hotelId, reservation, conversationIds } = context;
  const [claims, offers, messages] = await Promise.all([
    db.upsellOutreach.findMany({ where: { hotelId, reservationId: reservation.mewsId } }),
    db.pmsUpsellOffer.findMany({ where: { hotelId, reservationId: reservation.mewsId } }),
    db.message.findMany({ where: { conversationId: { in: conversationIds }, author: { in: ['staff', 'ai'] },
      createdAt: { gte: reservation.createdAt }, OR: [{ deliveryStatus: null }, { deliveryStatus: { not: 'failed' } }] } }),
  ]);
  return products.filter(p => !claims.some(c => c.productId === p.productId) && !offers.some(o => o.productId === p.productId)
    && !messages.some(m => matchesProduct(m.body, p)));
}

export async function claimOutreach(db, { hotelId, conversationId, reservationId, products, source, messageId = `m-${randomUUID()}`, automatic = false, requireAll = false }) {
  return transaction(db, async tx => {
    await upsellLock(tx, hotelId);
    const context = await outreachContext(tx, hotelId, conversationId, reservationId);
    if (!['Confirmed', 'In House'].includes(context.reservation.status)) return { products: [], messageId, context };
    if (source === 'campaign' && await tx.upsellOutreach.findFirst({ where: { hotelId, reservationId: context.reservation.mewsId, source: 'campaign' } })) return { products: [], messageId, context };
    if (automatic) {
      const hotel = await tx.hotel.findUnique({ where: { id: hotelId } });
      const config = await tx.aiConfig.findUnique({ where: { hotelId } });
      const rule = await tx.aiRule.findFirst({ where: { hotelId, topic: 'Upsells' } });
      if (hotel?.aiMode !== 'Autonomous' || config?.autoReply === false || (rule && rule.mode !== 'Autonomous') || context.conversations.some(c => ['human-takeover', 'escalated'].includes(c.aiStatus)) || context.conversation.guest.vip) return { products: [], messageId, context };
    }
    const eligible = (await eligibleProducts(tx, context, products)).slice(0, source === 'campaign' ? 3 : products.length);
    if (requireAll && eligible.length !== products.length) throw Object.assign(new Error('This extra has already been offered for this reservation. Review the existing offer instead of sending it again.'), { status: 409 });
    for (const p of eligible) await tx.upsellOutreach.create({ data: {
      id: randomUUID(), hotelId, reservationId: context.reservation.mewsId, productId: p.productId,
      conversationId, source, messageId, name: p.label, unitAmount: p.unitAmount, currency: p.currency,
    } });
    return { products: eligible, messageId, context };
  });
}

export function invitationText(products) {
  return `Would you like to add something to your stay?\n${products.map(p => `• ${p.label}: ${p.unitAmount} ${p.currency} per unit.`).join('\n')}\nReply with the extra, quantity and preferred date/time. Availability and any required staff approval will be checked before we quote an exact offer. Nothing has been added or charged.`;
}

export async function pricedProducts(db, client, context, { text, preArrival = false, staff } = {}) {
  const configured = await db.pmsUpsellProduct.findMany({ where: { hotelId: context.hotelId, active: true, ...(preArrival ? { preArrival: true } : {}) }, orderBy: { productId: 'asc' } });
  const candidates = text ? configured.filter(p => matchesProduct(text, p)) : configured;
  const results = [];
  for (const p of candidates.slice(0, 12)) {
    const response = staff ? await client.callTool(staff, 'search_upsell_products', { query: p.label })
      : await client.callConversationTool(context, 'search_upsell_products', { query: p.label });
    if (response.isError) throw new Error('Catalogue unavailable');
    const data = response.structuredContent || JSON.parse(response.content?.find(c => c.type === 'text')?.text || '{}');
    const live = data.products?.find(item => item.product_id === p.productId);
    if (live && Number.isFinite(Number(live.unit_amount)) && Number(live.unit_amount) > 0 && /^[A-Z]{3}$/.test(live.currency || '')) results.push({ ...p, label: live.name, unitAmount: Number(live.unit_amount), currency: live.currency });
  }
  return results;
}

// Called before dispatch, so a simultaneous automation worker sees the staff claim.
export async function reserveStaffOffers(db, { hotelId, conversationId, body, messageId }) {
  const products = await db.pmsUpsellProduct.findMany({ where: { hotelId, active: true } });
  const matched = products.filter(p => matchesProduct(body, p));
  if (!matched.length || !/\b(offer|add|arrange|would you like|can provide)\b|[€$£]|\b(EUR|USD|GBP)\b/i.test(body) || /\bACCEPT [A-F0-9]{12}\b/i.test(body)) return;
  await claimOutreach(db, { hotelId, conversationId, products: matched, source: 'staff', messageId, requireAll: true });
}
