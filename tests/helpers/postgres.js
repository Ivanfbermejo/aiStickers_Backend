import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const prismaCli = path.join(projectRoot, 'node_modules/prisma/build/index.js');
const schemaPath = path.join(projectRoot, 'prisma/schema.prisma');

/**
 * These tests only run when a real PostgreSQL instance is reachable via
 * DATABASE_URL. They are skipped (not failed) otherwise so `npm test` stays
 * green in environments without a database (e.g. plain CI without a
 * Postgres service). See docs/data-model.md and compose.dev.yml for how to
 * provision one locally.
 */
export function hasTestDatabase() {
  return typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.trim() !== '';
}

export function getBaseDatabaseUrl() {
  return process.env.DATABASE_URL;
}

/** Build a connection string for a different database name on the same server. */
export function withDatabaseName(baseUrl, databaseName) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/** Run `prisma migrate deploy` against the given DATABASE_URL. Never touches the CLI via PATH/npx. */
export async function migrateDeploy(databaseUrl) {
  return execFileAsync(process.execPath, [prismaCli, 'migrate', 'deploy', `--schema=${schemaPath}`], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl }
  });
}
