/**
 * Animation Provider Interface
 * Abstraction over concrete AI image-to-video / animation services
 */
export class AnimationProvider {
  async animate(input) {
    throw new Error('Not implemented');
  }
}
