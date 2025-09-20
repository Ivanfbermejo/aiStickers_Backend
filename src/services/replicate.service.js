// src/services/replicate.service.js
import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const MODEL = process.env.REPLICATE_MODEL || "google/nano-banana"; // el que estás usando

export async function runStickerModel(imageUrl, prompt) {
  // Resuelve la última versión para evitar 422
  const m = await replicate.models.get(MODEL);
  const version = m?.latest_version?.id;
  if (!version) throw new Error(`Sin latest_version para ${MODEL}`);

  const pred = await replicate.predictions.create({
    model: MODEL,
    version,
    input: {
      prompt,
      image_input: [imageUrl],     // <- este modelo usa image_input[]
      output_format: "jpg"
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
