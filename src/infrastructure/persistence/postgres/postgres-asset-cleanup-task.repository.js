import { createHash } from 'node:crypto';
import { getPrismaClient } from '../prisma/client.js';

function taskId(ownerId, key) {
  const digest = createHash('sha256').update(`${ownerId}:${key}`).digest('hex');
  return `cleanup:${digest}`;
}

function toTask(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    key: raw.key,
    ownerId: raw.ownerId,
    entity: raw.entity,
    status: raw.status.toLowerCase(),
    confirmed: Boolean(raw.confirmedAt),
    attempts: raw.attempts,
    confirmedAt: raw.confirmedAt?.toISOString() || null,
    queuedAt: raw.queuedAt?.toISOString() || null,
    lockedAt: raw.lockedAt?.toISOString() || null,
    lastAttemptAt: raw.lastAttemptAt?.toISOString() || null,
    completedAt: raw.completedAt?.toISOString() || null,
    lastError: raw.lastError || null,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString()
  };
}

export class PostgresAssetCleanupTaskRepository {
  constructor(prismaClient) {
    this.prisma = prismaClient;
  }

  _getPrisma(tx) {
    return tx || this.prisma || getPrismaClient();
  }

  withPrisma(prismaClient) {
    return new PostgresAssetCleanupTaskRepository(prismaClient);
  }

  async schedule({ key, ownerId, entity }, tx) {
    const prisma = this._getPrisma(tx);
    const id = taskId(ownerId, key);
    const raw = await prisma.assetCleanupTask.upsert({
      where: { id },
      update: {},
      create: { id, key, ownerId, entity, status: 'PENDING' }
    });
    return toTask(raw);
  }

  async findById(id, tx) {
    const raw = await this._getPrisma(tx).assetCleanupTask.findUnique({ where: { id } });
    return toTask(raw);
  }

  async confirm(task, tx) {
    const prisma = this._getPrisma(tx);
    await prisma.assetCleanupTask.updateMany({
      where: { id: task.id, status: { in: ['PENDING', 'CONFIRMED'] } },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), lastError: null }
    });
    return this.findById(task.id, tx);
  }

  async cancel(task, tx) {
    await this._getPrisma(tx).assetCleanupTask.updateMany({
      where: { id: task.id, status: { in: ['PENDING', 'CONFIRMED', 'QUEUED'] } },
      data: { status: 'CANCELLED', lockedAt: null, lastError: null }
    });
    return this.findById(task.id, tx);
  }

  async findConfirmedPending(limit = 100, tx) {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const rows = await this._getPrisma(tx).assetCleanupTask.findMany({
      where: {
        status: { in: ['CONFIRMED', 'QUEUED', 'FAILED'] },
        confirmedAt: { not: null },
        OR: [{ lockedAt: null }, { lockedAt: { lt: cutoff } }]
      },
      orderBy: { createdAt: 'asc' },
      take: limit
    });
    return rows.map(toTask);
  }

  async markQueued(task, tx) {
    const prisma = this._getPrisma(tx);
    await prisma.assetCleanupTask.updateMany({
      where: { id: task.id, status: { in: ['CONFIRMED', 'FAILED'] } },
      data: { status: 'QUEUED', queuedAt: new Date(), lastError: null }
    });
    return this.findById(task.id, tx);
  }

  /** Atomically claims a cleanup task so two workers cannot delete it twice. */
  async claim(id, lockTimeoutMs = 5 * 60 * 1000, tx) {
    const prisma = this._getPrisma(tx);
    const cutoff = new Date(Date.now() - lockTimeoutMs);
    const [raw] = await prisma.$queryRaw`
      UPDATE "asset_cleanup_tasks"
      SET status = 'PROCESSING',
          "attempts" = "attempts" + 1,
          "lockedAt" = NOW(),
          "lastAttemptAt" = NOW(),
          "updatedAt" = NOW()
      WHERE id = ${id}
        AND status IN ('CONFIRMED', 'QUEUED', 'FAILED', 'PROCESSING')
        AND "confirmedAt" IS NOT NULL
        AND ("lockedAt" IS NULL OR "lockedAt" < ${cutoff})
      RETURNING *
    `;
    return toTask(raw);
  }

  async complete(task, tx) {
    await this._getPrisma(tx).assetCleanupTask.updateMany({
      where: { id: task.id, status: 'PROCESSING' },
      data: { status: 'COMPLETED', lockedAt: null, completedAt: new Date(), lastError: null }
    });
    return this.findById(task.id, tx);
  }

  async fail(task, error, tx) {
    await this._getPrisma(tx).assetCleanupTask.updateMany({
      where: { id: task.id, status: 'PROCESSING' },
      data: { status: 'FAILED', lockedAt: null, lastError: error?.message || 'cleanup failed' }
    });
    return this.findById(task.id, tx);
  }
}
