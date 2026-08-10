import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

describe.skipIf(!process.env.DATABASE_URL)('PostgreSQL cross-tenant constraints', () => {
  let prisma;

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { stdio: 'pipe' });
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } }
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('rejects a telegram_pack_link that references a package owned by another user', async () => {
    const userA = await prisma.user.create({ data: { email: 'pg-owner@example.com' } });
    const userB = await prisma.user.create({ data: { email: 'pg-other@example.com' } });
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
        setName: 'set_by_other_bot',
        status: 'PENDING'
      }
    })).rejects.toThrow();

    const link = await prisma.telegramPackLink.create({
      data: {
        userId: userA.id,
        telegramUserId: '1',
        packageId: pkg.id,
        setName: 'set_by_owner_bot',
        status: 'PENDING'
      }
    });
    expect(link).toBeDefined();
    expect(link.status).toBe('PENDING');
  });

  it('rejects a sticker linked to a package owned by another user', async () => {
    const userA = await prisma.user.create({ data: { email: 'pg-owner2@example.com' } });
    const userB = await prisma.user.create({ data: { email: 'pg-other2@example.com' } });
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
