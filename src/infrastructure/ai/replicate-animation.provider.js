import fetch from 'node-fetch';
import { AnimationProvider } from '../../application/providers/animation.provider.js';
import { env } from '../../config/env.js';
import { pollPrediction } from './replicate-poll.js';
import { ProviderError, providerHttpError } from './provider-error.js';

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
      if (signal?.aborted) {
        throw new ProviderError('Provider create request timed out', { code: 'PROVIDER_TIMEOUT' });
      }
      throw new ProviderError('Provider create request failed', { code: 'PROVIDER_NETWORK' });
    }
    if (!res.ok) throw providerHttpError(res.status);

    const pred = await res.json();
    if (!pred.id) throw new ProviderError('Provider returned no prediction id', { code: 'PROVIDER_INVALID_RESPONSE' });
    return {
      providerPredictionId: pred.id,
      predictionUrl: pred.urls?.get || `https://api.replicate.com/v1/predictions/${pred.id}`
    };
  }

  async pollPrediction(providerPredictionId, { timeoutMs = 180_000, intervalMs = 1500, signal } = {}) {
    const finalPred = await pollPrediction(
      `https://api.replicate.com/v1/predictions/${providerPredictionId}`,
      timeoutMs,
      intervalMs,
      { signal }
    );

    if (finalPred.status !== 'succeeded') {
      throw new ProviderError(`Provider prediction ${finalPred.status || 'failed'}`, {
        code: `PROVIDER_${String(finalPred.status || 'FAILED').toUpperCase()}`,
        terminal: ['failed', 'canceled', 'cancelled'].includes(finalPred.status),
        transient: !['failed', 'canceled', 'cancelled'].includes(finalPred.status)
      });
    }

    const videoUrl = Array.isArray(finalPred.output) ? finalPred.output[0] : finalPred.output;
    if (!videoUrl) throw new Error('Replicate returned no output');

    const thumbnailUrl = finalPred.urls?.web || videoUrl;

    return {
      imageUrl,
      videoUrl,
      thumbnailUrl,
      webpUrl: videoUrl,
      providerPredictionId: finalPred.id
    };
  }

  async animate(input) {
    const created = await this.createPrediction(input);
    return this.pollPrediction(created.providerPredictionId);
  }
}
