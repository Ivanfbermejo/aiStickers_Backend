import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { hasTestDatabase, getBaseDatabaseUrl, migrateDeploy } from '../../helpers/postgres.js';

import { PostgresUserRepository } from '../../../src/infrastructure/persistence/postgres/postgres-user.repository.js';
import { PostgresBalanceRepository } from '../../../src/infrastructure/persistence/postgres/postgres-balance.repository.js';
import { PostgresTransactionRepository } from '../../../src/infrastructure/persistence/postgres/postgres-transaction.repository.js';
import { PostgresPurchaseRepository } from '../../../src/infrastructure/persistence/postgres/postgres-purchase.repository.js';

import { PlanService } from '../../../src/application/services/plan.service.js';
import { CostService } from '../../../src/application/services/cost.service.js';
import { FraudDetectionService } from '../../../src/infrastructure/security/fraud-detection.service.js';
import { PaymentProviderService } from '../../../src/infrastructure/payment/payment-provider.service.js';
import { GooglePlayPaymentService } from '../../../src/infrastructure/payment/google-play.service.js';

import { ValidatePurchaseUseCase } from '../../../src/application/use-cases/purchase/validate-purchase.use-case.js';
import { SpendBalanceUseCase } from '../../../src/application/use-cases/balance/spend-balance.use-case.js';
import { RefundBalanceUseCase } from '../../../src/application/use-cases/balance/refund-balance.use-case.js';
import { PostgresUnitOfWork } from '../../../src/infrastructure/persistence/unit-of-work.js';

describe.skipIf(!hasTestDatabase())('Ledger and payment atomicity (real PostgreSQL)', () => {
  let prisma;
  const createdUserIds = [];

  beforeAll(async () => {
    await migrateDeploy(getBaseDatabaseUrl());
    prisma = new PrismaClient({ datasources: { db: { url: getBaseDatabaseUrl() } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await prisma.ledgerEntry.deleteMany({ where: { userId } });
      await prisma.purchase.deleteMany({ where: { userId } });
      await prisma.balance.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  async function createUser() {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@ledger.test`, name: 'Ledger Test' }
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  function makeRepositories(customBalanceRepo = null, prismaClient = prisma) {
    const repositories = {
      user: new PostgresUserRepository(prismaClient),
      balance: customBalanceRepo || new PostgresBalanceRepository(prismaClient),
      transaction: new PostgresTransactionRepository(prismaClient),
      purchase: new PostgresPurchaseRepository(prismaClient)
    };
    repositories.unitOfWork = new PostgresUnitOfWork(repositories);
    return repositories;
  }

  function makeValidateUseCase(repositories, googlePlayResult) {
    const fakeGoogle = new GooglePlayPaymentService({
      androidPublisher: {
        purchases: {
          products: {
            get: async () => ({ data: googlePlayResult })
          }
        }
      }
    });
    return new ValidatePurchaseUseCase({
      purchaseRepository: repositories.purchase,
      transactionRepository: repositories.transaction,
      balanceRepository: repositories.balance,
      paymentProviderService: new PaymentProviderService({ googlePlayService: fakeGoogle }),
      fraudDetectionService: new FraudDetectionService(),
      planService: new PlanService(),
      unitOfWork: repositories.unitOfWork
    });
  }

  function makeSpendUseCase(repositories) {
    return new SpendBalanceUseCase({
      balanceRepository: repositories.balance,
      transactionRepository: repositories.transaction,
      costService: new CostService(),
      unitOfWork: repositories.unitOfWork
    });
  }

  function makeRefundUseCase(repositories) {
    return new RefundBalanceUseCase({
      balanceRepository: repositories.balance,
      transactionRepository: repositories.transaction,
      unitOfWork: repositories.unitOfWork
    });
  }

  it('two concurrent validations credit the balance exactly once', async () => {
    const userId = await createUser();
    const token = `gp_${randomUUID()}`;
    const repositories = makeRepositories();
    const useCase = makeValidateUseCase(repositories, {
      purchaseState: 0,
      orderId: `GPA.${randomUUID()}`,
      consumptionState: 0,
      acknowledgementState: 1
    });

    const [first, second] = await Promise.allSettled([
      useCase.execute({
        userId,
        productId: 'com.animatedsticker.aistickers.coins_10',
        purchaseToken: token,
        provider: 'GOOGLE_PLAY'
      }),
      useCase.execute({
        userId,
        productId: 'com.animatedsticker.aistickers.coins_10',
        purchaseToken: token,
        provider: 'GOOGLE_PLAY'
      })
    ]);

    const values = [first, second]
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);

    // Exactly one successful credit; the other must resolve as a duplicate.
    const credited = values.filter((v) => v.success && !v.isDuplicate);
    const duplicates = values.filter((v) => v.success && v.isDuplicate);
    expect(credited).toHaveLength(1);
    expect(duplicates.length + credited.length).toBe(2);

    const balance = await repositories.balance.findByUserId(userId);
    expect(balance.stickerDollars).toBe(10);

    const ledgerCount = await prisma.ledgerEntry.count({
      where: { userId, type: 'PURCHASE' }
    });
    expect(ledgerCount).toBe(1);

    const purchaseCount = await prisma.purchase.count({
      where: { userId, status: 'CREDITED' }
    });
    expect(purchaseCount).toBe(1);
  });

  it('rolls back the ledger entry when the balance update fails', async () => {
    const userId = await createUser();

    class FailingBalanceRepository extends PostgresBalanceRepository {
      withPrisma(prismaClient) {
        const repo = new FailingBalanceRepository();
        repo.prisma = prismaClient;
        return repo;
      }

      async save(balance, tx) {
        if (balance.stickerDollars > 0) {
          throw new Error('Simulated balance failure after ledger write');
        }
        return super.save(balance, tx);
      }
    }

    const repositories = makeRepositories(new FailingBalanceRepository(prisma));
    const useCase = makeValidateUseCase(repositories, {
      purchaseState: 0,
      orderId: `GPA.${randomUUID()}`,
      consumptionState: 0,
      acknowledgementState: 1
    });

    await expect(
      useCase.execute({
        userId,
        productId: 'com.animatedsticker.aistickers.coins_10',
        purchaseToken: `gp_${randomUUID()}`,
        provider: 'GOOGLE_PLAY'
      })
    ).rejects.toThrow();

    const ledgerCount = await prisma.ledgerEntry.count({ where: { userId } });
    expect(ledgerCount).toBe(0);

    const balance = await prisma.balance.findUnique({ where: { userId } });
    expect(balance).toBeNull();

    const purchaseCount = await prisma.purchase.count({ where: { userId } });
    expect(purchaseCount).toBe(0);
  });

  it('two concurrent spends do not produce a negative balance', async () => {
    const userId = await createUser();
    await prisma.balance.create({ data: { userId, stickerDollars: 1 } });

    const repositories = makeRepositories();
    const useCase = makeSpendUseCase(repositories);

    const [first, second] = await Promise.allSettled([
      useCase.execute({ userId, productId: 'generation:image_sticker' }),
      useCase.execute({ userId, productId: 'generation:image_sticker' })
    ]);

    const successCount = [first, second].filter((r) => r.status === 'fulfilled').length;
    const failureCount = [first, second].filter((r) => r.status === 'rejected').length;

    expect(successCount + failureCount).toBe(2);
    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);

    const balance = await prisma.balance.findUnique({ where: { userId } });
    expect(balance.stickerDollars).toBe(0);

    const ledgerCount = await prisma.ledgerEntry.count({ where: { userId, type: 'SPEND' } });
    expect(ledgerCount).toBe(1);
  });

  it('duplicate refunds credit the balance exactly once', async () => {
    const userId = await createUser();
    await prisma.balance.create({ data: { userId, stickerDollars: 0 } });

    const repositories = makeRepositories();
    const useCase = makeRefundUseCase(repositories);

    const [first, second] = await Promise.allSettled([
      useCase.execute({ userId, amount: 1, productId: 'generation:image_sticker', reason: 'job-failed' }),
      useCase.execute({ userId, amount: 1, productId: 'generation:image_sticker', reason: 'job-failed' })
    ]);

    const successCount = [first, second].filter((r) => r.status === 'fulfilled').length;
    expect(successCount).toBeGreaterThanOrEqual(1);

    const balance = await prisma.balance.findUnique({ where: { userId } });
    expect(balance.stickerDollars).toBe(1);

    const ledgerCount = await prisma.ledgerEntry.count({ where: { userId, type: 'REFUND' } });
    expect(ledgerCount).toBe(1);
  });

  it("user A's purchase cannot be credited to user B", async () => {
    const userA = await createUser();
    const userB = await createUser();

    const repositories = makeRepositories();
    const useCase = makeValidateUseCase(repositories, {
      purchaseState: 0,
      orderId: `GPA.${randomUUID()}`,
      consumptionState: 0,
      acknowledgementState: 1
    });

    const tokenA = `gp_${randomUUID()}`;
    await useCase.execute({
      userId: userA,
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: tokenA,
      provider: 'GOOGLE_PLAY'
    });

    const replay = await useCase.execute({
      userId: userB,
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: tokenA,
      provider: 'GOOGLE_PLAY'
    });

    // The replay must not credit user B. It may be reported as a duplicate or
    // rejected, but user B's balance must stay empty.
    const balanceA = await repositories.balance.findByUserId(userA);
    const balanceB = await repositories.balance.findByUserId(userB);

    expect(balanceA.stickerDollars).toBe(10);
    expect(balanceB).toBeNull();

    const ledgerA = await prisma.ledgerEntry.count({ where: { userId: userA, type: 'PURCHASE' } });
    const ledgerB = await prisma.ledgerEntry.count({ where: { userId: userB, type: 'PURCHASE' } });
    expect(ledgerA).toBe(1);
    expect(ledgerB).toBe(0);

    if (replay.success) {
      expect(replay.isDuplicate).toBe(true);
    }
  });

  it('keeps a pending purchase pending on retry', async () => {
    const userId = await createUser();
    const token = `gp_${randomUUID()}`;

    const repositories = makeRepositories();
    const useCase = makeValidateUseCase(repositories, {
      purchaseState: 2,
      orderId: `GPA.${randomUUID()}`
    });

    const first = await useCase.execute({
      userId,
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: token,
      provider: 'GOOGLE_PLAY'
    });

    expect(first.success).toBe(false);
    expect(first.pending).toBe(true);

    const second = await useCase.execute({
      userId,
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: token,
      provider: 'GOOGLE_PLAY'
    });

    expect(second.success).toBe(false);
    expect(second.pending).toBe(true);
    expect(second.isDuplicate).toBe(true);

    const balance = await repositories.balance.findByUserId(userId);
    expect(balance).toBeNull();

    const purchase = await repositories.purchase.findByToken(token);
    expect(purchase.status).toBe('PENDING');
  });
});
