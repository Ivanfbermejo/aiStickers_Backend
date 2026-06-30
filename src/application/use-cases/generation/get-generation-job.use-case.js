/**
 * Get GenerationJob Use Case
 * Retrieves a single generation job for the authenticated user, optionally including the sticker
 */
export class GetGenerationJobUseCase {
  constructor({ generationJobRepository, stickerRepository }) {
    this.generationJobRepository = generationJobRepository;
    this.stickerRepository = stickerRepository;
  }

  /**
   * Execute job retrieval
   * @param {Object} input
   * @param {string} input.userId - User identifier
   * @param {string} input.jobId - Generation job identifier
   * @returns {Object} Job and sticker if available
   */
  async execute({ userId, jobId }) {
    const job = await this.generationJobRepository.findById(jobId);

    if (!job || job.userId !== userId) {
      return { found: false };
    }

    const sticker = await this.stickerRepository.findById(job.stickerId);

    return {
      found: true,
      job,
      sticker: sticker || null
    };
  }
}
