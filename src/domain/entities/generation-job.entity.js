/**
 * GenerationJob Entity - Core business object
 * Represents an async AI generation job (image, animated sticker, video)
 */
export class GenerationJob {
  constructor({
    id,
    userId,
    type,
    status = 'queued',
    currentStep = 'queued',
    progress = 0,
    packageId,
    stickerId,
    input,
    result,
    provider,
    providerPredictionId,
    cost = 1,
    attempts = 0,
    lockedAt,
    completedAt,
    refundedAt,
    errorMessage,
    createdAt,
    updatedAt
  }) {
    this.id = id;
    this.userId = userId;
    this.type = type;
    this.status = status;
    this.currentStep = currentStep;
    this.progress = progress;
    this.packageId = packageId;
    this.stickerId = stickerId;
    this.input = input;
    this.result = result;
    this.provider = provider;
    this.providerPredictionId = providerPredictionId;
    this.cost = cost;
    this.attempts = attempts;
    this.lockedAt = lockedAt;
    this.completedAt = completedAt;
    this.refundedAt = refundedAt;
    this.errorMessage = errorMessage;
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || new Date().toISOString();

    this.validate();
  }

  validate() {
    if (!this.id) {
      throw new Error('GenerationJob ID is required');
    }
    if (!this.userId) {
      throw new Error('GenerationJob userId is required');
    }
    if (!this.type) {
      throw new Error('GenerationJob type is required');
    }
    if (!this.stickerId) {
      throw new Error('GenerationJob stickerId is required');
    }
    const validTypes = ['image_sticker', 'animated_sticker', 'img2vid'];
    if (!validTypes.includes(this.type)) {
      throw new Error(`Invalid GenerationJob type: ${this.type}`);
    }
    const validStatuses = ['queued', 'processing', 'completed', 'failed', 'cancelled'];
    if (!validStatuses.includes(this.status)) {
      throw new Error(`Invalid GenerationJob status: ${this.status}`);
    }
  }

  markProcessing(currentStep = 'processing') {
    this.status = 'processing';
    this.currentStep = currentStep;
    this.progress = Math.max(this.progress, 10);
    this.attempts += 1;
    this.lockedAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  setProviderPredictionId(providerPredictionId) {
    if (!providerPredictionId) {
      throw new Error('providerPredictionId is required');
    }
    this.providerPredictionId = providerPredictionId;
    this.currentStep = 'polling_provider';
    this.updatedAt = new Date().toISOString();
  }

  markRetryable(currentStep = 'retrying') {
    this.status = 'queued';
    this.currentStep = currentStep;
    this.lockedAt = undefined;
    this.updatedAt = new Date().toISOString();
  }

  requeueFromDlq() {
    if (this.status !== 'failed' || this.currentStep !== 'dead_letter') {
      throw new Error('Only dead-letter jobs can be replayed');
    }
    this.status = 'queued';
    this.currentStep = 'replayed';
    this.errorMessage = undefined;
    this.lockedAt = undefined;
    this.updatedAt = new Date().toISOString();
  }

  updateStep(step, progress) {
    this.currentStep = step;
    this.progress = progress;
    this.updatedAt = new Date().toISOString();
  }

  markCompleted(result) {
    this.status = 'completed';
    this.currentStep = 'completed';
    this.progress = 100;
    this.result = result;
    this.errorMessage = undefined;
    this.lockedAt = undefined;
    this.completedAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  markFailed(errorMessage, currentStep = 'failed') {
    this.status = 'failed';
    this.currentStep = currentStep;
    this.errorMessage = errorMessage;
    this.lockedAt = undefined;
    this.updatedAt = new Date().toISOString();
  }

  markCancelled() {
    this.status = 'cancelled';
    this.currentStep = 'cancelled';
    this.updatedAt = new Date().toISOString();
  }

  isPending() {
    return this.status === 'queued' || this.status === 'processing';
  }

  isDone() {
    return this.status === 'completed' || this.status === 'failed' || this.status === 'cancelled';
  }

  static create({ userId, type, packageId, stickerId, input, provider, cost = 1 }) {
    return new GenerationJob({
      id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      type,
      status: 'queued',
      currentStep: 'queued',
      progress: 0,
      packageId,
      stickerId,
      input,
      provider,
      cost
    });
  }
}
