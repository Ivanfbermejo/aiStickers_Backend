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

  // POST /img2vid  { imageUrl? , fileName?, fps?, frames?, width?, height? }
  async img2vid(req, res) {
    try {
      const { imageUrl: rawUrl, fileName, duration, resolution, fps } = req.body || {};
      let imageUrl = rawUrl;

      if (!imageUrl && fileName) {
        const { data: signed, error } = await SupabaseService.getSignedReadUrl(fileName, 300);
        if (error || !signed?.signedUrl) return res.status(404).json({ error: "Object not found" });
        imageUrl = signed.signedUrl;
      }
      if (!imageUrl) return res.status(400).json({ error: "imageUrl or fileName is required" });

      const videoUrl = await runSeedance({ imageUrl, duration, resolution, fps });
      return res.json({ videoUrl });
    } catch (e) {
      console.error("img2vid:", e);
      return res.status(500).json({ error: e.message || "internal error" });
    }
  },
};
