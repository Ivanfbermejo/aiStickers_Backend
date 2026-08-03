import { Balance } from '../../../domain/entities/balance.entity.js';
import { IBalanceRepository } from '../../../domain/repositories/balance.repository.js';
import { getPrismaClient } from '../prisma/client.js';

function toBalance(raw) {
  if (!raw) return null;
  return new Balance({
    userId: raw.userId,
    stickerDollars: raw.stickerDollars,
    totalPurchased: raw.totalPurchased,
    totalSpent: raw.totalSpent,
    version: raw.version,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString()
  });
}

export class PostgresBalanceRepository extends IBalanceRepository {
  async findByUserId(userId) {
    const raw = await getPrismaClient().balance.findUnique({ where: { userId } });
    return toBalance(raw);
  }

  async save(balance) {
    const prisma = getPrismaClient();
    const existing = await prisma.balance.findUnique({ where: { userId: balance.userId } });

    if (existing) {
      if (existing.version !== balance.version) {
        throw new Error(`Balance conflict for user ${balance.userId}`);
      }
      await prisma.balance.update({
        where: { userId: balance.userId },
        data: {
          stickerDollars: balance.stickerDollars,
          totalPurchased: balance.totalPurchased,
          totalSpent: balance.totalSpent,
          version: { increment: 1 },
          updatedAt: new Date(balance.updatedAt)
        }
      });
      balance.version += 1;
    } else {
      await prisma.balance.create({
        data: {
          userId: balance.userId,
          stickerDollars: balance.stickerDollars,
          totalPurchased: balance.totalPurchased,
          totalSpent: balance.totalSpent,
          version: balance.version || 0,
          createdAt: new Date(balance.createdAt),
          updatedAt: new Date(balance.updatedAt)
        }
      });
    }

    return balance;
  }

  async update(balance) {
    return this.save(balance);
  }

  async createForUser(userId) {
    const balance = new Balance({ userId, stickerDollars: 0 });
    await this.save(balance);
    return balance;
  }

  async exists(userId) {
    const raw = await getPrismaClient().balance.findUnique({ where: { userId } });
    return raw !== null;
  }
}
