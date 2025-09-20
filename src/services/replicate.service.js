import Replicate from "replicate";
import { ENV } from "../utils/env.js";

const replicate = new Replicate({ auth: ENV.REPLICATE_API_TOKEN });

export const ReplicateService = {
  async runStickerModel(imageUrl, prompt) {
    // Sustituye "nano-banana:latest" por tu modelo real
    return await replicate.run("nano-banana:latest", {
      input: { image: imageUrl, prompt }
    });
  }
};
