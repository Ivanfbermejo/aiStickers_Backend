import dotenv from "dotenv";
dotenv.config();

export const ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
  BUCKET: "photos"
};
