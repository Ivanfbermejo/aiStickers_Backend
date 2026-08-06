import { ProviderError } from './provider-error.js';

function safeErrorMessage(error) {
  if (error?.code === 'PROVIDER_TIMEOUT') return 'Generation provider timed out';
  if (error?.terminal) return 'Generation provider rejected the prediction';
  if (error?.code === 'PROVIDER_NETWORK') return 'Generation provider is temporarily unavailable';
  if (error?.code?.startsWith('PROVIDER_HTTP_')) return 'Generation provider request failed';
  if (error?.message === 'Insufficient balance') return error.message;
  return 'Generation could not be completed';
}

function terminalError(error) {
  return error?.terminal === true || error?.code === 'GENERATION_UNSUPPORTED' || error?.code === 'GENERATION_INPUT';
}

function asTerminalError(message, code) {
  return new ProviderError(message, { code, terminal: true, transient: false });
}

/**
 * Durable generation processor. BullMQ owns delivery/retry; this class owns
 * the PostgreSQL state machine and is intentionally independent of HTTP.
 */
export class GenerationJobWorker {
  constructor({
    generationJobRepository,
    stickerRepository,
    imageProvider,
    animationProvider,
    assetService,
    refundBalanceUseCase,
    queueTimeoutMs = 180000,
    lockDurationMs = 240000
  }) {
    if (!assetService) throw new Error('GenerationJobWorker requires private asset storage');
    this.generationJobRepository = generationJobRepository;
    this.stickerRepository = stickerRepository;
    this.imageProvider = imageProvider;
    this.animationProvider = animationProvider;
    this.assetService = assetService;
    this.refundBalanceUseCase = refundBalanceUseCase;
    this.queueTimeoutMs = queueTimeoutMs;
    this.lockDurationMs = lockDurationMs;
  }

  /** Process a BullMQ delivery after claiming the matching PostgreSQL row. */
  async processQueueJob(queueJob) {
    const jobId = queueJob?.data?.jobId || queueJob?.jobId || queueJob?.id;
    if (!jobId) throw asTerminalError('Generation queue payload has no jobId', 'GENERATION_INPUT');

    const current = await this.generationJobRepository.findById(jobId);
    if (!current) return { skipped: true, reason: 'missing_job' };
    if (current.status === 'failed' && current.currentStep === 'dead_letter') {
      current.requeueFromDlq();
      await this.generationJobRepository.update(current);
    }
    // A terminal failure whose refund was interrupted is safe to resume. DLQ
    // entries use currentStep=dead_letter and deliberately do not refund.
    if (current.status === 'failed' && current.currentStep === 'failed' && !current.refundedAt) {
      await this.failTerminal(current, asTerminalError('Terminal generation failure', 'GENERATION_TERMINAL'));
      return { completed: false, terminal: true, jobId };
    }
    if (current.isDone()) return { skipped: true, reason: 'already_terminal' };

    let claimed = current;
    if (typeof this.generationJobRepository.claimJob === 'function') {
      claimed = await this.generationJobRepository.claimJob(jobId, this.lockDurationMs);
      if (!claimed) return { skipped: true, reason: 'claimed_by_other_worker' };
    }

    return this.processJob(claimed);
  }

  /**
   * Process one job. Provider creation and provider polling are separate: the
   * prediction ID is committed before any polling request is made.
   */
  async processJob(job) {
    if (job.isDone()) return { skipped: true, reason: 'already_terminal' };

    try {
      if (job.status !== 'processing') {
        job.markProcessing('generating_image');
        await this.generationJobRepository.update(job);
      }

      const providerInput = { ...job.input };
      if (providerInput.objectKey) {
        providerInput.imageUrl = await this.assetService.getSignedUrl(providerInput.objectKey, job.userId);
        delete providerInput.objectKey;
      }

      const provider = job.type === 'image_sticker'
        ? this.imageProvider
        : (job.type === 'animated_sticker' || job.type === 'img2vid' ? this.animationProvider : null);
      if (!provider) throw asTerminalError(`Unsupported job type: ${job.type}`, 'GENERATION_UNSUPPORTED');

      let result;
      if (job.providerPredictionId) {
        job.updateStep('polling_provider', Math.max(job.progress, 50));
        await this.generationJobRepository.update(job);
        result = await this.pollProvider(provider, job.providerPredictionId);
      } else if (typeof provider.createPrediction === 'function') {
        job.updateStep(job.type === 'image_sticker' ? 'creating_image_prediction' : 'creating_video_prediction', 30);
        await this.generationJobRepository.update(job);

        const created = await this.createProviderPrediction(provider, providerInput);
        if (!created?.providerPredictionId) {
          throw asTerminalError('Provider returned no prediction id', 'PROVIDER_INVALID_RESPONSE');
        }

        // This write is the cost-protection boundary. A retry must observe this
        // ID and only poll; it must never call createPrediction again.
        job.setProviderPredictionId(created.providerPredictionId);
        await this.generationJobRepository.update(job);
        result = await this.pollProvider(provider, created.providerPredictionId);
      } else {
        // Compatibility for test/fallback providers. Production Replicate
        // providers implement the durable create/poll split above.
        result = await provider.generate(providerInput);
        if (result?.providerPredictionId && !job.providerPredictionId) {
          job.setProviderPredictionId(result.providerPredictionId);
          await this.generationJobRepository.update(job);
        }
      }

      const assetUrl = result?.videoUrl || result?.imageUrl;
      if (!assetUrl) throw asTerminalError('Provider returned no result asset', 'PROVIDER_INVALID_RESPONSE');

      job.updateStep('saving_result', 90);
      await this.generationJobRepository.update(job);

      const sticker = await this.stickerRepository.findById(job.stickerId);
      if (!sticker) throw asTerminalError(`Sticker ${job.stickerId} not found`, 'GENERATION_INPUT');

      // The external URL is short-lived. Copy and verify it in private object
      // storage before either the sticker or job becomes completed.
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
        providerPredictionId: job.providerPredictionId || result.providerPredictionId
      });
      await this.generationJobRepository.update(job);
      return { completed: true, jobId: job.id };
    } catch (error) {
      if (terminalError(error)) {
        await this.failTerminal(job, error);
        return { completed: false, terminal: true, jobId: job.id };
      }

      // BullMQ will redeliver this same job. Reset the DB row so a second worker
      // can claim it after a crash/stall, without refunding a transient failure.
      job.markRetryable('retrying');
      await this.generationJobRepository.update(job);
      throw error;
    }
  }

  async createProviderPrediction(provider, input) {
    return provider.createPrediction(input);
  }

  async pollProvider(provider, predictionId) {
    if (typeof provider.pollPrediction !== 'function') {
      throw asTerminalError('Provider cannot poll durable predictions', 'PROVIDER_UNSUPPORTED');
    }
    return provider.pollPrediction(predictionId, { timeoutMs: this.queueTimeoutMs });
  }

  async failTerminal(job, error) {
    const safeMessage = safeErrorMessage(error);
    if (!job.isDone() || job.status !== 'failed') {
      job.markFailed(safeMessage);
      await this.generationJobRepository.update(job);
    }

    const sticker = await this.stickerRepository.findById(job.stickerId);
    if (sticker) {
      sticker.markAsError(safeMessage);
      await this.stickerRepository.update(sticker);
    }

    if (job.refundedAt || !this.refundBalanceUseCase) return;
    await this.refundBalanceUseCase.execute({
      userId: job.userId,
      amount: job.cost,
      productId: `generation:${job.type}`,
      reason: error.code || 'terminal_generation_failure',
      jobId: job.id
    });
    job.refundedAt = new Date().toISOString();
    await this.generationJobRepository.update(job);
  }

  /** Mark a transient delivery exhausted without refunding it. */
  async moveToDlq(jobId) {
    const job = await this.generationJobRepository.findById(jobId);
    if (!job || job.isDone()) return;
    job.markFailed('Generation is awaiting operator replay', 'dead_letter');
    await this.generationJobRepository.update(job);
  }
}
