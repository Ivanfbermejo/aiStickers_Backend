// src/services/replicate.service.js
import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export async function runStickerModel(imageUrl, prompt) {
  try {
    const prediction = await replicate.run("google/nano-banana", {
      input: { image_input: imageUrl, prompt }
    });

    // prediction puede ser array o url según el modelo
    if (Array.isArray(prediction)) {
      return prediction[0];
    }
    return prediction;
  } catch (err) {
    console.error("Replicate error:", err);
    throw err;
  }
}