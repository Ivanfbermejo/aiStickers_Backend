import Replicate from "replicate";
import { ENV } from "../utils/env.js";

const replicate = new Replicate({ auth: ENV.REPLICATE_API_TOKEN });

export const ReplicateService = {
  async runStickerModel(imageUrl, prompt) {
    return await replicate.run("google/nano-banana", {
      input: { image: imageUrl, prompt }
    });
  }
};
