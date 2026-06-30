import fetch from 'node-fetch';
import { AnimationProvider } from '../../application/providers/animation.provider.js';
import { env } from '../../config/env.js';
import { pollPrediction } from './replicate-poll.js';

/**
 * Replicate Animation Provider Implementation
 * Generates video/animation from an image + prompt
 */
export class ReplicateAnimationProvider extends AnimationProvider {
  async animate(input) {
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

    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Token ${env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
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

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Replicate API error: ${errText}`);
    }

    const pred = await res.json();
    const finalPred = await pollPrediction(`https://api.replicate.com/v1/predictions/${pred.id}`);

    if (finalPred.status !== 'succeeded') {
      throw new Error(`Replicate ${finalPred.status}: ${finalPred.error || 'no detail'}`);
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
}
