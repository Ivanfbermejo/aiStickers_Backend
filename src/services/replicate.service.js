// src/services/replicate.service.js
import fetch from "node-fetch";
import env from "../utils/env.js";

/**
 * Espera a que la predicción de Replicate termine y devuelve el resultado
 */
async function pollPrediction(predictionUrl, timeout = 55_000, interval = 1500) {
  const t0 = Date.now();

  while (true) {
    const res = await fetch(predictionUrl, {
      headers: { Authorization: `Token ${env.REPLICATE_API_TOKEN}` }
    });
    const pred = await res.json();

    if (!["queued","starting","processing"].includes(pred.status)) return pred;

    if (Date.now() - t0 > timeout) {
      throw new Error("Timeout Replicate (usa webhook si tarda más)");
    }

    await new Promise(r => setTimeout(r, interval));
  }
}

/**
 * Genera un sticker a partir de imagen + prompt
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
    throw new Error(`Replicate ${finalPred.status}: ${finalPred.error || "sin detalle"}`);
  }

  const url = Array.isArray(finalPred.output) ? finalPred.output[0] : finalPred.output;
  if (!url) throw new Error("Replicate sin salida");

  return { url, id: finalPred.id, web: finalPred.urls?.web };
}

/**
 * Imagen -> vídeo o texto -> vídeo
 */
export async function runImageToVideo({
  imageUrl, prompt, duration = 3, resolution = "480p", fps = 24, aspect_ratio = "1:1"
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
    throw new Error(`Replicate ${finalPred.status}: ${finalPred.error || "sin detalle"}`);
  }

  const url = Array.isArray(finalPred.output) ? finalPred.output[0] : finalPred.output;
  if (!url) throw new Error("Replicate sin salida");

  return { url, id: finalPred.id, web: finalPred.urls?.web };
}
