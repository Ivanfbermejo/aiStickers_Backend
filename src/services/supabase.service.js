import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const SupabaseService = {
  async getSignedUploadUrl(fileName) {
    return await supabase.storage.from(process.env.BUCKET).createSignedUploadUrl(fileName);
  },

  async getSignedReadUrl(fileName, seconds = 300) {
    return await supabase.storage.from(process.env.BUCKET).createSignedUrl(fileName, seconds);
  },

  async removeFile(fileName) {
    return await supabase.storage.from(process.env.BUCKET).remove([fileName]);
  }
};
