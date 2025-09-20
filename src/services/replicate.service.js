// src/services/replicate.service.js
import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Usa el modelo exacto del Playground que te muestra `image_input`
const MODEL = process.env.REPLICATE_MODEL || "google/nano-banana";

export async function runStickerModel(imageUrl, prompt) {
  try {
    // Primero probamos con image_input (lo que pide tu ejemplo)
    try {
      const prediction = await replicate.run(MODEL, {
        input: {
          prompt,
          image_input: [imageUrl],   // 👈 CLAVE
          output_format: "jpg"
        }
      });
      return Array.isArray(prediction) ? prediction[0] : prediction;
    } catch (e) {
      // Fallback por si el modelo usa `image`
      const prediction = await replicate.run(MODEL, {
        input: {
          prompt,
          image: imageUrl,
          output_format: "jpg"
        }
      });
      return Array.isArray(prediction) ? prediction[0] : prediction;
    }
  } catch (err) {
    console.error("Replicate error:", err);
    throw err;
  }
}
