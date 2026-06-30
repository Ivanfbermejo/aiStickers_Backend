/**
 * GenerationJob Worker
 * Simple local processor that polls pending jobs and executes them asynchronously
 */
export class GenerationJobWorker {
  constructor({
    generationJobRepository,
    stickerRepository,
    imageProvider,
    animationProvider,
    refundBalanceUseCase,
    intervalMs = 5000
  }) {
    this.generationJobRepository = generationJobRepository;
    this.stickerRepository = stickerRepository;
    this.imageProvider = imageProvider;
    this.animationProvider = animationProvider;
    this.refundBalanceUseCase = refundBalanceUseCase;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log(`[GenerationJobWorker] Started, polling every ${this.intervalMs}ms`);
    this.timer = setInterval(() => this.processNext(), this.intervalMs);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processNext() {
    try {
      const pending = await this.generationJobRepository.findPending();
      if (pending.length === 0) return;

      const job = pending[0];
      await this.processJob(job);
    } catch (error) {
      console.error('[GenerationJobWorker] Unexpected error processing next job:', error);
    }
  }

  async processJob(job) {
    job.markProcessing('generating_image');
    await this.generationJobRepository.update(job);

    try {
      let result;
      if (job.type === 'image_sticker') {
        job.updateStep('generating_image', 30);
        await this.generationJobRepository.update(job);
        result = await this.imageProvider.generate(job.input);
      } else if (job.type === 'animated_sticker' || job.type === 'img2vid') {
        job.updateStep('generating_video', 30);
        await this.generationJobRepository.update(job);
        result = await this.animationProvider.animate(job.input);
      } else {
        throw new Error(`Unsupported job type: ${job.type}`);
      }

      job.updateStep('saving_result', 90);
      await this.generationJobRepository.update(job);

      job.markCompleted(result);
      await this.generationJobRepository.update(job);

      const sticker = await this.stickerRepository.findById(job.stickerId);
      if (sticker) {
        sticker.markAsDone(result.imageUrl, result.thumbnailUrl || result.imageUrl);
        await this.stickerRepository.update(sticker);
      }

      console.log(`[GenerationJobWorker] Job ${job.id} completed`);
    } catch (error) {
      console.error(`[GenerationJobWorker] Job ${job.id} failed:`, error);
      job.markFailed(error.message);
      await this.generationJobRepository.update(job);

      try {
        const sticker = await this.stickerRepository.findById(job.stickerId);
        if (sticker) {
          sticker.markAsError(error.message);
          await this.stickerRepository.update(sticker);
        }

        await this.refundBalanceUseCase.execute({
          userId: job.userId,
          amount: job.cost,
          productId: `generation:${job.type}`,
          reason: error.message
        });
        console.log(`[GenerationJobWorker] Refunded ${job.cost} StickerDollar(s) to user ${job.userId}`);
      } catch (refundError) {
        console.error(`[GenerationJobWorker] Refund failed for job ${job.id}:`, refundError);
      }
    }
  }
}
