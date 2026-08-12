import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hasTestDatabase, getBaseDatabaseUrl, migrateDeploy } from '../helpers/postgres.js';

describe.skipIf(!hasTestDatabase())('PostgreSQL cross-tenant constraints', () => {
  let prisma;
  const createdUserIds = [];

  beforeAll(async () => {
    const databaseUrl = getBaseDatabaseUrl();
    await migrateDeploy(databaseUrl);
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });

  afterEach(async () => {
    // Cascades (packages -> telegram_pack_links/stickers, users -> packages)
    // handle most cleanup; delete users last so FKs never block it.
    for (const userId of createdUserIds.splice(0)) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createUser(overrides = {}) {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, ...overrides }
    });
    createdUserIds.push(user.id);
    return user;
  }

  it('rejects a telegram_pack_link that references a package owned by another user', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const pkg = await prisma.package.create({
      data: {
        userId: userA.id,
        name: 'Owner pack',
        packType: 'STATIC',
        exportStatus: 'PENDING'
      }
    });

    await expect(prisma.telegramPackLink.create({
      data: {
        userId: userB.id,
        telegramUserId: '1',
        packageId: pkg.id,
        setName: `set_by_other_bot_${randomUUID()}`,
        status: 'PENDING'
      }
    })).rejects.toThrow();

    const link = await prisma.telegramPackLink.create({
      data: {
        userId: userA.id,
        telegramUserId: '1',
        packageId: pkg.id,
        setName: `set_by_owner_bot_${randomUUID()}`,
        status: 'PENDING'
      }
    });
    expect(link).toBeDefined();
    expect(link.status).toBe('PENDING');
  });

  it('rejects a sticker linked to a package owned by another user', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const pkg = await prisma.package.create({
      data: {
        userId: userA.id,
        name: 'Owner pack 2',
        packType: 'STATIC',
        exportStatus: 'PENDING'
      }
    });

    await expect(prisma.sticker.create({
      data: {
        userId: userB.id,
        packageId: pkg.id,
        status: 'DONE',
        cost: 1
      }
    })).rejects.toThrow();

    const sticker = await prisma.sticker.create({
      data: {
        userId: userA.id,
        packageId: pkg.id,
        status: 'DONE',
        cost: 1
      }
    });
    expect(sticker).toBeDefined();
  });
});
