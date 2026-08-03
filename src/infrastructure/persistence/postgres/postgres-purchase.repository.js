import { createHash } from 'node:crypto';
import { Purchase } from '../../../domain/entities/purchase.entity.js';
import { IPurchaseRepository } from '../../../domain/repositories/purchase.repository.js';
import { getPrismaClient } from '../prisma/client.js';

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function toPurchase(raw) {
  if (!raw) return null;
  return new Purchase({
    id: raw.id,
    userId: raw.userId,
    productId: raw.productId,
    purchaseToken: null, // never persisted in clear text
    provider: raw.provider,
    status: raw.status,
    stickerAmount: raw.stickerAmount,
    transactionId: raw.transactionId ?? null,
    fraudFlags: raw.fraudFlags ?? [],
    riskScore: raw.riskScore ?? 0,
    createdAt: raw.createdAt.toISOString(),
    verifiedAt: raw.verifiedAt?.toISOString() ?? null
  });
}

export class PostgresPurchaseRepository extends IPurchaseRepository {
  async findById(id) {
    const raw = await getPrismaClient().purchase.findUnique({ where: { id } });
    return toPurchase(raw);
  }

  async findByToken(purchaseToken) {
    const hash = hashToken(purchaseToken);
    const raw = await getPrismaClient().purchase.findFirst({
      where: { purchaseTokenHash: hash }
    });
    return toPurchase(raw);
  }

  async findByUserId(userId, status) {
    const where = { userId };
    if (status) where.status = status;
    const rows = await getPrismaClient().purchase.findMany({ where });
    return rows.map(toPurchase);
  }

  async save(purchase) {
    const prisma = getPrismaClient();
    const hash = hashToken(purchase.purchaseToken);
    const data = {
      id: purchase.id,
      userId: purchase.userId,
      provider: purchase.provider,
      productId: purchase.productId,
      purchaseTokenHash: hash,
      status: purchase.status,
      stickerAmount: purchase.stickerAmount,
      createdAt: new Date(purchase.createdAt),
      verifiedAt: purchase.verifiedAt ? new Date(purchase.verifiedAt) : null
    };
    await prisma.purchase.upsert({
      where: { id: purchase.id },
      update: {
        userId: data.userId,
        provider: data.provider,
        productId: data.productId,
        purchaseTokenHash: data.purchaseTokenHash,
        status: data.status,
        stickerAmount: data.stickerAmount,
        createdAt: data.createdAt,
        verifiedAt: data.verifiedAt
      },
      create: data
    });
    return purchase;
  }

  async update(purchase) {
    return this.save(purchase);
  }

  async exists(purchaseToken) {
    const hash = hashToken(purchaseToken);
    const count = await getPrismaClient().purchase.count({
      where: { purchaseTokenHash: hash }
    });
    return count > 0;
  }
}
