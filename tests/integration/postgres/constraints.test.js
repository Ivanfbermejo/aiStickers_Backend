import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hasTestDatabase, getBaseDatabaseUrl, migrateDeploy } from '../../helpers/postgres.js';

describe.skipIf(!hasTestDatabase())('PostgreSQL schema constraints (real database)', () => {
  let prisma;
  const createdUserIds = [];

  beforeAll(async () => {
    const databaseUrl = getBaseDatabaseUrl();
    await migrateDeploy(databaseUrl);
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });

  afterEach(async () => {
    // Clean up in FK-safe order; ON DELETE CASCADE/RESTRICT means the user
    // itself must go last, and RESTRICT-protected rows must be removed first.
    for (const userId of createdUserIds.splice(0)) {
      await prisma.ledgerEntry.deleteMany({ where: { userId } });
      await prisma.purchase.deleteMany({ where: { userId } });
      await prisma.balance.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createUser(overrides = {}) {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, name: 'Test User', ...overrides }
    });
    createdUserIds.push(user.id);
    return user;
  }

  it('rejects a duplicate email (unique constraint)', async () => {
    const email = `${randomUUID()}@example.test`;
    await createUser({ email });

    await expect(createUser({ email })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects an AuthIdentity referencing a non-existent user (foreign key constraint)', async () => {
    await expect(
      prisma.authIdentity.create({
        data: { userId: randomUUID(), provider: 'GOOGLE', subject: randomUUID() }
      })
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects a duplicate (provider, subject) identity pair (unique constraint)', async () => {
    const user = await createUser();
    const subject = randomUUID();
    await prisma.authIdentity.create({ data: { userId: user.id, provider: 'GOOGLE', subject } });

    await expect(
      prisma.authIdentity.create({ data: { userId: user.id, provider: 'GOOGLE', subject } })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a negative balance (check constraint)', async () => {
    const user = await createUser();

    await expect(
      prisma.balance.create({ data: { userId: user.id, stickerDollars: -1 } })
    ).rejects.toThrow(/check constraint|balances_stickerDollars_nonnegative/i);
  });

  it('rejects a non-positive ledger entry amount (check constraint)', async () => {
    const user = await createUser();
    await prisma.balance.create({ data: { userId: user.id, stickerDollars: 10 } });

    await expect(
      prisma.ledgerEntry.create({
        data: { userId: user.id, type: 'SPEND', amount: 0, balanceAfter: 10 }
      })
    ).rejects.toThrow(/check constraint|ledger_entries_amount_positive/i);
  });

  it('rejects a duplicate purchase token for the same provider (unique constraint)', async () => {
    const user = await createUser();
    const purchaseTokenHash = randomUUID();
    await prisma.purchase.create({
      data: {
        userId: user.id,
        provider: 'GOOGLE_PLAY',
        productId: 'pack_100',
        purchaseTokenHash,
        stickerAmount: 100
      }
    });

    await expect(
      prisma.purchase.create({
        data: {
          userId: user.id,
          provider: 'GOOGLE_PLAY',
          productId: 'pack_100',
          purchaseTokenHash,
          stickerAmount: 100
        }
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows exactly one balance row per user (primary key on userId)', async () => {
    const user = await createUser();
    await prisma.balance.create({ data: { userId: user.id, stickerDollars: 5 } });

    await expect(
      prisma.balance.create({ data: { userId: user.id, stickerDollars: 5 } })
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
