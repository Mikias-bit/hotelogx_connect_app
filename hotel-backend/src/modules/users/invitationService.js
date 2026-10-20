import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';
import { sendStaffInvitationEmail } from '../../utils/mailer.js';

const titles = { manager: 'General Manager', 'front-office': 'Front Desk Agent', housekeeping: 'Housekeeping Staff', maintenance: 'Maintenance Technician' };
const fail = (message, status) => Object.assign(new Error(message), { status });

export function createInvitationService({ db = prisma, send = sendStaffInvitationEmail } = {}) {
  return async function invite(actor, input) {
    if (!actor?.hotelId || actor.role !== 'manager') throw fail('Only a hotel manager can invite staff.', 403);
    const email = String(input.email || input.address || '').trim().toLowerCase();
    const role = input.role || 'front-office';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n]/.test(email)) throw fail('Enter a valid staff email address.', 400);
    if (!Object.hasOwn(titles, role)) throw fail('Invalid staff role.', 400);
    const hotel = await db.hotel.findUnique({ where: { id: actor.hotelId } });
    if (!hotel) throw fail('Hotel not found.', 404);
    const integration = await db.emailIntegration.findUnique({ where: { hotelId: actor.hotelId } });
    if (integration?.status !== 'connected') throw fail('Connect the hotel email account before inviting staff.', 409);
    const existing = await db.user.findUnique({ where: { email } });
    if (existing && existing.hotelId !== actor.hotelId) throw fail('This email belongs to another hotel.', 409);
    if (existing && (existing.id === actor.id || existing.role === 'manager' || existing.role !== role)) {
      throw fail('This email already belongs to an existing account. Invitations cannot change its role. Use a different staff email.', 409);
    }
    if (existing && !existing.passwordHash) throw fail('This existing account needs password setup before an invitation can be resent.', 409);
    const temporaryPassword = existing ? null : crypto.randomBytes(18).toString('base64url');
    let user = existing;
    if (!user) {
      const name = String(input.name || email.split('@')[0]).trim();
      user = await db.user.create({ data: {
        hotelId: actor.hotelId, email, role, name,
        title: input.title || titles[role], phone: input.phone || '',
        initials: name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase(),
        whatsapp: input.whatsapp ?? ['housekeeping', 'maintenance'].includes(role),
        lastActive: 'Invited just now', passwordHash: await bcrypt.hash(temporaryPassword, 10),
      } });
    }
    try {
      const result = await send({ hotelId: actor.hotelId, toEmail: email, toName: user.name,
        title: user.title, hotelName: hotel.name, temporaryPassword });
      if (!result?.success || result.simulated) throw new Error('Provider did not accept the invitation.');
    } catch (error) {
      // Failed new invitations can be retried without leaving an unusable account.
      if (!existing) await db.user.delete({ where: { id: user.id } });
      throw fail('Invitation could not be sent. Check the connected hotel mailbox and retry.', 502);
    }
    await db.activityItem.create({ data: {
      id: crypto.randomUUID(), hotelId: actor.hotelId, at: new Date().toISOString(), kind: 'task',
      text: `Invitation accepted by email provider: ${email} (${role})`, meta: 'Staff invitation',
    } }).catch(() => {});
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  };
}

export const inviteStaff = createInvitationService();
