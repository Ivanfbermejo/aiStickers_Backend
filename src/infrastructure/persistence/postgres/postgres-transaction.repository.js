import { Transaction } from '../../../domain/entities/transaction.entity.js';
import { ITransactionRepository } from '../../../domain/repositories/transaction.repository.js';
import { getPrismaClient } from '../prisma/client.js';

function toTransaction(raw) {
  if (!raw) return null;
  const storedMetadata = raw.metadata ?? {};
  return new Transaction({
    id: raw.id,
    userId: raw.userId,
    type: raw.type,
    amount: raw.amount,
    productId: storedMetadata.productId ?? null,
    provider: storedMetadata.provider ?? 'SYSTEM',
    providerTransactionId: raw.idempotencyKey ?? null,
    balanceAfter: raw.balanceAfter,
    metadata: storedMetadata,
    createdAt: raw.createdAt.toISOString()
  });
}

function toPrismaData(transaction) {
  return {
    id: transaction.id,
    userId: transaction.userId,
    type: transaction.type,
    amount: transaction.amount,
    balanceAfter: transaction.balanceAfter ?? 0,
    idempotencyKey: transaction.providerTransactionId || null,
    metadata: {
      ...transaction.metadata,
      provider: transaction.provider,
      productId: transaction.productId ?? null
    },
    createdAt: new Date(transaction.createdAt)
  };
}

export class PostgresTransactionRepository extends ITransactionRepository {
  async findById(id) {
    const raw = await getPrismaClient().ledgerEntry.findUnique({ where: { id } });
    return toTransaction(raw);
  }

  async findByUserId(userId, options = {}) {
    const { limit = 50, offset = 0 } = options;
    const rows = await getPrismaClient().ledgerEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });
    return rows.map(toTransaction);
  }

  async findByProviderTransactionId(providerTransactionId) {
    const raw = await getPrismaClient().ledgerEntry.findUnique({
      where: { idempotencyKey: providerTransactionId }
    });
    return toTransaction(raw);
  }

  async save(transaction) {
    const prisma = getPrismaClient();
    const data = toPrismaData(transaction);
    await prisma.ledgerEntry.upsert({
      where: { id: transaction.id },
      update: {
        type: data.type,
        amount: data.amount,
        balanceAfter: data.balanceAfter,
        idempotencyKey: data.idempotencyKey,
        metadata: data.metadata,
        createdAt: data.createdAt
      },
      create: data
    });
    return transaction;
  }

  async exists(providerTransactionId) {
    const raw = await getPrismaClient().ledgerEntry.findUnique({
      where: { idempotencyKey: providerTransactionId }
    });
    return raw !== null;
  }

  async getHistory(userId, limit = 50, offset = 0) {
    return this.findByUserId(userId, { limit, offset });
  }
}
