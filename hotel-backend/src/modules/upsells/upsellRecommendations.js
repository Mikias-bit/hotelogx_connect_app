import { claimOutreach, invitationText, outreachContext, eligibleProducts, pricedProducts, transaction, upsellLock } from './upsellOutreach.js';

export async function catalogueIdeas(db, client, hotelId, conversationId, text, staff) {
  const context = await outreachContext(db, hotelId, conversationId);
  const products = await pricedProducts(db, client, { hotelId, conversationId }, { text, staff });
  return (await eligibleProducts(db, context, products)).map(p => ({ productId: p.productId, label: p.label, value: `${p.unitAmount} ${p.currency}`, reason: 'Relevant catalogue extra for this conversation', currency: p.currency }));
}

export async function prepareCatalogueReply(db, { hotelId, conversationId, products, automatic }) {
  const configured = await db.pmsUpsellProduct.findMany({ where: { hotelId, active: true } });
  const priced = products.map(p => {
    const approved = configured.find(c => c.productId === p.product_id);
    return approved && Number(p.unit_amount) > 0 && /^[A-Z]{3}$/.test(p.currency || '') ? { ...approved, label: p.name, unitAmount: Number(p.unit_amount), currency: p.currency } : null;
  }).filter(Boolean).slice(0, 3);
  if (!priced.length) return { replyText: 'Please ask our Front Office team to check the available extras for you.', upsellIdeas: [] };
  if (!automatic) return { replyText: invitationText(priced), upsellIdeas: priced.map(p => ({ productId: p.productId, label: p.label, value: `${p.unitAmount} ${p.currency}`, reason: 'Catalogue suggestion awaiting staff review' })) };
  try {
    const claim = await claimOutreach(db, { hotelId, conversationId, products: priced, source: 'ai', automatic: true });
    if (!claim.products.length) return { replyText: 'Please refer to the extras already discussed with our team. Let us know if you have a question about an existing offer.', upsellIdeas: [] };
    return { replyText: invitationText(claim.products), messageId: claim.messageId, upsellIdeas: [] };
  } catch {
    // Ambiguous reservations must not result in untracked offers or disclosure.
    return { replyText: 'Our Front Office team can help you choose extras after checking your reservation.', upsellIdeas: [] };
  }
}

export async function previousQuote(db, hotelId, conversationId, args) {
  const binding = await db.pmsConversationBinding.findFirst({ where: { hotelId, conversationId } });
  if (!binding) return null; // The verification layer handles this case.
  const offer = await db.pmsUpsellOffer.findFirst({ where: { hotelId, reservationId: binding.reservationId, productId: args.product_id }, orderBy: { createdAt: 'desc' } });
  if (!offer) return null;
  return { status: 'information', replyText: 'This extra has already been quoted for your reservation. Please review the previous offer, or ask Front Office to check its status or change your request.' };
}

export async function guardedQuote(db, hotelId, conversationId, args, execute) {
  return transaction(db, async tx => {
    await upsellLock(tx, hotelId);
    return await previousQuote(tx, hotelId, conversationId, args) || execute();
  });
}

export async function reserveQuoteDelivery(db, hotelId, conversationId, offerId, messageId) {
  return transaction(db, async tx => {
    await upsellLock(tx, hotelId);
    const offer = await tx.pmsUpsellOffer.findFirst({ where: { hotelId, conversationId, id: offerId } });
    if (!offer) throw new Error('Quote not found in this conversation');
    const sent = await tx.message.findFirst({ where: { conversationId, author: { in: ['ai', 'staff'] }, body: { contains: offer.id.toUpperCase() }, OR: [{ deliveryStatus: null }, { deliveryStatus: { not: 'failed' } }] } });
    if (sent) return false;
    return (await tx.pmsUpsellOffer.updateMany({ where: { id: offer.id, hotelId, deliveryMessageId: null }, data: { deliveryMessageId: messageId } })).count === 1;
  });
}
