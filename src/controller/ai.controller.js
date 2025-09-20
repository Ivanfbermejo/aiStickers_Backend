import crypto from "crypto";
import { SupabaseService } from "../services/supabase.service.js";
import { ReplicateService } from "../services/replicate.service.js";

export const AIController = {
  async uploadUrl(req, res) {
    const fileName = `${crypto.randomUUID()}.png`;
    const { data, error } = await SupabaseService.getSignedUploadUrl(fileName);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ fileName, uploadUrl: data.signedUrl });
  },

  async process(req, res) {
    const { fileName, prompt } = req.body;

    // URL firmada de lectura
    const { data: signed, error } = await SupabaseService.getSignedReadUrl(fileName, 300);
    if (error) return res.status(500).json({ error: error.message });

    // Llamar a Replicate
    const prediction = await ReplicateService.runStickerModel(signed.signedUrl, prompt);

    // Borrar original
    await SupabaseService.removeFile(fileName);

    res.json({ result: prediction });
  }
};
