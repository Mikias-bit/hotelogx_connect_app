// Local test harness: uses a disposable schema, never the public application schema.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pkg from '@prisma/client';
const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = process.argv[2];
if (!envPath) throw new Error('Pass path to the backend .env (contents are never printed)');
const source = dotenv.parse(readFileSync(envPath));
const url = new URL(source.DIRECT_DATABASE_URL || source.DATABASE_URL);
if (url.pathname !== '/hotelogx_connect_v2') throw new Error('Expected the designated test-data database hotelogx_connect_v2');
const schema = `handoffs_test_${randomBytes(8).toString('hex')}`;
const admin = new pkg.PrismaClient({ datasources: { db: { url: url.toString() } } });
const run = args => {
  const child = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_DATABASE_URL: url.toString(),
    NODE_ENV: 'test', JWT_SECRET: 'isolated-gmail-test', OPENAI_API_KEY: '', GOOGLE_OAUTH_CLIENT_ID: '', HANDOFFS_DATABASE_TESTS: 'true' }, encoding: 'utf8', timeout: 240000 });
  if (args[0] === '--test') process.stdout.write(child.stdout || '');
  if (child.status !== 0) { console.error('Test/migration command failed:', (child.stderr || '').replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[REDACTED_DATABASE_URL]')); throw new Error('Isolated database validation failed'); }
};
try {
  // The identifier is generated locally from a fixed prefix and random hex.
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('schema', schema);
  run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  console.log('All migrations applied successfully in disposable test schema.');
  run(['--test', 'src/tests/guestHandoffsDatabase.test.js']);
} finally {
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
  console.log('Disposable handoffs test schema removed.');
}

