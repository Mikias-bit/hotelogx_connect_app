// All mutations are restricted to a randomly named disposable schema. Providers are mocked.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import pkg from '@prisma/client';
if (!process.argv[2]) throw new Error('Pass backend .env path; contents are never printed');
const source = dotenv.parse(readFileSync(process.argv[2]));
const url = new URL(source.DIRECT_DATABASE_URL || source.DATABASE_URL);
if (url.pathname !== '/hotelogx_connect_v2') throw new Error('Expected designated test-data database hotelogx_connect_v2');
const schema = `upsells_test_${randomBytes(8).toString('hex')}`;
const admin = new pkg.PrismaClient({ datasources: { db: { url: url.toString() } } });
function run(args, env) {
  const child = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 240000 });
  const output = (child.stdout + child.stderr).replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[REDACTED_DATABASE_URL]');
  if (child.status !== 0) { console.error(output); throw new Error('Isolated upsell database validation failed'); }
  if (args[0] === '--test') process.stdout.write(output);
}
let created = false;
try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  url.searchParams.set('schema', schema);
  const env = { ...process.env, DATABASE_URL: url.toString(), DIRECT_DATABASE_URL: url.toString(), UPSELL_TEST_DATABASE_URL: url.toString() };
  run(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], env);
  console.log('Migrations applied in disposable upsell test schema.');
  run(['--test', 'src/tests/upsellOutreachDatabase.test.js'], env);
} catch (error) {
  console.error(`Upsell database check failed: ${error.code || error.errorCode || 'database unavailable or validation failed'}`);
  process.exitCode = 1;
} finally {
  if (created) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
  if (created) console.log('Disposable upsell test schema removed.');
}
