/**
 * Animation Provider Interface
 * Abstraction over concrete AI image-to-video / animation services
 */
export class AnimationProvider {
  async createPrediction(_input) {
    throw new Error('Not implemented');
  }

  async pollPrediction(_providerPredictionId, _options = {}) {
    throw new Error('Not implemented');
  }

  async animate(input) {
    throw new Error('Not implemented');
  }
}
