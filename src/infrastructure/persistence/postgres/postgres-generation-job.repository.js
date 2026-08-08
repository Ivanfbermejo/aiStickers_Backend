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
    providerPredictionId: raw.providerPredictionId ?? null,
    cost: raw.cost,
    attempts: raw.attempts ?? 0,
    lockedAt: raw.lockedAt?.toISOString() ?? null,
    completedAt: raw.completedAt?.toISOString() ?? null,
    refundedAt: raw.refundedAt?.toISOString() ?? null,
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
    providerPredictionId: job.providerPredictionId ?? null,
    cost: job.cost,
    attempts: job.attempts ?? 0,
    lockedAt: job.lockedAt ? new Date(job.lockedAt) : null,
    completedAt: job.completedAt ? new Date(job.completedAt) : null,
    refundedAt: job.refundedAt ? new Date(job.refundedAt) : null,
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

  async findRecoverable(limit = 100, tx) {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const rows = await this._getPrisma(tx).generationJob.findMany({
      where: {
        OR: [
          { status: 'QUEUED' },
          { status: 'PROCESSING', lockedAt: { lt: cutoff } }
        ]
      },
      orderBy: { createdAt: 'asc' },
      take: limit
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

  /** Atomically claim one BullMQ job in PostgreSQL. */
  async claimJob(id, lockTimeoutMs = 5 * 60 * 1000) {
    const prisma = this._getPrisma();
    const cutoff = new Date(Date.now() - lockTimeoutMs);
    const [raw] = await prisma.$queryRaw`
      UPDATE "generation_jobs"
      SET status = 'PROCESSING',
          "currentStep" = CASE
            WHEN "providerPredictionId" IS NULL AND "currentStep" IN (
              'submitting_provider', 'creating_image_prediction', 'creating_video_prediction'
            )
              THEN "currentStep"
            ELSE 'processing'
          END,
          "lockedAt" = NOW(),
          "attempts" = "attempts" + 1, "updatedAt" = NOW()
      WHERE id = ${id}
        AND status IN ('QUEUED', 'PROCESSING')
        AND ("lockedAt" IS NULL OR "lockedAt" < ${cutoff})
      RETURNING *
    `;
    return raw ? toJob(raw) : null;
  }

  /**
   * Cost-protection CAS. SUBMITTING is durable before the external POST; only
   * the worker that wins this update may issue that POST.
   */
  async claimProviderSubmission(id, tx) {
    const prisma = this._getPrisma(tx);
    const [raw] = await prisma.$queryRaw`
      UPDATE "generation_jobs"
      SET "currentStep" = 'submitting_provider',
          "progress" = GREATEST("progress", 30),
          "lockedAt" = NOW(),
          "updatedAt" = NOW()
      WHERE id = ${id}
        AND status = 'PROCESSING'
        AND "providerPredictionId" IS NULL
        AND "currentStep" IN ('processing', 'generating_image', 'replayed', 'retrying', 'queued')
      RETURNING *
    `;
    return raw ? toJob(raw) : null;
  }

  /** Persist the provider ID with a second CAS before polling starts. */
  async setProviderPredictionId(id, providerPredictionId, tx) {
    const prisma = this._getPrisma(tx);
    const updated = await prisma.generationJob.updateMany({
      where: {
        id,
        status: 'PROCESSING',
        currentStep: 'submitting_provider',
        providerPredictionId: null
      },
      data: { providerPredictionId, currentStep: 'polling_provider', progress: 50 }
    });
    if (updated.count === 0) {
      const current = await prisma.generationJob.findUnique({ where: { id } });
      if (current?.providerPredictionId === providerPredictionId) return toJob(current);
      throw new Error(`Generation job ${id} provider prediction CAS failed`);
    }
    return this.findById(id, tx);
  }

  /** Compatibility helper for repository contract tests and operators. */
  async claimNextPendingJob() {
    const prisma = this._getPrisma();
    const [candidate] = await prisma.$queryRaw`
      SELECT id FROM "generation_jobs"
      WHERE status = 'QUEUED' AND "lockedAt" IS NULL
      ORDER BY "createdAt" ASC
      LIMIT 1
    `;
    return candidate ? this.claimJob(candidate.id) : null;
  }
}
