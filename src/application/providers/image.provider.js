/**
 * Image Provider Interface
 * Abstraction over concrete AI image generation services
 */
export class ImageProvider {
  async generate(input) {
    throw new Error('Not implemented');
  }
}
