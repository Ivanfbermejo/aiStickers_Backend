import { GenerationJob } from '../../../domain/entities/generation-job.entity.js';
import { IGenerationJobRepository } from '../../../domain/repositories/generation-job.repository.js';
import { getPrismaClient } from '../prisma/client.js';

function toJobType(type) {
  return type ? type.toUpperCase().replace(/-/g, '_') : 'IMAGE_STICKER';
}

function fromJobType(type) {
  return type.toLowerCase();
}

function toJobStatus(status) {
  return status ? status.toUpperCase() : 'QUEUED';
}

function fromJobStatus(status) {
  return status.toLowerCase();
}

function toJob(raw) {
  if (!raw) return null;
  return new GenerationJob({
    id: raw.id,
    userId: raw.userId,
    type: fromJobType(raw.type),
    status: fromJobStatus(raw.status),
    currentStep: raw.currentStep,
    progress: raw.progress,
    packageId: raw.packageId ?? null,
    stickerId: raw.stickerId,
    input: raw.input ?? {},
    result: raw.result ?? undefined,
    provider: raw.provider ?? null,
    cost: raw.cost,
    errorMessage: raw.errorMessage ?? undefined,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString()
  });
}

function toJobData(job) {
  return {
    id: job.id,
    userId: job.userId,
    type: toJobType(job.type),
    status: toJobStatus(job.status),
    currentStep: job.currentStep || 'queued',
    progress: job.progress ?? 0,
    packageId: job.packageId || null,
    stickerId: job.stickerId,
    input: job.input || {},
    result: job.result ?? null,
    provider: job.provider ?? null,
    cost: job.cost,
    errorMessage: job.errorMessage ?? null,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(job.updatedAt)
  };
}

export class PostgresGenerationJobRepository extends IGenerationJobRepository {
  constructor(prismaClient) {
    super();
    this.prisma = prismaClient;
  }

  _getPrisma(tx) {
    return tx || this.prisma || getPrismaClient();
  }

  withPrisma(prismaClient) {
    return new PostgresGenerationJobRepository(prismaClient);
  }

  async save(job, tx) {
    const prisma = this._getPrisma(tx);
    const data = toJobData(job);
    await prisma.generationJob.upsert({
      where: { id: job.id },
      update: { ...data, id: undefined },
      create: data
    });
    return job;
  }

  async update(job, tx) {
    return this.save(job, tx);
  }

  async findById(id, tx) {
    const raw = await this._getPrisma(tx).generationJob.findUnique({ where: { id } });
    return toJob(raw);
  }

  async findByUserId(userId, tx) {
    const rows = await this._getPrisma(tx).generationJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(toJob);
  }

  async findPending(tx) {
    const rows = await this._getPrisma(tx).generationJob.findMany({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' }
    });
    return rows.map(toJob);
  }

  async findByStickerId(stickerId, tx) {
    const raw = await this._getPrisma(tx).generationJob.findFirst({ where: { stickerId } });
    return toJob(raw);
  }

  async delete(id, tx) {
    await this._getPrisma(tx).generationJob.delete({ where: { id } });
    return true;
  }

  async deleteByUserId(userId, tx) {
    const result = await this._getPrisma(tx).generationJob.deleteMany({ where: { userId } });
    return result.count;
  }

  /**
   * Atomically claim the oldest available queued job.
   * Returns the claimed GenerationJob, or null if none are available.
   */
  async claimNextPendingJob() {
    const prisma = this._getPrisma();
    const [raw] = await prisma.$queryRaw`
      UPDATE "generation_jobs"
      SET status = 'PROCESSING', "currentStep" = 'processing', "lockedAt" = NOW(), "updatedAt" = NOW()
      WHERE id = (
        SELECT id FROM "generation_jobs"
        WHERE status = 'QUEUED' AND "lockedAt" IS NULL
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `;
    return raw ? toJob(raw) : null;
  }
}
