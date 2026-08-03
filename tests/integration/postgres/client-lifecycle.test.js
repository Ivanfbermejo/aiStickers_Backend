import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDatabase, getBaseDatabaseUrl, migrateDeploy } from '../../helpers/postgres.js';

describe.skipIf(!hasTestDatabase())('Prisma client connection lifecycle (real database)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = getBaseDatabaseUrl();
    await migrateDeploy(process.env.DATABASE_URL);
  });

  afterAll(async () => {
    const { disconnectPrisma } = await import('../../../src/infrastructure/persistence/prisma/client.js');
    await disconnectPrisma();
  });

  it('connects, pings and cleanly disconnects, and can reconnect afterwards', async () => {
    const { pingDatabase, disconnectPrisma, getPrismaClient } = await import(
      '../../../src/infrastructure/persistence/prisma/client.js'
    );

    await expect(pingDatabase()).resolves.toBeUndefined();

    const firstClient = getPrismaClient();
    await disconnectPrisma();

    // A new client instance is created lazily after disconnecting...
    const secondClient = getPrismaClient();
    expect(secondClient).not.toBe(firstClient);

    // ...and it can actually reach the database again.
    await expect(pingDatabase()).resolves.toBeUndefined();

    await disconnectPrisma();
  });

  it('disconnectPrisma is safe to call multiple times', async () => {
    const { disconnectPrisma } = await import('../../../src/infrastructure/persistence/prisma/client.js');
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    await expect(disconnectPrisma()).resolves.toBeUndefined();
  });
});
