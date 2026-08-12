import { createHash } from 'node:crypto';
import { Purchase } from '../../../domain/entities/purchase.entity.js';
import { IPurchaseRepository } from '../../../domain/repositories/purchase.repository.js';
import { getPrismaClient } from '../prisma/client.js';

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function metadataFromRaw(raw) {
  const stored = raw.metadata ?? {};
  return {
    transactionId: stored.transactionId ?? null,
    fraudFlags: stored.fraudFlags ?? [],
    riskScore: stored.riskScore ?? 0,
    providerResponse: stored.providerResponse ?? null
  };
}

function toPurchase(raw) {
  if (!raw) return null;
  const metadata = metadataFromRaw(raw);
  return new Purchase({
    id: raw.id,
    userId: raw.userId,
    productId: raw.productId,
    purchaseToken: null, // never persisted in clear text
    provider: raw.provider,
    status: raw.status,
    stickerAmount: raw.stickerAmount,
    orderId: raw.orderId ?? null,
    transactionId: metadata.transactionId,
    fraudFlags: metadata.fraudFlags,
    riskScore: metadata.riskScore,
    providerResponse: metadata.providerResponse,
    createdAt: raw.createdAt.toISOString(),
    verifiedAt: raw.verifiedAt?.toISOString() ?? null,
    reconciledAt: raw.reconciledAt?.toISOString() ?? null,
    reconcileAttempts: raw.reconcileAttempts ?? 0
  });
}

export class PostgresPurchaseRepository extends IPurchaseRepository {
  constructor(prismaClient) {
    super();
    this.prisma = prismaClient;
  }

  _getPrisma(tx) {
    return tx || this.prisma || getPrismaClient();
  }

  withPrisma(prismaClient) {
    return new PostgresPurchaseRepository(prismaClient);
  }

  async findById(id, tx) {
    const raw = await this._getPrisma(tx).purchase.findUnique({ where: { id } });
    return toPurchase(raw);
  }

  async findByToken(purchaseToken, tx) {
    const hash = hashToken(purchaseToken);
    const raw = await this._getPrisma(tx).purchase.findFirst({
      where: { purchaseTokenHash: hash }
    });
    return toPurchase(raw);
  }

  async findByUserId(userId, status, tx) {
    const where = { userId };
    if (status) where.status = status;
    const rows = await this._getPrisma(tx).purchase.findMany({ where });
    return rows.map(toPurchase);
  }

  async findPendingForReconcile(limit, tx) {
    const rows = await this._getPrisma(tx).purchase.findMany({
      where: {
        status: { in: ['RECEIVED', 'PENDING'] },
        OR: [
          { reconciledAt: null },
          { reconciledAt: { lte: new Date(Date.now() - 60 * 1000) } }
        ]
      },
      orderBy: { createdAt: 'asc' },
      take: limit
    });
    return rows.map(toPurchase);
  }

  async save(purchase, tx) {
    const prisma = this._getPrisma(tx);
    const hash = hashToken(purchase.purchaseToken);
    const metadata = {
      transactionId: purchase.transactionId ?? null,
      fraudFlags: purchase.fraudFlags ?? [],
      riskScore: purchase.riskScore ?? 0,
      providerResponse: purchase.providerResponse ?? null
    };
    const data = {
      id: purchase.id,
      userId: purchase.userId,
      provider: purchase.provider,
      productId: purchase.productId,
      purchaseTokenHash: hash,
      orderId: purchase.orderId ?? null,
      status: purchase.status,
      stickerAmount: purchase.stickerAmount,
      metadata,
      createdAt: new Date(purchase.createdAt),
      verifiedAt: purchase.verifiedAt ? new Date(purchase.verifiedAt) : null,
      reconciledAt: purchase.reconciledAt ? new Date(purchase.reconciledAt) : null,
      reconcileAttempts: purchase.reconcileAttempts ?? 0
    };
    await prisma.purchase.upsert({
      where: { id: purchase.id },
      update: {
        userId: data.userId,
        provider: data.provider,
        productId: data.productId,
        purchaseTokenHash: data.purchaseTokenHash,
        orderId: data.orderId,
        status: data.status,
        stickerAmount: data.stickerAmount,
        metadata: data.metadata,
        createdAt: data.createdAt,
        verifiedAt: data.verifiedAt,
        reconciledAt: data.reconciledAt,
        reconcileAttempts: data.reconcileAttempts
      },
      create: data
    });
    return purchase;
  }

  async update(purchase, tx) {
    return this.save(purchase, tx);
  }

  async exists(purchaseToken, tx) {
    const hash = hashToken(purchaseToken);
    const count = await this._getPrisma(tx).purchase.count({
      where: { purchaseTokenHash: hash }
    });
    return count > 0;
  }
}
