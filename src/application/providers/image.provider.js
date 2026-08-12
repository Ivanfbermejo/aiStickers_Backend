/**
 * Image Provider Interface
 * Abstraction over concrete AI image generation services
 */
export class ImageProvider {
  async createPrediction(_input) {
    throw new Error('Not implemented');
  }

  async pollPrediction(_providerPredictionId, _options = {}) {
    throw new Error('Not implemented');
  }

  async generate(input) {
    throw new Error('Not implemented');
  }
}
