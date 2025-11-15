// src/controllers/ai.controller.js
import { runStickerModel, runImageToVideo } from "../services/replicate.service.js";
import { localstorage } from "../services/local.service.js";


function uploadLocalUrl(req, res) {
  

  return res.json({
    fileName: req.file.filename,
    url
  });
}

export const AIController = {

  // POST /process-image  { fileName, prompt? }
  async processImage(req, res) {
    try {
      const { prompt } = req.body || {};
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const signedUrl = localstorage.getPublicUrl(req.file.filename);
      const finalPrompt = (prompt?.trim()) || "clean sticker with white border, high contrast";

      const { url: imageUrl, id, web } = await runStickerModel(signedUrl, finalPrompt);

      return res.json({ imageUrl, replicateId: id, web });

    } catch (e) {
      console.error("processImage:", e);
      return res.status(500).json({ error: e.message || "internal error" });
    }
  },

  async img2vid(req, res) {
    try {
      const { imageUrl, rawUrl, fileName, duration, resolution, fps, prompt } = req.body || {};
      let url = (imageUrl || rawUrl || "").trim();

      // Si te mandan una URL en fileName, trátala como URL
      if (!url && fileName && /^https?:\/\//i.test(fileName)) {
        url = fileName.trim();
      }

      // Si te mandan un nombre del bucket, firma lectura
      if (!url && fileName) {
        // const { data, error } = await SupabaseService.getSignedReadUrl(fileName, 300);
        if (error || !data?.signedUrl) return res.status(404).json({ error: "Object not found" });
        url = data.signedUrl; // <-- NO uses 'signed' fuera de aquí
      }

      if (!url) return res.status(400).json({ error: "imageUrl or fileName is required" });

      const videoUrl = await runImageToVideo({ imageUrl: url, prompt: prompt });
      return res.json({ videoUrl });
    } catch (e) {
      console.error("img2vid:", e);
      return res.status(500).json({ error: e.message || "internal error" });
    }
  }
};
