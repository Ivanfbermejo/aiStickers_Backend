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
    assetService,
    refundBalanceUseCase,
    intervalMs = 5000
  }) {
    if (!assetService) {
      throw new Error('GenerationJobWorker requires private asset storage');
    }
    this.generationJobRepository = generationJobRepository;
    this.stickerRepository = stickerRepository;
    this.imageProvider = imageProvider;
    this.animationProvider = animationProvider;
    this.assetService = assetService;
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
      const providerInput = { ...job.input };
      if (providerInput.objectKey) {
        providerInput.imageUrl = await this.assetService.getSignedUrl(
          providerInput.objectKey,
          job.userId
        );
        delete providerInput.objectKey;
      }

      let result;
      if (job.type === 'image_sticker') {
        job.updateStep('generating_image', 30);
        await this.generationJobRepository.update(job);
        result = await this.imageProvider.generate(providerInput);
      } else if (job.type === 'animated_sticker' || job.type === 'img2vid') {
        job.updateStep('generating_video', 30);
        await this.generationJobRepository.update(job);
        result = await this.animationProvider.animate(providerInput);
      } else {
        throw new Error(`Unsupported job type: ${job.type}`);
      }

      job.updateStep('saving_result', 90);
      await this.generationJobRepository.update(job);

      const sticker = await this.stickerRepository.findById(job.stickerId);
      if (!sticker) {
        throw new Error(`Sticker ${job.stickerId} not found for generation job`);
      }

      const assetUrl = result.videoUrl || result.imageUrl;
      try {
        const asset = await this.assetService.copyExternalToStorage({
          url: assetUrl,
          ownerId: job.userId,
          idempotencyKey: `generation-result:${job.id}`
        });
        sticker.markAsStoredAsset(asset);
        await this.stickerRepository.update(sticker);

        job.markCompleted({
          objectKey: asset.key,
          hash: asset.hash,
          sizeBytes: asset.sizeBytes,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          providerPredictionId: result.providerPredictionId
        });
        await this.generationJobRepository.update(job);
      } catch (ingestError) {
        console.error(`[GenerationJobWorker] Failed to ingest result for job ${job.id}:`, ingestError);
        job.markFailed('Failed to store generated asset securely');
        await this.generationJobRepository.update(job);
        sticker.markAsError('Failed to store generated asset securely');
        await this.stickerRepository.update(sticker);
        throw ingestError;
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
