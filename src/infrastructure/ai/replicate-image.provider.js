import fetch from 'node-fetch';
import { ImageProvider } from '../../application/providers/image.provider.js';
import { env } from '../../config/env.js';
import { pollPrediction } from './replicate-poll.js';
import { ProviderError, providerHttpError } from './provider-error.js';

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

    const imageUrlResult = Array.isArray(finalPred.output) ? finalPred.output[0] : finalPred.output;
    if (!imageUrlResult) throw new Error('Replicate returned no output');

    const thumbnailUrl = finalPred.urls?.web || imageUrlResult;

    return {
      imageUrl: imageUrlResult,
      thumbnailUrl,
      webpUrl: imageUrlResult,
      providerPredictionId: finalPred.id
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
