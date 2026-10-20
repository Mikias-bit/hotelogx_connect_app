import { randomUUID } from 'node:crypto';
import pkg from '@prisma/client';

export class MailboxBusyError extends Error {
  constructor() { super('Mailbox processing is already in progress; retry later'); this.status = 503; }
}

// A database lease works across Cloud Run instances and Neon pooled connections.
// Work has an 8-minute budget, below the 15-minute lease. Every external request
// is bounded; ownership is checked before processing and before committing.
export function createMailboxLock(db, { schema = 'public' } = {}) {
  const table = pkg.Prisma.raw(`"${schema.replace(/"/g, '""')}"."GmailMailboxLock"`);
  return async function withMailboxLock(hotelId, work) {
    if (!hotelId) throw new Error('hotelId required');
    const token = randomUUID();
    await db.gmailMailboxLock.upsert({ where: { hotelId }, create: { hotelId }, update: {} });
    const acquired = await db.$executeRaw`
      UPDATE ${table} SET "token" = ${token}, "expiresAt" = NOW() + interval '15 minutes'
      WHERE "hotelId" = ${hotelId} AND ("token" IS NULL OR "expiresAt" < NOW())`;
    if (!acquired) throw new MailboxBusyError();
    const deadline = Date.now() + 8 * 60 * 1000;
    const assertOwned = async () => {
      if (Date.now() >= deadline) throw new Error('Mailbox processing time budget reached; retry required');
      const rows = await db.$queryRaw`SELECT "hotelId" FROM ${table}
        WHERE "hotelId" = ${hotelId} AND "token" = ${token} AND "expiresAt" > NOW()`;
      if (!rows.length) throw new MailboxBusyError();
    };
    try { return await work(assertOwned); }
    finally {
      await db.gmailMailboxLock.updateMany({ where: { hotelId, token }, data: { token: null, expiresAt: null } });
    }
  };
}
