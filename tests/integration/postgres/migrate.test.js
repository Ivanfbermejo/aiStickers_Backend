import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hasTestDatabase, getBaseDatabaseUrl, withDatabaseName, migrateDeploy } from '../../helpers/postgres.js';

const scratchDbName = `aistickers_migrate_test_${Date.now()}`;

describe.skipIf(!hasTestDatabase())('prisma migrate deploy (real PostgreSQL)', () => {
  let adminClient;
  let scratchUrl;

  beforeAll(async () => {
    const baseUrl = getBaseDatabaseUrl();
    scratchUrl = withDatabaseName(baseUrl, scratchDbName);

    // Connect to the default "postgres" database to create/drop the scratch DB.
    adminClient = new PrismaClient({ datasources: { db: { url: withDatabaseName(baseUrl, 'postgres') } } });
    await adminClient.$executeRawUnsafe(`CREATE DATABASE "${scratchDbName}"`);
  });

  afterAll(async () => {
    await adminClient.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${scratchDbName}' AND pid <> pg_backend_pid()`
    );
    await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratchDbName}"`);
    await adminClient.$disconnect();
  });

  it('applies all migrations to a brand new, empty database', async () => {
    const { stdout } = await migrateDeploy(scratchUrl);
    expect(stdout).toMatch(/migrations? .* successfully applied|already in sync/i);

    const client = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
    try {
      const tables = await client.$queryRawUnsafe(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
      );
      const tableNames = tables.map((t) => t.table_name);
      expect(tableNames).toEqual(
        expect.arrayContaining([
          'users',
          'auth_identities',
          'auth_sessions',
          'balances',
          'ledger_entries',
          'purchases',
          'packages',
          'stickers',
          'generation_jobs'
        ])
      );
    } finally {
      await client.$disconnect();
    }
  }, 20000);

  it('is repeatable: re-running migrate deploy on an already-migrated database is a no-op', async () => {
    const { stdout } = await migrateDeploy(scratchUrl);
    expect(stdout).toMatch(/no pending migrations to apply/i);
  }, 20000);
});
