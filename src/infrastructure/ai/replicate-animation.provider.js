import fetch from 'node-fetch';
import { AnimationProvider } from '../../application/providers/animation.provider.js';
import { env } from '../../config/env.js';
import { metrics } from '../observability/metrics.js';
import { pollPrediction } from './replicate-poll.js';
import { ProviderError, providerErrorCategory, providerHttpError } from './provider-error.js';

/**
 * Replicate Animation Provider Implementation
 * Generates video/animation from an image + prompt
 */
export class ReplicateAnimationProvider extends AnimationProvider {
  async createPrediction(input, { signal } = {}) {
    const {
      imageUrl,
      prompt,
      duration = 3,
      resolution = '480p',
      fps = 24,
      aspect_ratio = '1:1'
    } = input || {};

    if (!imageUrl) {
      throw new Error('imageUrl is required');
    }

    const model = env.REPLICATE_IMG2VID_MODEL || 'bytedance/seedance-1-pro';
    metrics.aiCall('replicate', 'animated_sticker');

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
            duration,
            image: imageUrl,
            resolution,
            fps,
            aspect_ratio
          }
        })
      });
    } catch (error) {
      const providerError = signal?.aborted
        ? new ProviderError('Provider create request timed out', { code: 'PROVIDER_TIMEOUT' })
        : new ProviderError('Provider create request failed', { code: 'PROVIDER_NETWORK' });
      metrics.aiError('replicate', 'animated_sticker', providerErrorCategory(providerError));
      if (signal?.aborted) {
        throw providerError;
      }
      throw providerError;
    }
    if (!res.ok) {
      const providerError = providerHttpError(res.status);
      metrics.aiError('replicate', 'animated_sticker', providerErrorCategory(providerError));
      throw providerError;
    }

    let pred;
    try {
      pred = await res.json();
    } catch {
      const providerError = new ProviderError('Provider returned invalid prediction data', { code: 'PROVIDER_INVALID_RESPONSE' });
      metrics.aiError('replicate', 'animated_sticker', providerErrorCategory(providerError));
      throw providerError;
    }
    if (!pred.id) {
      const providerError = new ProviderError('Provider returned no prediction id', { code: 'PROVIDER_INVALID_RESPONSE' });
      metrics.aiError('replicate', 'animated_sticker', providerErrorCategory(providerError));
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
      metrics.aiError('replicate', 'animated_sticker', providerErrorCategory(error));
      throw error;
    }

    if (finalPred.status !== 'succeeded') {
      const providerError = new ProviderError(`Provider prediction ${finalPred.status || 'failed'}`, {
        code: `PROVIDER_${String(finalPred.status || 'FAILED').toUpperCase()}`,
        terminal: ['failed', 'canceled', 'cancelled'].includes(finalPred.status),
        transient: !['failed', 'canceled', 'cancelled'].includes(finalPred.status)
      });
      metrics.aiError('replicate', 'animated_sticker', providerErrorCategory(providerError));
      throw providerError;
    }

    const videoUrl = Array.isArray(finalPred.output) ? finalPred.output[0] : finalPred.output;
    if (!videoUrl) {
      const providerError = new ProviderError('Replicate returned no output', { code: 'PROVIDER_INVALID_RESPONSE' });
      metrics.aiError('replicate', 'animated_sticker', providerErrorCategory(providerError));
      throw providerError;
    }

    const thumbnailUrl = finalPred.urls?.web || videoUrl;

    return {
      imageUrl: undefined,
      videoUrl,
      thumbnailUrl,
      webpUrl: videoUrl,
      providerPredictionId: finalPred.id,
      costUsd: finalPred.metrics?.total_cost ?? finalPred.cost ?? null
    };
  }

  async animate(input) {
    const created = await this.createPrediction(input);
    return this.pollPrediction(created.providerPredictionId);
  }
}
