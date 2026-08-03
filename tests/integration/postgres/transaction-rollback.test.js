import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hasTestDatabase, getBaseDatabaseUrl, migrateDeploy } from '../../helpers/postgres.js';

describe.skipIf(!hasTestDatabase())('Transaction rollback (real database)', () => {
  let prisma;

  beforeAll(async () => {
    const databaseUrl = getBaseDatabaseUrl();
    await migrateDeploy(databaseUrl);
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rolls back every write when a later statement in the transaction fails', async () => {
    const email = `${randomUUID()}@example.test`;

    await expect(
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email, name: 'Rollback Test' } });
        await tx.balance.create({ data: { userId: user.id, stickerDollars: 50 } });
        // Intentionally violates the ledger amount CHECK constraint to force a rollback.
        await tx.ledgerEntry.create({
          data: { userId: user.id, type: 'PURCHASE', amount: -1, balanceAfter: 50 }
        });
      })
    ).rejects.toThrow();

    const persistedUser = await prisma.user.findUnique({ where: { email } });
    expect(persistedUser).toBeNull();
  });

  it('commits every write when the transaction succeeds', async () => {
    const email = `${randomUUID()}@example.test`;

    const { user } = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({ data: { email, name: 'Commit Test' } });
      await tx.balance.create({ data: { userId: createdUser.id, stickerDollars: 20 } });
      return { user: createdUser };
    });

    const persistedUser = await prisma.user.findUnique({ where: { email } });
    const persistedBalance = await prisma.balance.findUnique({ where: { userId: user.id } });
    expect(persistedUser).not.toBeNull();
    expect(persistedBalance?.stickerDollars).toBe(20);

    // Cleanup (this suite intentionally writes committed rows for the assertion above).
    await prisma.balance.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });
});
