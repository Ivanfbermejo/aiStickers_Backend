import fetch from 'node-fetch';
import { ImageProvider } from '../../application/providers/image.provider.js';
import { env } from '../../config/env.js';
import { pollPrediction } from './replicate-poll.js';

/**
 * Replicate Image Provider Implementation
 * Generates sticker images from an image + prompt
 */
export class ReplicateImageProvider extends ImageProvider {
  async generate(input) {
    const { imageUrl, prompt } = input || {};
    if (!imageUrl) {
      throw new Error('imageUrl is required');
    }

    const model = env.REPLICATE_MODEL || 'google/nano-banana';

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
          image_input: [imageUrl],
          output_format: 'png'
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
}
