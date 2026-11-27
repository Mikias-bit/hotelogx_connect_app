import { randomUUID } from 'node:crypto';
export async function approveHotelAccess(db, input) {
    const email = String(input.email || '').trim().toLowerCase(), name = String(input.name || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 120 || !input.approvedBy || typeof input.approvedBy !== 'string') throw new Error('Supply email, name and approvedBy in the JSON file.');
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(Date.now() + 14 * 86400000);
    if (!(expiresAt > new Date())) throw new Error('expiresAt must be a future date.');
    const result = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`identity:${email}`}))`;
      const previous = await tx.hotelOnboardingInvite.findUnique({ where: { email } });
      if (previous) throw new Error('An invitation already exists. Review it in Neon; this command never overwrites prior approval.');
      let hotel;
      if (input.hotelId) {
        hotel = await tx.hotel.findUnique({ where: { id: input.hotelId } });
        if (!hotel) throw new Error('Existing hotelId not found.');
      } else {
        if (!input.hotelName || typeof input.hotelName !== 'string' || input.hotelName.length > 200) throw new Error('Supply hotelName for a new hotel, or an existing hotelId.');
        hotel = await tx.hotel.create({ data: { id: `hotel-${randomUUID()}`, name: input.hotelName.trim(), legalName: '', roomsCount: 0,
          address: '', postcode: '', city: '', country: '', phone: '', email, website: '', bookingEngine: '', whatsappNumber: '', vatNumber: '', description: '',
          onboardingDone: false, onboardingSteps: '[]', aiMode: 'Manual' } });
      }
      const user = await tx.user.findUnique({ where: { email } });
      if (user && (user.hotelId !== hotel.id || user.role !== 'manager' || user.netlifyIdentityId || input.linkExistingUser !== true)) throw new Error('Existing users require the same hotel/manager role and explicit linkExistingUser: true.');
      const invite = await tx.hotelOnboardingInvite.create({ data: { hotelId: hotel.id, email, name, role: 'manager', approvedBy: input.approvedBy, expiresAt } });
      await tx.hotelAccessRequest.updateMany({ where: { email }, data: { status: 'approved' } });
      return { hotelId: hotel.id, email, invitationId: invite.id, expiresAt };
    });

return result;
}
