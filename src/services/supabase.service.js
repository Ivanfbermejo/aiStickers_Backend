import env from "../utils/env.js";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const BUCKET = env.SUPABASE_BUCKET;

export const SupabaseService = {
  getSignedUploadUrl(fileName, expiresIn = 300) {
    return supabase.storage.from(BUCKET).createSignedUploadUrl(fileName, expiresIn);
  },
  getSignedReadUrl(fileName, expiresIn = 300) {
    return supabase.storage.from(BUCKET).createSignedUrl(fileName, expiresIn);
  },
  uploadBytes(fileName, bytes, contentType = "image/png") {
    return supabase.storage.from(BUCKET).upload(fileName, bytes, { contentType, upsert: true });
  },
  removeFile(fileName) {
    return supabase.storage.from(BUCKET).remove([fileName]);
  },
};
