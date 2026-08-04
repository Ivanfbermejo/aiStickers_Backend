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
  constructor(prismaClient) {
    super();
    this.prisma = prismaClient;
  }

  _getPrisma(tx) {
    return tx || this.prisma || getPrismaClient();
  }

  withPrisma(prismaClient) {
    return new PostgresBalanceRepository(prismaClient);
  }

  async findByUserId(userId, tx) {
    const raw = await this._getPrisma(tx).balance.findUnique({ where: { userId } });
    return toBalance(raw);
  }

  async save(balance, tx) {
    const prisma = this._getPrisma(tx);
    const existing = await prisma.balance.findUnique({ where: { userId: balance.userId } });

    if (existing) {
      if (existing.version !== balance.version) {
        throw new Error(`Balance conflict for user ${balance.userId}`);
      }
      const update = await prisma.balance.updateMany({
        where: { userId: balance.userId, version: balance.version },
        data: {
          stickerDollars: balance.stickerDollars,
          totalPurchased: balance.totalPurchased,
          totalSpent: balance.totalSpent,
          version: { increment: 1 },
          updatedAt: new Date(balance.updatedAt)
        }
      });
      if (update.count === 0) {
        throw new Error(`Balance conflict for user ${balance.userId}`);
      }
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

  async update(balance, tx) {
    return this.save(balance, tx);
  }

  async createForUser(userId, tx) {
    const balance = new Balance({ userId, stickerDollars: 0 });
    await this.save(balance, tx);
    return balance;
  }

  async exists(userId, tx) {
    const raw = await this._getPrisma(tx).balance.findUnique({ where: { userId } });
    return raw !== null;
  }
}
