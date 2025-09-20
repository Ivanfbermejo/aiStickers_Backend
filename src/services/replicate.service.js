// src/services/replicate.service.js
import Replicate from "replicate";
import env from "../utils/env.js";

const replicate = new Replicate({ auth: env.REPLICATE_API_TOKEN });

export async function runStickerModel(imageUrl, prompt) {
  const out = await replicate.run("google/nano-banana", { input: { image: imageUrl, prompt } });
  const url = Array.isArray(out) ? out[0] : out;
  return { url, id: undefined, web: undefined };
}

function pickVideoUrl(out) {
  if (!out) return null;
  if (typeof out === "string") return out;
  if (Array.isArray(out)) {
    return out.find(u => typeof u === "string" &&
      (u.endsWith(".mp4") || u.endsWith(".webm") || u.endsWith(".gif"))) || out[0];
  }
  if (out.output) return pickVideoUrl(out.output);
  if (out.video) return out.video;
  return null;
}

// --- Seedance: imagen -> vídeo o texto -> vídeo ---
export async function runImageToVideo({ imageUrl, prompt, duration = 3, resolution = "480p", fps = 24, aspect_ratio = "1:1" } = {}) {
  const model = env.REPLICATE_IMG2VID_MODEL || "bytedance/seedance-1-pro";

  const input = { duration, fps, resolution };
  if (imageUrl) input.image = imageUrl;          // modo imagen->vídeo
  if (prompt)   input.prompt = prompt;           // modo texto->vídeo
  if (!imageUrl && aspect_ratio) input.aspect_ratio = aspect_ratio; // solo texto

  const out = await replicate.run(model, { input });
  const url = pickVideoUrl(out);
  if (!url) throw new Error("Seedance no devolvió una URL de vídeo");
  return url;
}
