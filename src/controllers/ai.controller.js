// src/controllers/ai.controller.js
import crypto from "crypto";
import { SupabaseService } from "../services/supabase.service.js";
import { runStickerModel } from "../services/replicate.service.js";

export const AIController = {
  // POST /upload-url
  async uploadUrl(req, res) {
    try {
      const fileName = `${crypto.randomUUID()}.png`;
      const { data, error } = await SupabaseService.getSignedUploadUrl(fileName);
      if (error) {
        console.error("UPLOAD-URL error:", error);
        return res.status(500).json({ error: error.message });
      }
      console.log("UPLOAD-URL ok:", { fileName });
      return res.json({ fileName, uploadUrl: data.signedUrl });
    } catch (e) {
      console.error("UPLOAD-URL exception:", e);
      return res.status(500).json({ error: e.message || "internal error" });
    }
  },

  // POST /process
  async process(req, res) {
    try {
      const { fileName, prompt } = req.body || {};
      if (!fileName) return res.status(400).json({ error: "fileName is required" });

      // 1) URL firmada de lectura (5 min)
      const { data: signed, error } = await SupabaseService.getSignedReadUrl(fileName, 300);
      if (error || !signed?.signedUrl) {
        console.error("SIGNED-READ error:", error);
        return res.status(404).json({ error: "Object not found" });
      }
      console.log("SIGNED-READ ok:", { fileName });

      // 2) Replicate
      const finalPrompt = (prompt && String(prompt).trim()) || "clean sticker with white border, high contrast";
      console.log("REPLICATE run:", { prompt: finalPrompt });

      const { url, id, web } = await runStickerModel(signed.signedUrl, finalPrompt);
      console.log("REPLICATE result:", { url, id, web }); // ✅ corregido

      // 3) No borramos el original por ahora
      const del = await SupabaseService.removeFile(fileName).catch(e => ({ error: e }));
      if (del?.error) console.warn("REMOVE original warning:", del.error?.message);

      // 4) Respuesta
      return res.json({result: { url, replicateId: id, web }});
    } catch (e) {
      console.error("PROCESS exception:", e);
      return res.status(500).json({ error: e.message || "internal error" });
    }
  }
};
