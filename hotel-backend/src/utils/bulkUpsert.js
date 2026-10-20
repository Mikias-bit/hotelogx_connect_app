import { Prisma } from '@prisma/client';

// Identifiers are application-owned; values are always bound parameters.
const identifier = (name) => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid SQL identifier');
  return Prisma.raw(`"${name}"`);
};

export async function bulkUpsert(prisma, table, columns, rows, keys, updates) {
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch = rows.slice(offset, offset + 500);
    if (batch.some(row => row.length !== columns.length)) throw new Error('Invalid upsert row');
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${identifier(table)} (${Prisma.join(columns.map(identifier))})
      VALUES ${Prisma.join(batch.map(row => Prisma.sql`(${Prisma.join(row.map(value => value ?? null))})`))}
      ON CONFLICT (${Prisma.join(keys.map(identifier))}) DO UPDATE SET
      ${Prisma.join(updates.map(column => Prisma.sql`${identifier(column)} = EXCLUDED.${identifier(column)}`))}
    `);
  }
}
