import express from "express";
import { AIController } from "./src/controllers/ai.controller.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_,res)=>res.send("ok"));
app.get("/debug/env", (_,res)=>res.json({
  SUPABASE_URL: !!process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  REPLICATE_API_TOKEN: !!process.env.REPLICATE_API_TOKEN
}));


// Rutas
app.post("/upload-url", AIController.uploadUrl);
app.post("/process", AIController.process);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MVP running on :${port}`));
