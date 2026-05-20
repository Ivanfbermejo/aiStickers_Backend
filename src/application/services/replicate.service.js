/**
 * Replicate Service
 * Handles AI image generation via Replicate API
 */
import { env } from '../../config/env.js';

/**
 * Polls a Replicate prediction until completion or timeout
 */
async function pollPrediction(predictionUrl, timeout = 55_000, interval = 1500) {
  const t0 = Date.now();

  while (true) {
    const res = await fetch(predictionUrl, {
      headers: { Authorization: `Token ${env.REPLICATE_API_TOKEN}` }
    });
    const pred = await res.json();

    if (!["queued", "starting", "processing"].includes(pred.status)) return pred;

    if (Date.now() - t0 > timeout) {
      throw new Error("Timeout Replicate (use webhook for longer operations)");
    }

    await new Promise(r => setTimeout(r, interval));
  }
}

/**
 * Generates a sticker from an image + prompt
 */
export async function runStickerModel(imageUrl, prompt) {
  const model = env.REPLICATE_MODEL || "google/nano-banana";

  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Token ${env.REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      version: model,
      input: {
        prompt,
        image_input: [imageUrl],
        output_format: "png"
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Replicate API error: ${errText}`);
  }

  const pred = await res.json();
  const finalPred = await pollPrediction(`https://api.replicate.com/v1/predictions/${pred.id}`);

  if (finalPred.status !== "succeeded") {
    throw new Error(`Replicate ${finalPred.status}: ${finalPred.error || "no detail"}`);
  }

  const url = Array.isArray(finalPred.output) ? finalPred.output[0] : finalPred.output;
  if (!url) throw new Error("Replicate returned no output");

  return { url, id: finalPred.id, web: finalPred.urls?.web };
}

/**
 * Image to video generation
 */
export async function runImageToVideo({
  imageUrl,
  prompt,
  duration = 3,
  resolution = "480p",
  fps = 24,
  aspect_ratio = "1:1"
} = {}) {
  const model = env.REPLICATE_IMG2VID_MODEL || "bytedance/seedance-1-pro";

  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Token ${env.REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json"
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

  if (finalPred.status !== "succeeded") {
    throw new Error(`Replicate ${finalPred.status}: ${finalPred.error || "no detail"}`);
  }

  const url = Array.isArray(finalPred.output) ? finalPred.output[0] : finalPred.output;
  if (!url) throw new Error("Replicate returned no output");

  return { url, id: finalPred.id, web: finalPred.urls?.web };
}

export const ReplicateService = {
  runStickerModel,
  runImageToVideo
};
