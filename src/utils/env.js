import dotenv from "dotenv";
dotenv.config(); // en Railway no carga nada, pero no molesta

function must(name) {
  const v = process.env[name];
  if (!v) {
    console.error("ENV missing:", name);
    console.error("ENV snapshot:", {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "SET" : undefined,
      REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN ? "SET" : undefined,
    });
    throw new Error(`Missing ENV ${name}`);
  }
  return v;
}

export const ENV = {
  SUPABASE_URL: must("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY || must("SUPABASE_SERVICE_ROLE_KEY"),
  REPLICATE_API_TOKEN: must("REPLICATE_API_TOKEN"),
  BUCKET: "photos",
};
