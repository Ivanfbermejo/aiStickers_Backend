import { Sticker } from '../../../domain/entities/sticker.entity.js';
import { GenerationJob } from '../../../domain/entities/generation-job.entity.js';

/**
 * Create GenerationJob Use Case
 * Validates balance, creates a sticker and an async generation job, and returns immediately
 */
export class CreateGenerationJobUseCase {
  constructor({ generationJobRepository, stickerRepository, spendBalanceUseCase }) {
    this.generationJobRepository = generationJobRepository;
    this.stickerRepository = stickerRepository;
    this.spendBalanceUseCase = spendBalanceUseCase;
  }

  /**
   * Execute generation job creation
   * @param {Object} input
   * @param {string} input.userId - User identifier
   * @param {string} input.type - Generation type: image_sticker | animated_sticker | img2vid
   * @param {string} input.imageUrl - Input image URL or base64 data URI
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
    imageUrl,
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

    if (!imageUrl) {
      throw new Error('imageUrl is required');
    }

    const cost = 1;

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
      input: {
        imageUrl,
        prompt,
        styleId,
        emoji
      },
      provider,
      cost
    });

    await this.generationJobRepository.save(job);

    return {
      success: true,
      jobId: job.id,
      stickerId: sticker.id,
      status: job.status,
      remainingBalance: spendResult.newBalance
    };
  }
}
