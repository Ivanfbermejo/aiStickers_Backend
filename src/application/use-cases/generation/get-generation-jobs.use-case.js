/**
 * Get GenerationJobs Use Case
 * Lists all generation jobs for the authenticated user
 */
export class GetGenerationJobsUseCase {
  constructor({ generationJobRepository }) {
    this.generationJobRepository = generationJobRepository;
  }

  /**
   * Execute jobs list retrieval
   * @param {Object} input
   * @param {string} input.userId - User identifier
   * @returns {Object} User jobs list
   */
  async execute({ userId }) {
    const jobs = await this.generationJobRepository.findByUserId(userId);

    return {
      success: true,
      count: jobs.length,
      jobs
    };
  }
}
