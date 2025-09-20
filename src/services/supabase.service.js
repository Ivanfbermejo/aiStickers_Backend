import { createClient } from "@supabase/supabase-js";
import { ENV } from "../utils/env.js";

const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY);

export const SupabaseService = {
  async getSignedUploadUrl(fileName) {
    return await supabase.storage.from(ENV.BUCKET).createSignedUploadUrl(fileName);
  },

  async getSignedReadUrl(fileName, seconds = 300) {
    return await supabase.storage.from(ENV.BUCKET).createSignedUrl(fileName, seconds);
  },

  async removeFile(fileName) {
    return await supabase.storage.from(ENV.BUCKET).remove([fileName]);
  }
};
