import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { User } from '../../src/domain/entities/user.entity.js';
import { Balance } from '../../src/domain/entities/balance.entity.js';
import { Transaction } from '../../src/domain/entities/transaction.entity.js';
import { Purchase } from '../../src/domain/entities/purchase.entity.js';
import { Sticker } from '../../src/domain/entities/sticker.entity.js';
import { Package } from '../../src/domain/entities/package.entity.js';
import { GenerationJob } from '../../src/domain/entities/generation-job.entity.js';
import { Session } from '../../src/domain/entities/session.entity.js';
import { TelegramPackLink } from '../../src/domain/entities/telegram-pack-link.entity.js';

import { JsonUserRepository } from '../../src/infrastructure/persistence/json/json-user.repository.js';
import { JsonBalanceRepository } from '../../src/infrastructure/persistence/json/json-balance.repository.js';
import { JsonTransactionRepository } from '../../src/infrastructure/persistence/json/json-transaction.repository.js';
import { JsonPurchaseRepository } from '../../src/infrastructure/persistence/json/json-purchase.repository.js';
import { JsonStickerRepository } from '../../src/infrastructure/persistence/json/json-sticker.repository.js';
import { JsonPackageRepository } from '../../src/infrastructure/persistence/json/json-package.repository.js';
import { JsonGenerationJobRepository } from '../../src/infrastructure/persistence/json/json-generation-job.repository.js';
import { JsonSessionRepository } from '../../src/infrastructure/persistence/json/json-session.repository.js';
import { JsonTelegramPackLinkRepository } from '../../src/infrastructure/persistence/json/json-telegram-pack-link.repository.js';

import { PostgresUserRepository } from '../../src/infrastructure/persistence/postgres/postgres-user.repository.js';
import { PostgresBalanceRepository } from '../../src/infrastructure/persistence/postgres/postgres-balance.repository.js';
import { PostgresTransactionRepository } from '../../src/infrastructure/persistence/postgres/postgres-transaction.repository.js';
import { PostgresPurchaseRepository } from '../../src/infrastructure/persistence/postgres/postgres-purchase.repository.js';
import { PostgresStickerRepository } from '../../src/infrastructure/persistence/postgres/postgres-sticker.repository.js';
import { PostgresPackageRepository } from '../../src/infrastructure/persistence/postgres/postgres-package.repository.js';
import { PostgresGenerationJobRepository } from '../../src/infrastructure/persistence/postgres/postgres-generation-job.repository.js';
import { PostgresSessionRepository } from '../../src/infrastructure/persistence/postgres/postgres-session.repository.js';
import { PostgresTelegramPackLinkRepository } from '../../src/infrastructure/persistence/postgres/postgres-telegram-pack-link.repository.js';

import { getPrismaClient, disconnectPrisma } from '../../src/infrastructure/persistence/prisma/client.js';
import { hasTestDatabase, getBaseDatabaseUrl, migrateDeploy } from '../helpers/postgres.js';

function uniqueEmail() {
  return `${randomUUID()}@contract.test`;
}

function uniqueStr(prefix = 'u') {
  return `${prefix}_${randomUUID()}`;
}

function makeJsonDriver() {
  let dataDir;
  return {
    name: 'json',
    async setup() {
      dataDir = mkdtempSync(join(tmpdir(), 'aistickers-contract-'));
      const repos = {
        user: new JsonUserRepository(dataDir),
        balance: new JsonBalanceRepository(dataDir),
        transaction: new JsonTransactionRepository(dataDir),
        purchase: new JsonPurchaseRepository(dataDir),
        sticker: new JsonStickerRepository(dataDir),
        package: new JsonPackageRepository(dataDir),
        generationJob: new JsonGenerationJobRepository(dataDir),
        telegramPackLink: new JsonTelegramPackLinkRepository(dataDir),
        session: new JsonSessionRepository(dataDir)
      };
      const createdUserIds = [];
      const createUser = async (overrides = {}) => {
        const id = overrides.id ?? `user_${randomUUID()}`;
        const user = new User({ id, email: uniqueEmail(), name: 'Test', googleId: null, ...overrides });
        await repos.user.save(user);
        createdUserIds.push(id);
        return id;
      };
      return { repos, createUser };
    },
    async teardown() {
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

function makePostgresDriver() {
  const createdUserIds = [];
  return {
    name: 'postgres',
    async setup() {
      await migrateDeploy(getBaseDatabaseUrl());
      const repos = {
        user: new PostgresUserRepository(),
        balance: new PostgresBalanceRepository(),
        transaction: new PostgresTransactionRepository(),
        purchase: new PostgresPurchaseRepository(),
        sticker: new PostgresStickerRepository(),
        package: new PostgresPackageRepository(),
        generationJob: new PostgresGenerationJobRepository(),
        telegramPackLink: new PostgresTelegramPackLinkRepository(),
        session: new PostgresSessionRepository()
      };
      const prisma = getPrismaClient();
      const createUser = async (overrides = {}) => {
        const user = await prisma.user.create({
          data: {
            email: uniqueEmail(),
            name: 'Test',
            ...overrides
          }
        });
        createdUserIds.push(user.id);
        return user.id;
      };
      return { repos, createUser };
    },
    async teardown() {
      const prisma = getPrismaClient();
      for (const userId of createdUserIds.splice(0)) {
        await prisma.authSession.deleteMany({ where: { userId } });
        await prisma.authIdentity.deleteMany({ where: { userId } });
        await prisma.generationJob.deleteMany({ where: { userId } });
        await prisma.sticker.deleteMany({ where: { userId } });
        await prisma.package.deleteMany({ where: { userId } });
        await prisma.ledgerEntry.deleteMany({ where: { userId } });
        await prisma.purchase.deleteMany({ where: { userId } });
        await prisma.balance.deleteMany({ where: { userId } });
        await prisma.user.deleteMany({ where: { id: userId } });
      }
      await disconnectPrisma();
    }
  };
}

const drivers = [makeJsonDriver()];
if (hasTestDatabase()) {
  drivers.push(makePostgresDriver());
}

async function clearPostgresDatabase() {
  const prisma = new PrismaClient({ datasources: { db: { url: getBaseDatabaseUrl() } } });
  await prisma.authSession.deleteMany({});
  await prisma.authIdentity.deleteMany({});
  await prisma.generationJob.deleteMany({});
  await prisma.sticker.deleteMany({});
  await prisma.package.deleteMany({});
  await prisma.ledgerEntry.deleteMany({});
  await prisma.purchase.deleteMany({});
  await prisma.balance.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.$disconnect();
}

for (const driver of drivers) {
  describe.skipIf(driver.name === 'postgres' && !hasTestDatabase())(`${driver.name} repository contract`, () => {
    let ctx;

    beforeAll(async () => {
      if (driver.name === 'postgres') {
        await clearPostgresDatabase();
      }
    });

    beforeEach(async () => {
      ctx = await driver.setup();
    });

    afterEach(async () => {
      await driver.teardown();
    });

    describe('UserRepository', () => {
      it('saves and finds a user by id, email and googleId', async () => {
        const user = new User({ id: `user_${randomUUID()}`, email: uniqueEmail(), name: 'Ada', googleId: 'google-123' });
        await ctx.repos.user.save(user);

        expect(await ctx.repos.user.findById(user.id)).toMatchObject({ id: user.id, email: user.email });
        expect(await ctx.repos.user.findByEmail(user.email)).toMatchObject({ id: user.id });
        expect(await ctx.repos.user.findByGoogleId('google-123')).toMatchObject({ id: user.id });
        expect(await ctx.repos.user.exists(user.email)).toBe(true);
      });

      it('updates a user', async () => {
        const user = new User({ id: `user_${randomUUID()}`, email: uniqueEmail(), name: 'Ada' });
        await ctx.repos.user.save(user);
        user.name = 'Grace';
        user.updatedAt = new Date().toISOString();
        await ctx.repos.user.update(user);
        const found = await ctx.repos.user.findById(user.id);
        expect(found.name).toBe('Grace');
      });

      it('deletes a user', async () => {
        const user = new User({ id: `user_${randomUUID()}`, email: uniqueEmail(), name: 'Ada' });
        await ctx.repos.user.save(user);
        await ctx.repos.user.delete(user.id);
        expect(await ctx.repos.user.findById(user.id)).toBeNull();
      });
    });

    describe('BalanceRepository', () => {
      it('creates and finds a balance', async () => {
        const userId = await ctx.createUser();
        const balance = await ctx.repos.balance.createForUser(userId);
        expect(balance.stickerDollars).toBe(0);
        expect(await ctx.repos.balance.exists(userId)).toBe(true);
        expect(await ctx.repos.balance.findByUserId(userId)).toMatchObject({ userId, stickerDollars: 0 });
      });

      it('updates a balance', async () => {
        const userId = await ctx.createUser();
        const balance = await ctx.repos.balance.createForUser(userId);
        balance.stickerDollars = 10;
        await ctx.repos.balance.update(balance);
        const found = await ctx.repos.balance.findByUserId(userId);
        expect(found.stickerDollars).toBe(10);
      });
    });

    describe('TransactionRepository', () => {
      it('saves and finds transactions by id, user and provider transaction id', async () => {
        const userId = await ctx.createUser();
        const providerTransactionId = uniqueStr('tx');
        const tx = Transaction.createPurchase({
          userId,
          amount: 5,
          productId: 'prod-1',
          provider: 'GOOGLE_PLAY',
          providerTransactionId,
          balanceAfter: 5
        });
        await ctx.repos.transaction.save(tx);

        expect(await ctx.repos.transaction.findById(tx.id)).toMatchObject({ id: tx.id });
        expect(await ctx.repos.transaction.findByProviderTransactionId(providerTransactionId)).toMatchObject({ id: tx.id });
        expect(await ctx.repos.transaction.exists(providerTransactionId)).toBe(true);

        const history = await ctx.repos.transaction.getHistory(userId);
        expect(history).toHaveLength(1);
      });

      it('saves a spend transaction', async () => {
        const userId = await ctx.createUser();
        const tx = Transaction.createSpend({ userId, amount: 2, productId: 'sticker', balanceAfter: 3 });
        await ctx.repos.transaction.save(tx);
        const found = await ctx.repos.transaction.findById(tx.id);
        expect(found.type).toBe('SPEND');
      });
    });

    describe('PurchaseRepository', () => {
      it('saves and finds a purchase by token and user', async () => {
        const userId = await ctx.createUser();
        const purchaseToken = uniqueStr('token');
        const purchase = Purchase.create({ userId, productId: 'prod-1', purchaseToken, provider: 'GOOGLE_PLAY', stickerAmount: 10 });
        await ctx.repos.purchase.save(purchase);

        expect(await ctx.repos.purchase.findByToken(purchaseToken)).toMatchObject({ id: purchase.id });
        expect(await ctx.repos.purchase.exists(purchaseToken)).toBe(true);
        expect(await ctx.repos.purchase.findByUserId(userId)).toHaveLength(1);
      });

      it('updates a purchase status', async () => {
        const userId = await ctx.createUser();
        const purchaseToken = uniqueStr('token');
        const purchase = Purchase.create({ userId, productId: 'prod-1', purchaseToken, provider: 'GOOGLE_PLAY', stickerAmount: 5 });
        await ctx.repos.purchase.save(purchase);
        purchase.verify(uniqueStr('tx'));
        await ctx.repos.purchase.update(purchase);
        const found = await ctx.repos.purchase.findById(purchase.id);
        expect(found.status).toBe('VERIFIED');
      });
    });

    describe('StickerRepository', () => {
      it('saves and finds stickers', async () => {
        const userId = await ctx.createUser();
        const replicateId = uniqueStr('rep');
        const sticker = Sticker.createFromGeneration({ userId, packageId: null, name: 'Test', replicateId, prompt: 'prompt' });
        await ctx.repos.sticker.save(sticker);

        expect(await ctx.repos.sticker.findById(sticker.id)).toMatchObject({ id: sticker.id });
        expect(await ctx.repos.sticker.findById(sticker.id, 'other-user')).toBeNull();
        expect(await ctx.repos.sticker.findByUserId(userId)).toHaveLength(1);
        expect(await ctx.repos.sticker.findByReplicateId(replicateId)).toMatchObject({ id: sticker.id });
        expect(await ctx.repos.sticker.countByUserId(userId)).toBe(1);

        sticker.status = 'done';
        sticker.imageUrl = 'http://example.com/img.png';
        await ctx.repos.sticker.update(sticker);
        expect((await ctx.repos.sticker.findById(sticker.id)).status).toBe('done');
      });
    });

    describe('PackageRepository', () => {
      it('saves and finds packages', async () => {
        const userId = await ctx.createUser();
        const category = uniqueStr('cat');
        const tag = uniqueStr('tag');
        const pkg = Package.create({ userId, name: 'My Pack', category, isPublic: true });
        pkg.addTag(tag);
        await ctx.repos.package.save(pkg);

        expect(await ctx.repos.package.findById(pkg.id)).toMatchObject({ id: pkg.id });
        expect(await ctx.repos.package.findById(pkg.id, 'other-user')).toBeNull();
        expect(await ctx.repos.package.findByUserId(userId)).toHaveLength(1);
        const publicPacks = await ctx.repos.package.findPublic();
        expect(publicPacks.some(p => p.id === pkg.id)).toBe(true);
        expect(await ctx.repos.package.findByCategory(category)).toHaveLength(1);
        expect(await ctx.repos.package.findByTag(tag)).toHaveLength(1);
        expect(await ctx.repos.package.exists(pkg.id)).toBe(true);
      });
    });

    describe('GenerationJobRepository', () => {
      it('saves and finds jobs', async () => {
        const userId = await ctx.createUser();
        const sticker = Sticker.createFromGeneration({ userId, packageId: null, name: 'Test', replicateId: 'rep-2', prompt: 'p' });
        await ctx.repos.sticker.save(sticker);

        const job = GenerationJob.create({ userId, type: 'image_sticker', packageId: null, stickerId: sticker.id, input: { prompt: 'p' }, provider: 'replicate' });
        await ctx.repos.generationJob.save(job);

        expect(await ctx.repos.generationJob.findById(job.id)).toMatchObject({ id: job.id });
        expect(await ctx.repos.generationJob.findByUserId(userId)).toHaveLength(1);
        expect(await ctx.repos.generationJob.findByStickerId(sticker.id)).toMatchObject({ id: job.id });
        expect(await ctx.repos.generationJob.findPending()).toHaveLength(1);
      });
    });

    describe('TelegramPackLinkRepository', () => {
      it('persists a Telegram link and scopes it by local owner', async () => {
        const userId = await ctx.createUser();
        const pkg = Package.create({ userId, name: 'Telegram Pack' });
        await ctx.repos.package.save(pkg);
        const link = TelegramPackLink.create({
          userId,
          telegramUserId: '12345',
          packageId: pkg.id,
          setName: `aistickers_${uniqueStr('set')}_by_bot`,
          stickerFileIds: { sticker_1: 'telegram-file-1' }
        });
        await ctx.repos.telegramPackLink.save(link);

        expect(await ctx.repos.telegramPackLink.findByUserIdAndPackageId(userId, pkg.id))
          .toMatchObject({ telegramUserId: '12345', setName: link.setName });
        expect(await ctx.repos.telegramPackLink.findByUserIdAndPackageId('other-user', pkg.id)).toBeNull();
        expect(await ctx.repos.telegramPackLink.findBySetName(link.setName, 'other-user')).toBeNull();
      });
    });

    describe('SessionRepository', () => {
      it('saves and finds sessions by hash and family', async () => {
        const userId = await ctx.createUser();
        const hash = uniqueStr('hash');
        const family = uniqueStr('fam');
        const session = new Session({
          id: `sess_${randomUUID()}`,
          userId,
          refreshTokenHash: hash,
          family,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          metadata: { ip: '127.0.0.1' }
        });
        await ctx.repos.session.save(session);

        expect(await ctx.repos.session.findById(session.id)).toMatchObject({ id: session.id });
        expect(await ctx.repos.session.findByRefreshTokenHash(hash)).toMatchObject({ id: session.id });
        expect(await ctx.repos.session.findByFamily(family)).toHaveLength(1);

        session.revoke();
        await ctx.repos.session.update(session);
        expect((await ctx.repos.session.findById(session.id)).revokedAt).not.toBeNull();
      });

      it('revokes a whole family', async () => {
        const userId = await ctx.createUser();
        const family = uniqueStr('fam');
        const s1 = new Session({ id: `sess_${randomUUID()}`, userId, refreshTokenHash: uniqueStr('hash'), family, expiresAt: new Date(Date.now() + 86400000).toISOString() });
        const s2 = new Session({ id: `sess_${randomUUID()}`, userId, refreshTokenHash: uniqueStr('hash'), family, expiresAt: new Date(Date.now() + 86400000).toISOString() });
        await ctx.repos.session.save(s1);
        await ctx.repos.session.save(s2);
        await ctx.repos.session.revokeFamily(family);
        const familySessions = await ctx.repos.session.findByFamily(family);
        expect(familySessions.every(s => s.revokedAt !== null)).toBe(true);
      });
    });
  });
}

if (hasTestDatabase()) {
  describe('PostgreSQL-only concurrency and parity', () => {
    let prisma;
    let repos;
    const createdUserIds = [];

    beforeAll(async () => {
      await migrateDeploy(getBaseDatabaseUrl());
      prisma = getPrismaClient();
      repos = {
        user: new PostgresUserRepository(),
        balance: new PostgresBalanceRepository(),
        generationJob: new PostgresGenerationJobRepository(),
        session: new PostgresSessionRepository(),
        sticker: new PostgresStickerRepository(),
        transaction: new PostgresTransactionRepository()
      };
    });

    afterAll(async () => {
      for (const userId of createdUserIds) {
        await prisma.authSession.deleteMany({ where: { userId } });
        await prisma.authIdentity.deleteMany({ where: { userId } });
        await prisma.generationJob.deleteMany({ where: { userId } });
        await prisma.sticker.deleteMany({ where: { userId } });
        await prisma.package.deleteMany({ where: { userId } });
        await prisma.ledgerEntry.deleteMany({ where: { userId } });
        await prisma.purchase.deleteMany({ where: { userId } });
        await prisma.balance.deleteMany({ where: { userId } });
        await prisma.user.deleteMany({ where: { id: userId } });
      }
      await disconnectPrisma();
    });

    async function createUser() {
      const user = await prisma.user.create({ data: { email: uniqueEmail(), name: 'Concurrency' } });
      createdUserIds.push(user.id);
      return user.id;
    }

    it('prevents concurrent balance updates from overwriting each other', async () => {
      const userId = await createUser();
      await repos.balance.save(new Balance({ userId, stickerDollars: 10 }));

      const b1 = await repos.balance.findByUserId(userId);
      const b2 = await repos.balance.findByUserId(userId);
      b1.stickerDollars = 7;
      b2.stickerDollars = 5;

      await repos.balance.update(b1);
      await expect(repos.balance.update(b2)).rejects.toThrow(/conflict/i);

      const final = await repos.balance.findByUserId(userId);
      expect(final.stickerDollars).toBe(7);
    });

    it('claims each pending job exactly once under concurrency', async () => {
      const userId = await createUser();
      const sticker1 = Sticker.createFromGeneration({ userId, name: 's1', replicateId: 'r1', prompt: 'p' });
      const sticker2 = Sticker.createFromGeneration({ userId, name: 's2', replicateId: 'r2', prompt: 'p' });
      await repos.sticker.save(sticker1);
      await repos.sticker.save(sticker2);

      const job1 = GenerationJob.create({ userId, type: 'image_sticker', stickerId: sticker1.id, input: {}, provider: 'r' });
      const job2 = GenerationJob.create({ userId, type: 'image_sticker', stickerId: sticker2.id, input: {}, provider: 'r' });
      await repos.generationJob.save(job1);
      await repos.generationJob.save(job2);

      const claims = await Promise.all([
        repos.generationJob.claimNextPendingJob(),
        repos.generationJob.claimNextPendingJob(),
        repos.generationJob.claimNextPendingJob(),
        repos.generationJob.claimNextPendingJob()
      ]);
      const claimed = claims.filter(Boolean);
      const ids = new Set(claimed.map(j => j.id));

      expect(claimed).toHaveLength(2);
      expect(ids.size).toBe(2);

      const remaining = await repos.generationJob.findPending();
      expect(remaining).toHaveLength(0);
    });

    it('prevents duplicate refresh token hashes', async () => {
      const userId = await createUser();
      const hash = uniqueStr('dup-hash');
      const s1 = new Session({ id: `sess_${randomUUID()}`, userId, refreshTokenHash: hash, family: uniqueStr('fam'), expiresAt: new Date(Date.now() + 86400000).toISOString() });
      const s2 = new Session({ id: `sess_${randomUUID()}`, userId, refreshTokenHash: hash, family: uniqueStr('fam'), expiresAt: new Date(Date.now() + 86400000).toISOString() });
      await repos.session.save(s1);
      await expect(repos.session.save(s2)).rejects.toMatchObject({ code: 'P2002' });
    });
  });
}
