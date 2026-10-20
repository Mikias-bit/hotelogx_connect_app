import { config } from './env.js';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

export const prisma = new PrismaClient({
  datasources: { db: { url: config.databaseUrl } },
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});
