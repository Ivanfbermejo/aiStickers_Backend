// src/controllers/ai.controller.js
import crypto from "crypto";
import { SupabaseService } from "../services/supabase.service.js";
// Si en tu servicio exportaste un objeto { ReplicateService: { runStickerModel } }, cambia la línea de abajo.
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

      // 1) URL firmada de lectura (5 minutos)
      const { data: signed, error } = await SupabaseService.getSignedReadUrl(fileName, 300);
      if (error || !signed?.signedUrl) {
        console.error("SIGNED-READ error:", error);
        return res.status(404).json({ error: "Object not found" });
      }
      console.log("SIGNED-READ ok:", { fileName, signedUrlPreview: signed.signedUrl.slice(0, 80) + "..." });

      // 2) Llamar a Replicate (modelo definido en services/replicate.service.js)
      const finalPrompt = prompt && String(prompt).trim().length > 0
        ? prompt
        : "clean sticker with white border, high contrast";

      console.log("REPLICATE run:", { prompt: finalPrompt });
      const resultUrl = await runStickerModel(signed.signedUrl, finalPrompt);
      console.log("REPLICATE result:", resultUrl);

      // 3) Borrar original (best-effort)
      // const del = await SupabaseService.removeFile(fileName).catch(e => ({ error: e }));
      // if (del?.error) console.warn("REMOVE original warning:", del.error?.message);

      // 4) Responder con la URL final
      return res.json({ result: resultUrl });
    } catch (e) {
      console.error("PROCESS exception:", e);
      return res.status(500).json({ error: e.message || "internal error" });
    }
  }
};
