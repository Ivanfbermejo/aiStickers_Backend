// src/controllers/ai.controller.js
import crypto from "crypto";
import { SupabaseService } from "../services/supabase.service.js";
import { runStickerModel, runImageToVideo } from "../services/replicate.service.js";

export const AIController = {
  async uploadUrl(req, res) {
    const fileName = `${crypto.randomUUID()}.png`;
    const { data, error } = await SupabaseService.getSignedUploadUrl(fileName);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ fileName, uploadUrl: data.signedUrl });
  },

  // POST /process-image  { fileName, prompt? }
  async processImage(req, res) {
    try {
      const { fileName, prompt } = req.body || {};
      if (!fileName) return res.status(400).json({ error: "fileName is required" });

      const { data: signed, error } = await SupabaseService.getSignedReadUrl(fileName, 300);
      if (error || !signed?.signedUrl) return res.status(404).json({ error: "Object not found" });

      const finalPrompt = (prompt?.trim()) || "clean sticker with white border, high contrast";
      const { url: imageUrl, id, web } = await runStickerModel(signed.signedUrl, finalPrompt);

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
        const { data, error } = await SupabaseService.getSignedReadUrl(fileName, 300);
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
