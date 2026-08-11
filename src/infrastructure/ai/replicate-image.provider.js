import fetch from 'node-fetch';
import { ImageProvider } from '../../application/providers/image.provider.js';
import { env } from '../../config/env.js';
import { metrics } from '../observability/metrics.js';
import { pollPrediction } from './replicate-poll.js';
import { ProviderError, providerErrorCategory, providerHttpError } from './provider-error.js';

/**
 * Replicate Image Provider Implementation
 * Generates sticker images from an image + prompt
 */
export class ReplicateImageProvider extends ImageProvider {
  async createPrediction(input, { signal } = {}) {
    const { imageUrl, prompt } = input || {};
    if (!imageUrl) {
      throw new Error('imageUrl is required');
    }

    const model = env.REPLICATE_MODEL || 'google/nano-banana';
    metrics.aiCall('replicate', 'image_sticker');

    let res;
    try {
      res = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          Authorization: `Token ${env.REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        signal,
        body: JSON.stringify({
          version: model,
          input: {
            prompt,
            image_input: [imageUrl],
            output_format: 'png'
          }
        })
      });
    } catch (error) {
      const providerError = signal?.aborted
        ? new ProviderError('Provider create request timed out', { code: 'PROVIDER_TIMEOUT' })
        : new ProviderError('Provider create request failed', { code: 'PROVIDER_NETWORK' });
      metrics.aiError('replicate', 'image_sticker', providerErrorCategory(providerError));
      if (signal?.aborted) {
        throw providerError;
      }
      throw providerError;
    }
    if (!res.ok) {
      const providerError = providerHttpError(res.status);
      metrics.aiError('replicate', 'image_sticker', providerErrorCategory(providerError));
      throw providerError;
    }

    let pred;
    try {
      pred = await res.json();
    } catch {
      const providerError = new ProviderError('Provider returned invalid prediction data', { code: 'PROVIDER_INVALID_RESPONSE' });
      metrics.aiError('replicate', 'image_sticker', providerErrorCategory(providerError));
      throw providerError;
    }
    if (!pred.id) {
      const providerError = new ProviderError('Provider returned no prediction id', { code: 'PROVIDER_INVALID_RESPONSE' });
      metrics.aiError('replicate', 'image_sticker', providerErrorCategory(providerError));
      throw providerError;
    }
    return {
      providerPredictionId: pred.id,
      predictionUrl: pred.urls?.get || `https://api.replicate.com/v1/predictions/${pred.id}`
    };
  }

  async pollPrediction(providerPredictionId, { timeoutMs = 180_000, intervalMs = 1500, signal } = {}) {
    let finalPred;
    try {
      finalPred = await pollPrediction(
        `https://api.replicate.com/v1/predictions/${providerPredictionId}`,
        timeoutMs,
        intervalMs,
        { signal }
      );
    } catch (error) {
      metrics.aiError('replicate', 'image_sticker', providerErrorCategory(error));
      throw error;
    }

    if (finalPred.status !== 'succeeded') {
      const providerError = new ProviderError(`Provider prediction ${finalPred.status || 'failed'}`, {
        code: `PROVIDER_${String(finalPred.status || 'FAILED').toUpperCase()}`,
        terminal: ['failed', 'canceled', 'cancelled'].includes(finalPred.status),
        transient: !['failed', 'canceled', 'cancelled'].includes(finalPred.status)
      });
      metrics.aiError('replicate', 'image_sticker', providerErrorCategory(providerError));
      throw providerError;
    }

    const imageUrlResult = Array.isArray(finalPred.output) ? finalPred.output[0] : finalPred.output;
    if (!imageUrlResult) {
      const providerError = new ProviderError('Replicate returned no output', { code: 'PROVIDER_INVALID_RESPONSE' });
      metrics.aiError('replicate', 'image_sticker', providerErrorCategory(providerError));
      throw providerError;
    }

    const thumbnailUrl = finalPred.urls?.web || imageUrlResult;

    return {
      imageUrl: imageUrlResult,
      thumbnailUrl,
      webpUrl: imageUrlResult,
      providerPredictionId: finalPred.id,
      costUsd: finalPred.metrics?.total_cost ?? finalPred.cost ?? null
    };
  }

  // Kept for callers outside the durable worker. The worker deliberately calls
  // createPrediction and pollPrediction separately so the ID is persisted
  // before waiting on the external provider.
  async generate(input) {
    const created = await this.createPrediction(input);
    return this.pollPrediction(created.providerPredictionId);
  }
}
