import { createPmsMcpClient } from './pmsMcpClient.js';
import { unpackMcp } from './pmsAiTools.js';

const directStaff = new Set(['InPerson', 'Phone', 'Email', 'Website', 'Message']);
const providers = [['Booking.com', /booking\.com/i], ['Expedia', /\bexpedia\b/i], ['Agoda', /\bagoda\b/i], ['Hotels.com', /hotels\.com/i], ['Trip.com', /trip\.com/i], ['Airbnb', /\bairbnb\b/i]];
export function classifyBookingOrigin(reservation, ownBooking = false) {
  if (!reservation) return { type: 'unknown', reason: 'Reservation source unavailable' };
  const origin = reservation.Origin || '', commander = reservation.CommanderOrigin || origin.replace(/^Commander/, '');
  const details = String(reservation.OriginDetails || '');
  const provider = providers.find(([, pattern]) => pattern.test(details))?.[0] || null;
  // An agency/channel reference wins over an otherwise direct-looking origin.
  if (reservation.TravelAgencyId || reservation.ChannelNumber || ['ChannelManager', 'CommanderChannel'].includes(origin) || (origin === 'Commander' && commander === 'Channel') || provider || /\b(GDS|Amadeus|Sabre|Travelport|Galileo|Worldspan)\b/i.test(details)) {
    return { type: 'external', provider, origin, reason: 'PMS agency or distribution-channel source' };
  }
  if (origin === 'Distributor' || origin === 'Navigator' || (origin.startsWith('Commander') && directStaff.has(commander)) || (origin === 'Connector' && ownBooking)) {
    return { type: 'direct', origin, reason: ownBooking ? 'Reservation created by Hotelogx' : 'PMS direct booking source' };
  }
  return { type: 'unknown', origin, reason: 'PMS source does not establish a direct or agency booking' };
}

export async function lookupBookingOrigin(db, { hotelId, conversationId }, { client = createPmsMcpClient(), actor } = {}) {
  const binding = await db.pmsConversationBinding.findFirst({ where: { hotelId, conversationId } });
  if (!binding || (binding.expiresAt && binding.expiresAt <= new Date())) return { type: 'unknown', reason: 'Reservation verification required' };
  try {
    const staff = actor || await db.user.findFirst({ where: { hotelId, role: { in: ['manager', 'front-office'] } } });
    if (!staff || staff.hotelId !== hotelId || !['manager', 'front-office'].includes(staff.role)) return { type: 'unknown', reason: 'Authorized PMS read unavailable' };
    const data = unpackMcp(await client.callTool(staff, 'get_reservations', { reservation_ids: [binding.reservationId] }));
    const reservation = data.Reservations?.find(r => r.Id === binding.reservationId && r.AccountType === 'Customer' && r.AccountId === binding.customerId);
    if (!reservation) return { type: 'unknown', reason: 'Verified reservation could not be matched' };
    const ownBooking = reservation.Origin === 'Connector' && !!await db.pmsBookingOffer.findFirst({ where: { hotelId, status: 'booked', result: { path: ['reservation_id'], equals: reservation.Id } } });
    return { ...classifyBookingOrigin(reservation, ownBooking), reservationId: reservation.Id, customerId: reservation.AccountId, checkedAt: new Date().toISOString() };
  } catch { return { type: 'unknown', reason: 'PMS source check unavailable; retry before routing' }; }
}

export function sourceReply(source) {
  if (source.type === 'external') return `Please request the cancellation or amendment through ${source.provider || 'the travel agency or booking service shown on your booking confirmation'}. They manage changes to this booking. Your reservation has not been changed or cancelled by the hotel.`;
  if (source.type === 'direct') return 'Your direct-booking request has been passed to Front Office and management for review. Your reservation has not been changed or cancelled yet.';
  return 'Before routing your request, we need to verify your reservation and confirm how it was booked. No cancellation or amendment has been made. If you booked through a travel agency or booking website, please contact the provider shown on your confirmation.';
}
