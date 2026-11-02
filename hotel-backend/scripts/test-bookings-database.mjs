// Validates both Prisma migration and Python MCP SQL in an isolated test schema.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import dotenv from 'dotenv';
import pkg from '@prisma/client';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2]) throw new Error('Pass the backend .env path; contents are never printed');
const source = dotenv.parse(readFileSync(process.argv[2]));
const url = new URL(source.DIRECT_DATABASE_URL || source.DATABASE_URL);
if (url.pathname !== '/hotelogx_connect_v2') throw new Error('Expected designated test-data database hotelogx_connect_v2');
const schema = `bookings_test_${randomBytes(8).toString('hex')}`;
const admin = new pkg.PrismaClient({ datasources: { db: { url: url.toString() } } });
const repo = resolve(process.argv[3] || join(root, '../../hotelogx-pms-mcp'));
const python = process.argv[4] || join(repo, process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python');
const run = (command, args, env) => {
  const child = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 240000 });
  if (child.status !== 0) { console.error((child.stdout + child.stderr).replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[REDACTED_DATABASE_URL]')); throw new Error('Isolated booking database validation failed'); }
  if (command === python) process.stdout.write(child.stdout || '');
};
try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('schema', schema);
  const env = { ...process.env, DATABASE_URL: url.toString(), DIRECT_DATABASE_URL: url.toString() };
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], env);
  console.log('Migrations applied in disposable booking test schema.');
  url.searchParams.delete('schema'); url.searchParams.set('options', `-csearch_path=${schema}`);
  run(python, ['-m', 'pytest', join(repo, 'tests/mews/test_booking_database.py'), '-q', '-p', 'no:cacheprovider'], { ...env, PYTHONPATH: join(repo, 'src'), PYTHONDONTWRITEBYTECODE: '1', BOOKING_TEST_DATABASE_URL: url.toString() });
} finally {
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
  console.log('Disposable booking test schema removed.');
}
