import { Sticker } from '../../../domain/entities/sticker.entity.js';
import { GenerationJob } from '../../../domain/entities/generation-job.entity.js';

export class ActiveGenerationLimitError extends Error {
  constructor(retryAfterSeconds = 60) {
    super('Active generation limit exceeded');
    this.name = 'ActiveGenerationLimitError';
    this.code = 'ACTIVE_GENERATION_LIMIT';
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

/**
 * Create GenerationJob Use Case
 * Validates balance, creates a sticker and an async generation job, and returns immediately
 */
export class CreateGenerationJobUseCase {
  constructor({
    generationJobRepository,
    stickerRepository,
    packageRepository,
    spendBalanceUseCase,
    generationQueue,
    unitOfWork,
    activeGenerationLimit = 2,
    activeGenerationRetryAfterSeconds = 60
  }) {
    this.generationJobRepository = generationJobRepository;
    this.stickerRepository = stickerRepository;
    this.packageRepository = packageRepository;
    this.spendBalanceUseCase = spendBalanceUseCase;
    this.generationQueue = generationQueue;
    this.unitOfWork = unitOfWork;
    this.activeGenerationLimit = activeGenerationLimit;
    this.activeGenerationRetryAfterSeconds = activeGenerationRetryAfterSeconds;
  }

  /**
   * Execute generation job creation
   * @param {Object} input
   * @param {string} input.userId - User identifier
   * @param {string} input.type - Generation type: image_sticker | animated_sticker | img2vid
   * @param {Object} input.asset - Verified private input asset metadata
   * @param {string} input.prompt - Optional generation prompt
   * @param {string} input.styleId - Optional style identifier
   * @param {string} input.emoji - Optional emoji metadata
   * @param {string} input.packageId - Optional package id
   * @param {string} input.provider - Optional provider override
   * @returns {Object} Created job and sticker identifiers
   */
  async execute({
    userId,
    type,
    asset,
    prompt,
    styleId,
    emoji,
    packageId,
    provider = 'replicate'
  }) {
    const validTypes = ['image_sticker', 'animated_sticker', 'img2vid'];
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid generation type: ${type}`);
    }
    // Video needs a dedicated binary validator and media model. Until T12,
    // reject it before charging or creating records.
    if (type === 'animated_sticker' || type === 'img2vid') {
      throw new Error('Video generation is disabled until T12');
    }

    if (!asset?.key) {
      throw new Error('asset with objectKey metadata is required');
    }

    if (packageId) {
      const pkg = this.packageRepository
        ? await this.packageRepository.findById(packageId, userId)
        : null;
      if (!pkg) {
        const error = new Error('Package does not exist or does not belong to user');
        error.code = 'PACKAGE_NOT_FOUND';
        throw error;
      }
    }

    const cost = 1;

    const createRecords = async (repos) => {
      if (typeof repos.generationJob.lockAndCountActiveByUserId === 'function') {
        const activeCount = await repos.generationJob.lockAndCountActiveByUserId(userId);
        if (activeCount >= this.activeGenerationLimit) {
          throw new ActiveGenerationLimitError(this.activeGenerationRetryAfterSeconds);
        }
      }

      const spendResult = await this.spendBalanceUseCase.executeInTransaction({
        repos,
        userId,
        amount: cost,
        productId: `generation:${type}`
      });

      const sticker = Sticker.createFromGeneration({
        userId,
        packageId: packageId || null,
        name: prompt?.substring(0, 30) || 'Generated Sticker',
        prompt,
        cost
      });
      await repos.sticker.save(sticker);

      const job = GenerationJob.create({
        userId,
        type,
        packageId: packageId || null,
        stickerId: sticker.id,
        input: {
          objectKey: asset.key,
          hash: asset.hash,
          sizeBytes: asset.sizeBytes,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          prompt,
          styleId,
          emoji
        },
        provider,
        cost
      });
      await repos.generationJob.save(job);
      return { spendResult, sticker, job };
    };

    let records;
    if (this.unitOfWork && typeof this.spendBalanceUseCase.executeInTransaction === 'function') {
      // Debit, sticker and GenerationJob share one PostgreSQL transaction.
      records = await this.unitOfWork.run(createRecords);
    } else {
      // Compatibility for development-only test doubles that predate the UoW.
      const spendResult = await this.spendBalanceUseCase.execute({
        userId,
        amount: cost,
        productId: `generation:${type}`
      });
      const sticker = Sticker.createFromGeneration({
        userId,
        packageId: packageId || null,
        name: prompt?.substring(0, 30) || 'Generated Sticker',
        prompt,
        cost
      });
      await this.stickerRepository.save(sticker);
      const job = GenerationJob.create({
        userId,
        type,
        packageId: packageId || null,
        stickerId: sticker.id,
        input: { objectKey: asset.key, hash: asset.hash, sizeBytes: asset.sizeBytes, mimeType: asset.mimeType, width: asset.width, height: asset.height, prompt, styleId, emoji },
        provider,
        cost
      });
      await this.generationJobRepository.save(job);
      records = { spendResult, sticker, job };
    }

    const { spendResult, sticker, job } = records;

    // The database row is the source of truth. If Redis is unavailable after
    // this commit, the worker reconciler will enqueue this same PostgreSQL ID.
    let queue = { enqueued: false, pendingReconciliation: true };
    if (this.generationQueue) {
      try {
        queue = await this.generationQueue.enqueueGeneration({ jobId: job.id, type: job.type, provider: job.provider });
      } catch (enqueueError) {
        const { getLogger } = await import('../../../infrastructure/observability/logger.js');
        getLogger().error({ err: enqueueError }, `[GenerationQueue] enqueue failed for ${job.id}; reconciler will retry:`);
      }
    }

    return {
      success: true,
      jobId: job.id,
      stickerId: sticker.id,
      status: job.status,
      remainingBalance: spendResult.newBalance,
      queue
    };
  }
}
