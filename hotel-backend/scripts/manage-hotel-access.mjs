// Run only by a trusted Hotelogx operator with database access. Never expose as
// a hotel-manager endpoint. This records approval; it does not send an email.
import { readFile } from 'node:fs/promises';
import { approveHotelAccess } from '../src/modules/auth/hotelAccessApproval.js';
import { prisma } from '../src/config/database.js';

const [command, argument] = process.argv.slice(2);
try {
  if (command === 'list') {
    console.log(JSON.stringify(await prisma.hotelAccessRequest.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 100 }), null, 2));
  } else if (command === 'revoke' && argument) {
    const email = argument.trim().toLowerCase();
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`identity:${email}`}))`;
      return tx.hotelOnboardingInvite.updateMany({ where: { email, acceptedAt: null }, data: { revokedAt: new Date() } });
    });
    console.log(`Revoked ${result.count} pending invitation(s). Accepted accounts are not changed.`);
  } else if (command === 'approve' && argument) {
    const input = JSON.parse((await readFile(argument, 'utf8')).replace(/^\uFEFF/, ''));
    const result = await approveHotelAccess(prisma, input);
    console.log(JSON.stringify(result, null, 2));
    console.log('Approval recorded. Send the matching email an invitation from Netlify Identity, with the invitation path set to /login.');
  } else throw new Error('Usage: node scripts/manage-hotel-access.mjs list | approve <approval.json> | revoke <email>');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
