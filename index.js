import "dotenv/config"; 
import express from "express";
import { AIController } from "./src/controllers/ai.controller.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

// Rutas
app.post("/upload-url", AIController.uploadUrl);
app.post("/process", AIController.process);

const port = process.env.PORT || 3000;
const HOST = "0.0.0.0"; 
app.listen(port, () => console.log(`MVP running on :${port}`));
