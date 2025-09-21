// src/services/replicate.service.js
import Replicate from "replicate";
import env from "../utils/env.js";

const replicate = new Replicate({ auth: env.REPLICATE_API_TOKEN });

export async function runStickerModel(imageUrl, prompt) {
  const model = process.env.REPLICATE_MODEL || "google/nano-banana";

  const pred = await replicate.predictions.create({
    model: model,
    input: {
      prompt,
      image_input: [imageUrl],     // <- este modelo usa image_input[]
      output_format: "png"
    }
  });

  // Polling simple (máx. ~55s para Railway)
  const t0 = Date.now();
  while (["queued","starting","processing"].includes(pred.status)) {
    if (Date.now() - t0 > 55_000) throw new Error("Timeout Replicate (usa webhook si tarda más)");
    await new Promise(r => setTimeout(r, 1500));
    Object.assign(pred, await replicate.predictions.get(pred.id));
  }

  if (pred.status !== "succeeded") {
    throw new Error(`Replicate ${pred.status}: ${pred.error || "sin detalle"}`);
  }

  // Puede ser string o array de strings
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!url) throw new Error("Replicate sin salida");

  // Devuelve datos útiles
  return { url, id: pred.id, web: pred.urls?.web };
}

// --- Seedance: imagen -> vídeo o texto -> vídeo ---
export async function runImageToVideo({
  imageUrl, prompt, duration = 3, resolution = "480p", fps = 24, aspect_ratio = "1:1"
} = {}) {
  const model = env.REPLICATE_IMG2VID_MODEL || "bytedance/seedance-1-pro";

  const pred = await replicate.predictions.create({
    model: model,
    input: {
      prompt: prompt,
      duration: duration,
      image: imageUrl,
      resolution: resolution,
      fps: fps,
      aspect_ratio: aspect_ratio
    }
  });

  // Polling simple (máx. ~55s para Railway)
  const t0 = Date.now();
  while (["queued","starting","processing"].includes(pred.status)) {
    if (Date.now() - t0 > 55_000) throw new Error("Timeout Replicate (usa webhook si tarda más)");
    await new Promise(r => setTimeout(r, 1500));
    Object.assign(pred, await replicate.predictions.get(pred.id));
  }

  if (pred.status !== "succeeded") {
    throw new Error(`Replicate ${pred.status}: ${pred.error || "sin detalle"}`);
  }

  // Puede ser string o array de strings
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!url) throw new Error("Replicate sin salida");

  // Devuelve datos útiles
  return { url, id: pred.id, web: pred.urls?.web };
}
